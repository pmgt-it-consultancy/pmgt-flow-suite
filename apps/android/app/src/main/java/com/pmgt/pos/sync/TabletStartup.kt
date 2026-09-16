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

/** How many order references a spot check verifies; enough to catch a wholesale mismatch. */
private const val SPOT_CHECK_SAMPLE = 10

data class AdoptedStorage(val database: PosDatabase, val deviceId: String)

/** Blocked and ForeignStore are decisions, not transient failures, so they are never retried. */
internal fun TabletStartupState.awaitingVerification(): Boolean =
    userId != null && storeId != null && !verifying && adoption is AdoptionState.PendingVerification
data class TabletStartupState(
    val userId: String? = null,
    val storeId: String? = null,
    val adoption: AdoptionState = AdoptionState.PendingVerification(),
    val verifying: Boolean = false,
    /** When the next automatic attempt is due, for the gate to show. Null when none is scheduled. */
    val nextRetryAt: Long? = null,
)

/** Authenticated adoption gate. Storage/identity open exactly once, through the guarded adapter. */
class TabletStartup(
    private val openStorage: () -> AdoptedStorage,
    private val http: ConvexHttp,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher,
    private val online: StateFlow<Boolean>,
    /** Backoff between automatic attempts; the last entry is the cap. */
    private val retryDelays: List<Long> = listOf(5_000, 10_000, 20_000, 40_000, 60_000),
    private val evidence: AdoptionEvidenceStore = InMemoryAdoptionEvidence(),
) {
    private val monitor = Any()
    private val adoptionMutex = Mutex()
    private val retryMutex = Mutex()
    @Volatile private var sweptStoreId: String? = null
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
            launch { healWhileUnverified() }
        }
    }

    suspend fun adopt(userId: String, storeId: String): AdoptionState = adoptionMutex.withLock {
        val epoch = synchronized(monitor) {
            stop()
            sweptStoreId = null
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
            }, io, storeId)
            val result = verifier.verify()
            currentCoroutineContext().ensureActive()
            val ready = synchronized(monitor) {
                requireSession(epoch, userId, storeId)
                if (result is AdoptionState.Blocked) Telemetry.nonFatal("startup.adoption_blocked", AdoptionBlocked(result.message))
                if (result is AdoptionState.ForeignStore)
                    Telemetry.event("adoption_foreign_store", "store_id" to storeId, "local_store_id" to result.localStoreId)
                current.value = TabletStartupState(userId, storeId, result)
                if (result is AdoptionState.Ready) {
                    // An empty replica verifies trivially; recording that would let the first
                    // real pull land behind evidence the sweep never earned.
                    if (sweptStoreId == storeId) evidence.write(AdoptionEvidence(storeId, adopted.deviceId))
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
        online.collect { connected -> if (connected) reattempt() }
    }

    /**
     * Connectivity arriving is only one way to get stuck. A request that failed while the network
     * was already up has no reconnection to wait for, so attempts also run on a backoff timer. The
     * till heals itself; the gate's button skips the wait rather than being the only way out.
     */
    private suspend fun healWhileUnverified() {
        var attempt = 0
        while (currentCoroutineContext().isActive) {
            if (synchronized(monitor) { !current.value.awaitingVerification() }) {
                attempt = 0
                current.first { it.awaitingVerification() }
                continue
            }
            val wait = retryDelays[minOf(attempt, retryDelays.lastIndex)]
            attempt++
            val due = System.currentTimeMillis() + wait
            synchronized(monitor) {
                if (current.value.awaitingVerification()) current.value = current.value.copy(nextRetryAt = due)
            }
            delay(wait)
            reattempt()
        }
    }

    /**
     * Re-runs adoption only for a live session that is still waiting on verification. Serialised:
     * two triggers firing together would otherwise queue a second attempt that lands after the
     * first succeeded and tears down the SyncManager it just started.
     */
    private suspend fun reattempt() = retryMutex.withLock {
        val stale = synchronized(monitor) { current.value.takeIf { it.awaitingVerification() } } ?: return@withLock
        val userId = stale.userId ?: return@withLock
        val storeId = stale.storeId ?: return@withLock
        Telemetry.event("adoption_retry", "store_id" to storeId)
        try {
            adopt(userId, storeId)
        } catch (ended: CancellationException) {
            // adopt() cancels itself when the session moves on; only propagate our own cancellation.
            currentCoroutineContext().ensureActive()
        }
    }

    /**
     * The full sweep pages the entire orders table back with no cursor to resolve every reference —
     * 104 seconds on a real store, paid on every launch. It is a one-time integrity gate, so once a
     * store has passed it later launches verify a bounded sample through indexed lookups instead.
     *
     * This is narrower than the sweep, deliberately: it detects a replica that belongs to a
     * different dataset, which is what the gate exists for, at a cost a till can pay while a queue
     * is waiting. A reference the sample does not reach is left to sync to reconcile.
     */
    private suspend fun spotCheck(references: List<ServerReference>, storeId: String): ServerReferenceVerification? {
        val live = references.filter { it.table == "orders" && it.localStatus != "deleted" }
        // Nothing live to sample is not evidence of anything: let the caller run the full sweep.
        if (live.isEmpty()) return null
        // References arrive in rowid order, so the tail is the newest and always worth checking.
        // The rest are drawn fresh each launch, so repeated launches accumulate coverage rather
        // than re-checking one fixed set and letting the same rows escape forever.
        val sample = (listOf(live.last()) + live.shuffled().take(SPOT_CHECK_SAMPLE - 1)).distinct()
        for (reference in sample) {
            currentCoroutineContext().ensureActive()
            val result = http.query("orders:get", buildJsonObject { put("orderId", reference.serverId) })
            if (result == JsonNull) return ServerReferenceVerification.Missing
            val order = result.jsonObject
            if (order["_id"]?.jsonPrimitive?.content != reference.serverId ||
                order["storeId"]?.jsonPrimitive?.content != storeId
            ) {
                return ServerReferenceVerification.Missing
            }
        }
        return ServerReferenceVerification.Verified
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
        val tablet = deviceId
        if (tablet != null && evidence.read() == AdoptionEvidence(storeId, tablet)) {
            // The spot check is an optimisation, never a new way to fail. A Missing verdict is real
            // evidence and is returned; anything else falls through to the full sweep, so the worst
            // case is the behaviour we already had rather than a till that cannot open.
            val quick =
                try {
                    spotCheck(references, storeId)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    Telemetry.nonFatal("adoption.spot_check", failure)
                    null
                }
            if (quick != null) return quick
        }
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
        // Past this point the sweep has genuinely run against real references, which is what the
        // evidence written after a Ready result attests to.
        sweptStoreId = storeId
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
