package com.pmgt.pos.sync

import com.pmgt.pos.db.PosDatabase
import com.pmgt.pos.telemetry.Telemetry
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import java.util.UUID

/** One v1 coordinator per adopted database, sharing the application's authenticated transport. */
class SyncManager(
    private val db: PosDatabase,
    private val http: ConvexHttp,
    private val deviceId: String,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher,
    private val online: StateFlow<Boolean>,
    private val now: () -> Long = System::currentTimeMillis,
    private val sessionIsCurrent: () -> Boolean = { true },
    private val onBlocked: (com.pmgt.pos.db.AdoptionBlocked) -> Unit = {},
) {
    private val monitor = Any()
    private val current = MutableStateFlow(SyncState())
    val state: StateFlow<SyncState> = current.asStateFlow()
    private val code = MutableStateFlow("")
    val deviceCode: StateFlow<String> = code.asStateFlow()
    @Volatile private var session: Session? = null

    private class Session(val storeId: String, parent: CoroutineScope) {
        val job = SupervisorJob(parent.coroutineContext[Job])
        val scope = CoroutineScope(parent.coroutineContext + job)
        var pending = false
        var flight: Deferred<Unit>? = null
        var debounce: Job? = null
        var retry: Job? = null
        var retryAt: Long? = null
        var attempt = 0
        var registered = false
        var resyncing = false
        var blocked: String? = null
    }

    suspend fun start(storeId: String) {
        require(storeId.isNotBlank() && deviceId.isNotBlank())
        synchronized(monitor) {
            if (session?.let { it.storeId == storeId && it.job.isActive && it.blocked == null } == true) return
            stop()
            val active = Session(storeId, scope)
            session = active
            current.value = SyncState(status = if (online.value) SyncStatus.Idle else SyncStatus.Offline)
            active.scope.launch {
                online.collect { connected ->
                    synchronized(monitor) {
                        if (session !== active) return@collect
                        if (connected) request(active)
                        else {
                            active.pending = true
                            active.flight?.cancel()
                            active.retry?.cancel(); active.retry = null; active.retryAt = null
                            current.value = current.value.copy(status = SyncStatus.Offline, progress = null)
                        }
                    }
                }
            }
            active.scope.launch {
                while (isActive) { delay(60_000); synchronized(monitor) { request(active) } }
            }
        }
    }

    fun stop() = synchronized(monitor) {
        session?.job?.cancel()
        session = null
        code.value = ""
        current.value = SyncState()
    }

    fun triggerPush() = synchronized(monitor) {
        val active = session ?: return
        active.pending = true
        active.debounce?.cancel()
        active.debounce = active.scope.launch {
            delay(500)
            synchronized(monitor) { request(active) }
        }
    }

    suspend fun syncNow() {
        val flight = synchronized(monitor) { session?.let { request(it) } }
        flight?.await()
    }

    suspend fun syncForDelivery(): SyncOutcome {
        val active = synchronized(monitor) { session } ?: return SyncOutcome.Failed("Sync manager is not started")
        synchronized(monitor) {
            if (!online.value) return SyncOutcome.Offline
            active.retryAt?.let { return SyncOutcome.Backoff(it) }
        }
        syncNow()
        return delivery(active)
    }

    suspend fun forceFullResync(): ResyncResult {
        val active = synchronized(monitor) {
            val value = session
            if (value == null || !online.value) return ResyncResult.Unavailable(ResyncResult.Reason.Offline)
            if (value.flight != null || value.resyncing) return ResyncResult.Unavailable(ResyncResult.Reason.Syncing)
            value.resyncing = true
            value
        }
        try {
            when (syncForDelivery()) {
                is SyncOutcome.Delivered -> Unit
                is SyncOutcome.Offline -> return ResyncResult.Unavailable(ResyncResult.Reason.Offline)
                is SyncOutcome.Pending -> return ResyncResult.Unavailable(ResyncResult.Reason.Pending)
                else -> return ResyncResult.Unavailable(ResyncResult.Reason.Failed)
            }
            val reset = database(active) {
                db.transaction {
                    if (pendingWork(db, active.storeId, deviceId).current.rowCount() != 0 || !db.localValue(SAVED_PUSH_KEY).isNullOrEmpty()) false
                    else { db.setLocalValue(WATERMARK, "0"); true }
                }
            }
            if (!reset) return ResyncResult.Unavailable(ResyncResult.Reason.Pending)
            syncNow()
            return if (delivery(active) is SyncOutcome.Delivered) ResyncResult.Ready
                else ResyncResult.Unavailable(ResyncResult.Reason.Failed)
        } catch (blocked: com.pmgt.pos.db.AdoptionBlocked) {
            quarantine(active, blocked)
            return ResyncResult.Unavailable(ResyncResult.Reason.Failed)
        } finally {
            synchronized(monitor) { active.resyncing = false }
        }
    }

    private suspend fun delivery(active: Session): SyncOutcome {
        active.blocked?.let { return SyncOutcome.Failed(it) }
        if (!online.value) return SyncOutcome.Offline
        checkActive(active)
        current.value.lastError?.let { return SyncOutcome.Failed(it) }
        val count = try {
            database(active) { pendingWork(db, active.storeId, deviceId).current.rowCount() }
        } catch (blocked: com.pmgt.pos.db.AdoptionBlocked) {
            quarantine(active, blocked)
            return SyncOutcome.Failed(blocked.message!!)
        }
        // Naming the server's reason is the difference between a manager who can act and the nine
        // hours this incident went undiagnosed behind "local change(s) are still pending".
        return if (count > 0) SyncOutcome.Pending(count, current.value.refusals.firstOrNull()?.reason)
        else SyncOutcome.Delivered(current.value.lastPulledAt ?: now())
    }

    /** Caller holds monitor. Install lazy work before it can publish state or accept another request. */
    private fun request(active: Session): Deferred<Unit>? {
        if (session !== active || !active.job.isActive || !sessionIsCurrent() || active.blocked != null) return null
        active.pending = true
        active.flight?.let { return it }
        if (!online.value || active.retryAt != null) return null
        return active.scope.async(start = CoroutineStart.LAZY) { drain(active) }.also {
            active.flight = it
            it.start()
        }
    }

    private suspend fun drain(active: Session) {
        val thisJob = currentCoroutineContext()[Job]
        try {
            while (true) {
                val run = synchronized(monitor) {
                    checkActive(active)
                    if (!active.pending || !online.value) {
                        active.flight = null
                        false
                    } else {
                        active.pending = false
                        active.debounce?.cancel(); active.debounce = null
                        true
                    }
                }
                if (!run) return
                try {
                    syncOnce(active)
                    synchronized(monitor) { checkActive(active); active.attempt = 0 }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (blocked: com.pmgt.pos.db.AdoptionBlocked) {
                    quarantine(active, blocked)
                    return
                } catch (failure: Exception) {
                    synchronized(monitor) {
                        checkActive(active)
                        // Once per failure streak: a persistent fault retried every backoff would
                        // crowd every other non-fatal out of Crashlytics' small per-session buffer.
                        if (active.attempt == 0) {
                            val stage = current.value.progress?.phase?.name?.lowercase()
                            Telemetry.nonFatal(
                                "sync." + if (stage != null && !active.registered) "register" else stage ?: "start",
                                failure,
                            )
                        }
                        current.value = current.value.copy(status = SyncStatus.Error, lastError = "Synchronization failed. Pending changes are preserved.", progress = null)
                        val wait = listOf(2_000L, 5_000L, 15_000L, 60_000L)[active.attempt.coerceAtMost(3)]
                        active.attempt = (active.attempt + 1).coerceAtMost(3)
                        active.retryAt = now() + wait
                        active.retry = active.scope.launch {
                            delay(wait)
                            synchronized(monitor) {
                                if (session === active) { active.retryAt = null; active.retry = null; request(active) }
                            }
                        }
                    }
                    return
                }
                yield()
            }
        } finally {
            synchronized(monitor) {
                if (active.flight === thisJob) {
                    active.flight = null
                    if (session === active && active.pending && online.value && active.retryAt == null) request(active)
                }
            }
        }
    }

    private suspend fun syncOnce(active: Session) {
        database(active) { pendingWork(db, active.storeId, deviceId) }
        publish(active) { it.copy(status = SyncStatus.Syncing, progress = SyncProgress(SyncPhase.Pull, 1)) }
        if (!active.registered) {
            val result = http.httpAction("/sync/registerDevice", buildJsonObject { put("deviceId", deviceId); put("storeId", active.storeId) }).jsonObject
            val deviceCode = result["deviceCode"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
                ?: error("Invalid device registration")
            synchronized(monitor) { checkActive(active); active.registered = true; code.value = deviceCode }
        }
        val initial = database(active) { db.localValue(WATERMARK)?.toLongOrNull() }.takeIf { it != null && it > 1 }
        val cursor = PullCursor()
        var index = 1
        var applied = 0
        var lastTable: String? = null
        val tables = linkedMapOf<String, Int>()
        while (true) {
            checkActive(active)
            publish(active) { it.copy(progress = SyncProgress(SyncPhase.Pull, index, applied, lastTable, tables.toMap())) }
            val page = http.pull(initial, cursor)
            checkActive(active)
            cursor.accept(page)
            val mapped = page.changes.mapKeys { snake(it.key) }.mapValues { (table, bucket) ->
                bucket.copy(
                    created = bucket.created.map { projectInboundRow(table, translateRow(it, ::snake)) },
                    updated = bucket.updated.map { projectInboundRow(table, translateRow(it, ::snake)) },
                )
            }
            lastTable = mapped.filterValues { it.size > 0 }.maxByOrNull { it.value.size }?.key
            mapped.forEach { (table, bucket) -> if (bucket.size > 0) tables[table] = (tables[table] ?: 0) + bucket.size }
            applied += mapped.values.sumOf { it.size }
            publish(active) { it.copy(progress = SyncProgress(SyncPhase.Apply, index, applied, lastTable, tables.toMap())) }
            database(active) {
                db.transaction {
                    mapped.forEach { (table, bucket) -> db.applyRemote(table, bucket.created, bucket.updated, bucket.deleted) }
                    db.setLocalValue(WATERMARK, (if (page.complete) cursor.serverNow!! else maxOf(initial ?: 0, 1)).toString())
                }
            }
            if (index == 1) {
                publish(active) { it.copy(progress = SyncProgress(SyncPhase.Push, index, applied, null, tables.toMap())) }
                push(active, cursor.serverNow!!)
            }
            if (page.complete) break
            index++
            yield()
        }
        publish(active) { it.copy(status = SyncStatus.Idle, lastPulledAt = cursor.serverNow, lastError = null, progress = null) }
    }

    private suspend fun push(active: Session, timestamp: Long) {
        val saved = database(active) {
            db.transaction {
                val work = pendingWork(db, active.storeId, deviceId)
                val replay = work.saved?.takeIf { it.snapshot.forDelivery().rowCount() > 0 }
                if (work.saved != null && replay == null) db.setLocalValue(SAVED_PUSH_KEY, "")
                replay ?: work.current.takeIf { it.rowCount() > 0 }
                        ?.let { snapshot ->
                            SavedPush(active.storeId, deviceId, snapshot, timestamp, UUID.randomUUID().toString()).also {
                                db.setLocalValue(SAVED_PUSH_KEY, syncJson.encodeToString(it))
                            }
                        }
            }
        } ?: return
        saved.validate(active.storeId, deviceId)
        val deliverySnapshot = saved.snapshot.forDelivery()
        checkActive(active)
        val response = http.httpAction("/sync/push", buildJsonObject {
            put("lastPulledAt", saved.lastPulledAt)
            put("changes", wireChanges(deliverySnapshot.changes))
            put("clientMutationId", saved.clientMutationId)
        }, mapOf("x-device-id" to deviceId)).jsonObject
        checkActive(active)
        val refused = mutableListOf<Refusal>()
        val rejections = response["rejected"]?.jsonArray
        check(response["success"]?.jsonPrimitive?.booleanOrNull == true || rejections != null) { "Invalid push acknowledgement" }
        rejections?.forEach { item ->
            val rejection = item.jsonObject
            refused += Refusal(
                snake(rejection.getValue("table").jsonPrimitive.content),
                rejection.getValue("clientId").jsonPrimitive.content,
                rejection["reason"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
                    ?: "The server refused this change",
            )
        }
        // v1 ignores these buckets without a rejection. They were not delivered.
        deliverySnapshot.changes.filterKeys { it !in PUSH_TABLES }.forEach { (table, value) ->
            val bucket = syncJson.decodeFromJsonElement<ChangeBucket>(value)
            val unsupported = "This app version does not synchronize $table"
            (bucket.created + bucket.updated).forEach {
                refused += Refusal(table, it.getValue("id").jsonPrimitive.content, unsupported)
            }
            bucket.deleted.forEach { refused += Refusal(table, it, unsupported) }
        }
        val rejected = refused.mapTo(mutableSetOf()) { it.table to it.id }
        database(active) {
            db.transaction {
                db.acknowledge(deliverySnapshot, rejected)
                db.setLocalValue(SAVED_PUSH_KEY, "")
            }
        }
        if (refused.isNotEmpty()) {
            // One report per push, naming tables and reasons only: enough to find the cause without
            // putting order numbers or amounts into telemetry.
            Telemetry.nonFatal(
                "sync.push_refused",
                PushRefused(refused.distinctBy { it.table to it.reason }.joinToString("; ") { "${it.table}: ${it.reason}" }),
            )
        }
        // A refusal is reported, not thrown. The refused rows are real work the till still owes the
        // server, so they stay in the queue and are offered again on the next cycle: once the server
        // stops refusing them they deliver themselves, with nothing written off. Throwing here
        // instead abandoned the rest of the cycle — the remaining pull pages were never fetched —
        // and drove a backoff retry as if the network had failed, which it had not.
        publish(active) { it.copy(lastPushedAt = now(), refusals = refused) }
    }

    private fun checkActive(active: Session) {
        if (session !== active || !active.job.isActive || !sessionIsCurrent()) throw CancellationException("Sync session stopped")
        if (!online.value) throw CancellationException("Sync session offline")
    }

    private fun quarantine(active: Session, blocked: com.pmgt.pos.db.AdoptionBlocked) {
        val message = blocked.message!!
        synchronized(monitor) {
            if (session !== active) return
            if (active.blocked == null) Telemetry.nonFatal("sync.adoption_blocked", blocked)
            active.blocked = message
            active.pending = false
            current.value = current.value.copy(status = SyncStatus.Error, lastError = message, progress = null)
            active.job.children.filter { it !== active.flight }.forEach { it.cancel() }
            // Finish the shared flight normally so delivery callers receive a typed failure.
            active.flight?.invokeOnCompletion { active.job.cancel() } ?: active.job.cancel()
        }
        onBlocked(blocked)
    }

    /** Serialize session invalidation with commits: a stopped generation cannot acknowledge later. */
    private suspend fun <T> database(active: Session, block: () -> T): T = withContext(io) {
        ensureActive()
        synchronized(monitor) { checkActive(active); block() }
    }
    private fun publish(active: Session, transform: (SyncState) -> SyncState) = synchronized(monitor) {
        checkActive(active)
        current.value = transform(current.value)
    }

    private companion object {
        const val WATERMARK = "__watermelon_last_pulled_at"
        val PUSH_TABLES = setOf("orders", "tables", "order_items", "order_item_modifiers", "order_discounts", "order_payments", "order_voids", "audit_logs")
    }
}
