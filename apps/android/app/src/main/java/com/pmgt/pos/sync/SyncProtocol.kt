package com.pmgt.pos.sync

import com.pmgt.pos.db.ChangeSnapshot
import com.pmgt.pos.db.LegacyTables
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

enum class SyncStatus { Idle, Syncing, Offline, Error }
enum class SyncPhase { Pull, Apply, Push }
data class SyncProgress(
    val phase: SyncPhase,
    val pageIndex: Int,
    val rowsApplied: Int = 0,
    val currentTable: String? = null,
    val tablesApplied: Map<String, Int> = emptyMap(),
)
data class SyncState(
    val status: SyncStatus = SyncStatus.Idle,
    val lastPulledAt: Long? = null,
    val lastPushedAt: Long? = null,
    val lastError: String? = null,
    val progress: SyncProgress? = null,
)
sealed interface SyncOutcome {
    data class Delivered(val observedAt: Long) : SyncOutcome
    data object Offline : SyncOutcome
    data class Backoff(val retryAt: Long) : SyncOutcome
    data class Pending(val count: Int) : SyncOutcome
    data class Failed(val message: String) : SyncOutcome
}
sealed interface ResyncResult {
    data object Ready : ResyncResult
    data class Unavailable(val reason: Reason) : ResyncResult
    enum class Reason { Offline, Syncing, Pending, Failed }
}

@Serializable internal data class TableCursor(val cursor: String?, val isDone: Boolean)
@Serializable internal data class ChangeBucket(
    val created: List<JsonObject> = emptyList(),
    val updated: List<JsonObject> = emptyList(),
    val deleted: List<String> = emptyList(),
) { val size: Int get() = created.size + updated.size + deleted.size }
@Serializable internal data class PullPage(
    val changes: Map<String, ChangeBucket>,
    val cursors: Map<String, TableCursor>,
    val complete: Boolean,
    val timestamp: Long,
)
@Serializable internal data class SavedPush(
    val storeId: String,
    val deviceId: String,
    val snapshot: ChangeSnapshot,
    val lastPulledAt: Long,
    val clientMutationId: String,
)

internal const val SAVED_PUSH_KEY = "__kotlin_sync_retry_v1"

/** Reject unreadable/incomplete retry evidence before a request or startup readiness is allowed. */
internal fun SavedPush.validate(store: String, device: String) {
    check(storeId == store && deviceId == device && clientMutationId.isNotBlank() && lastPulledAt > 1)
    var count = 0
    for ((table, value) in snapshot.changes) {
        check(table !in LegacyTables.localOnly)
        val fields = LegacyTables.tables.getValue(table).map { it.name }.toSet() + setOf("id", "_status", "_changed")
        val bucket = syncJson.decodeFromJsonElement<ChangeBucket>(value)
        fun verifyRow(row: JsonObject, status: String) {
            check(row.keys == fields)
            check(!row.getValue("id").jsonPrimitive.content.isBlank())
            check(row.getValue("_status").jsonPrimitive.content == status)
            check(row.getValue("_changed").jsonPrimitive.content.split(',').filter { it.isNotBlank() }.all { it in fields })
        }
        bucket.created.forEach { verifyRow(it, "created") }
        bucket.updated.forEach { verifyRow(it, "updated") }
        bucket.deleted.forEach { id ->
            val evidence = snapshot.deletedRows[table]?.get(id) ?: error("Missing pending deletion evidence")
            check(evidence.revision >= 0 && evidence.row["id"]?.jsonPrimitive?.content == id)
            verifyRow(evidence.row, "deleted")
        }
        count += bucket.size
    }
    check(count > 0)
}

internal val syncJson = Json { ignoreUnknownKeys = true }
internal fun snake(name: String) = name.replace(Regex("[A-Z]")) { "_${it.value.lowercase()}" }
internal fun camel(name: String) = name.replace(Regex("_([a-z])")) { it.groupValues[1].uppercase() }
internal fun translateRow(row: JsonObject, name: (String) -> String) = JsonObject(
    row.filterKeys { !it.startsWith('_') }.mapKeys { if (it.key == "id") "id" else name(it.key) }
)
internal fun wireChanges(changes: JsonObject): JsonObject = JsonObject(changes.map { (table, value) ->
    val bucket = syncJson.decodeFromJsonElement<ChangeBucket>(value)
    camel(table) to syncJson.encodeToJsonElement(bucket.copy(
        created = bucket.created.map { translateRow(it, ::camel) },
        updated = bucket.updated.map { translateRow(it, ::camel) },
    ))
}.toMap())

/** Bounded cursor memory, without limiting the number of progressing pages. */
internal class PullCursor {
    var cursors: Map<String, TableCursor>? = null
        private set
    var serverNow: Long? = null
        private set
    private val recent = ArrayDeque<String>().apply { add("[]") }
    fun accept(page: PullPage) {
        require(page.timestamp > 1) { "Invalid sync timestamp" }
        if (!page.complete) {
            val signature = JsonArray(page.cursors.toSortedMap().map { (table, cursor) ->
                buildJsonArray { add(table); add(cursor.cursor?.let(::JsonPrimitive) ?: JsonNull); add(cursor.isDone) }
            }).toString()
            check(signature !in recent) { "Sync pull repeated a recent pagination cursor" }
            recent.addLast(signature)
            if (recent.size > 50) recent.removeFirst()
        }
        if (serverNow == null) serverNow = page.timestamp
        cursors = page.cursors
    }
}

internal suspend fun ConvexHttp.pull(since: Long?, cursor: PullCursor): PullPage =
    syncJson.decodeFromJsonElement(httpAction("/sync/pull", buildJsonObject {
        put("lastPulledAt", since?.let(::JsonPrimitive) ?: JsonNull)
        cursor.cursors?.let { put("cursors", syncJson.encodeToJsonElement(it)) }
        cursor.serverNow?.let { put("serverNow", it) }
    }))
