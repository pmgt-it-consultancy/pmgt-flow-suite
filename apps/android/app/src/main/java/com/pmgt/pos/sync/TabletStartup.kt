package com.pmgt.pos.sync

import com.pmgt.pos.auth.AuthState
import com.pmgt.pos.db.*
import com.pmgt.pos.telemetry.Telemetry
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

data class AdoptedStorage(val database: PosDatabase, val deviceId: String)
data class TabletStartupState(
    val userId: String? = null,
    val storeId: String? = null,
    val adoption: AdoptionState = AdoptionState.PendingVerification(),
    val verifying: Boolean = false,
)

/** Authenticated adoption gate. Storage/identity open exactly once, through the guarded adapter. */
class TabletStartup(
    private val openStorage: () -> AdoptedStorage,
    private val http: ConvexHttp,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher,
    private val online: StateFlow<Boolean>,
) {
    private val monitor = Any()
    private val adoptionMutex = Mutex()
    @Volatile private var generation = 0L
    private var storage: AdoptedStorage? = null
    private var binding: Job? = null
    @Volatile private var authState: StateFlow<AuthState>? = null
    private val current = MutableStateFlow(TabletStartupState())
    val state: StateFlow<TabletStartupState> = current.asStateFlow()
    private val manager = MutableStateFlow<SyncManager?>(null)
    val sync: StateFlow<SyncManager?> = manager.asStateFlow()
    val database: PosDatabase?
        get() = synchronized(monitor) { if (current.value.adoption is AdoptionState.Ready) storage?.database else null }
    /** The tablet's identity once storage has opened; it names the device, so it outlives sign-out. */
    val deviceId: String?
        get() = synchronized(monitor) { storage?.deviceId }

    fun bind(auth: StateFlow<AuthState>) = synchronized(monitor) {
        check(binding == null) { "Startup is already observing authentication" }
        authState = auth
        binding = scope.launch {
            launch {
                auth.map { it.user?.let { user -> user.id to user.storeId } }.distinctUntilChanged().collectLatest { identity ->
                    stop()
                    if (identity != null && identity.second != null) adopt(identity.first, identity.second!!)
                }
            }
            launch { retryWhenConnectivityArrives() }
        }
    }

    suspend fun adopt(userId: String, storeId: String): AdoptionState = adoptionMutex.withLock {
        val epoch = synchronized(monitor) {
            stop()
            current.value = TabletStartupState(userId, storeId, verifying = true)
            generation
        }
        try {
            val adopted = withContext(io) {
                // Retain ownership even if cancellation arrives while the guarded open is finishing.
                synchronized(monitor) { storage } ?: openStorage().also { synchronized(monitor) { storage = it } }
            }
            val verifier = AdoptionVerifier({
                adopted.database.transaction {
                    pendingWork(adopted.database, storeId, adopted.deviceId)
                    adopted.database.integrity()
                }
            }, { references ->
                verifyReferences(references, storeId)
            }, io)
            val result = verifier.verify()
            currentCoroutineContext().ensureActive()
            val ready = synchronized(monitor) {
                requireSession(epoch, userId, storeId)
                if (result is AdoptionState.Blocked) Telemetry.nonFatal("startup.adoption_blocked", AdoptionBlocked(result.message))
                current.value = TabletStartupState(userId, storeId, result)
                if (result is AdoptionState.Ready) {
                    SyncManager(adopted.database, http, adopted.deviceId, scope, io, online,
                        sessionIsCurrent = { isCurrent(epoch, userId, storeId) },
                        onBlocked = { message ->
                            synchronized(monitor) {
                                if (isCurrent(epoch, userId, storeId)) {
                                    current.value = TabletStartupState(userId, storeId, AdoptionState.Blocked(message))
                                    manager.value = null
                                }
                            }
                        }).also { manager.value = it }
                } else null
            }
            ready?.start(storeId)
            synchronized(monitor) {
                if (!isCurrent(epoch, userId, storeId)) { ready?.stop(); throw CancellationException("Adoption session ended") }
            }
            result
        } catch (cancelled: CancellationException) {
            synchronized(monitor) { if (generation == epoch) stop() }
            throw cancelled
        } catch (blocked: AdoptionBlocked) {
            val result = AdoptionState.Blocked(blocked.message ?: "Local adoption is blocked. Tablet data is preserved.")
            synchronized(monitor) {
                requireSession(epoch, userId, storeId)
                Telemetry.nonFatal("startup.adoption_blocked", blocked)
                current.value = TabletStartupState(userId, storeId, result)
            }
            result
        } catch (failure: Exception) {
            val result = AdoptionState.PendingVerification()
            synchronized(monitor) {
                requireSession(epoch, userId, storeId)
                Telemetry.nonFatal("startup.adoption", failure)
                current.value = TabletStartupState(userId, storeId, result)
            }
            result
        }
    }

    /**
     * Verification treats an offline flag as a terminal outcome, and a cold start reaches adoption
     * before the connectivity callback has reported a validated network. Without this the till waits
     * on "verifying" forever for a network that arrived a second later. Sync recovers the same way.
     */
    private suspend fun retryWhenConnectivityArrives() {
        online.collect { connected ->
            if (!connected) return@collect
            val stale = synchronized(monitor) {
                current.value.takeIf { it.adoption is AdoptionState.PendingVerification && !it.verifying }
            }
            val userId = stale?.userId ?: return@collect
            val storeId = stale.storeId ?: return@collect
            try {
                adopt(userId, storeId)
            } catch (ended: CancellationException) {
                // adopt() cancels itself when the session moves on; only propagate our own cancellation.
                currentCoroutineContext().ensureActive()
            }
        }
    }

    fun stop() = synchronized(monitor) {
        generation++
        manager.value?.stop()
        manager.value = null
        current.value = TabletStartupState()
    }

    // Called by sync's commit guard too: auth publication invalidates old work before the observer runs.
    private fun isCurrent(epoch: Long, userId: String, storeId: String): Boolean =
        generation == epoch && authState?.value?.let { it.user?.id == userId && it.selectedStoreId == storeId } != false

    private fun requireSession(epoch: Long, userId: String, storeId: String) {
        if (!isCurrent(epoch, userId, storeId)) throw CancellationException("Adoption session ended")
    }

    /**
     * The initial v1 pull is read-only here. Exact observed IDs resolve order references. Paging
     * can stop once those pairs resolve or the orders table is explicitly exhausted; unrelated
     * tables do not extend adoption verification. Missing live order IDs require the authoritative
     * existing orders:get lookup (with store validation). An absent deleted order is legitimate.
     * Ancillary retired/push-only references are retained; they are not made into a new mandatory
     * adoption gate. Unsent rows have no server reference.
     */
    private suspend fun verifyReferences(references: List<ServerReference>, storeId: String): ServerReferenceVerification {
        if (references.isEmpty()) return ServerReferenceVerification.Verified
        if (!online.value) return ServerReferenceVerification.Unavailable
        val unresolvedOrders = references.filter { it.table == "orders" }.toMutableList()
        val cursor = PullCursor()
        var ordersExhausted: Boolean
        do {
            currentCoroutineContext().ensureActive()
            val page = http.pull(null, cursor)
            cursor.accept(page)
            page.changes["orders"]?.let { bucket ->
                for (row in bucket.created + bucket.updated) {
                    val serverId = row["server_id"]?.jsonPrimitive?.content ?: continue
                    if (row["storeId"]?.jsonPrimitive?.content == storeId)
                        unresolvedOrders.removeAll { it.serverId == serverId && row["id"]?.jsonPrimitive?.content == it.localId }
                }
            }
            ordersExhausted = page.cursors["orders"]?.isDone == true
            yield()
        } while (unresolvedOrders.isNotEmpty() && !ordersExhausted && !page.complete)
        for ((serverId, sameServer) in unresolvedOrders.groupBy { it.serverId }) {
            val result = http.query("orders:get", buildJsonObject { put("orderId", serverId) })
            if (result == JsonNull) {
                if (sameServer.any { it.localStatus != "deleted" }) return ServerReferenceVerification.Missing
            } else {
                val order = result.jsonObject
                if (order["_id"]?.jsonPrimitive?.content != serverId || order["storeId"]?.jsonPrimitive?.content != storeId)
                    return ServerReferenceVerification.Missing
            }
        }
        return ServerReferenceVerification.Verified
    }
}
