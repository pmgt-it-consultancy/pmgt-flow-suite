package com.pmgt.pos.sync

import com.pmgt.pos.db.*
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import java.time.LocalDate

private val counterKey = Regex("orderCounter\\.(dine_in|takeout)\\.(\\d{4}-\\d{2}-\\d{2})")

/** These rows are device bookkeeping, written only by RN orderNumber.ts. Never acknowledge them. */
private fun isDeviceCounter(table: String, row: JsonObject): Boolean {
    if (table != "app_config") return false
    val match = counterKey.matchEntire(row.string("key").orEmpty()) ?: return false
    return runCatching { LocalDate.parse(match.groupValues[2]) }.isSuccess
}

internal fun ChangeSnapshot.forDelivery(): ChangeSnapshot {
    val retainedDeletes = mutableMapOf<String, Map<String, DeletedRowSnapshot>>()
    val retained = changes.mapNotNull { (table, value) ->
        val bucket = syncJson.decodeFromJsonElement<ChangeBucket>(value)
        val filtered = bucket.copy(
            created = bucket.created.filterNot { isDeviceCounter(table, it) },
            updated = bucket.updated.filterNot { isDeviceCounter(table, it) },
            deleted = bucket.deleted.filterNot { id ->
                isDeviceCounter(table, deletedRows[table]?.get(id)?.row ?: error("Missing pending deletion evidence"))
            },
        )
        if (filtered.size == 0) null else {
            retainedDeletes[table] = deletedRows[table].orEmpty().filterKeys { it in filtered.deleted }
            table to syncJson.encodeToJsonElement(filtered)
        }
    }.toMap()
    return ChangeSnapshot(JsonObject(retained), retainedDeletes)
}

internal fun ChangeSnapshot.rowCount(): Int = changes.values.sumOf { syncJson.decodeFromJsonElement<ChangeBucket>(it).size }

/** Complete saved rows (including old parent/deletion evidence) plus current parents resolve scope. */
private fun validateOwnership(db: PosDatabase, snapshot: ChangeSnapshot, storeId: String) {
    val rows = snapshot.changes.mapValues { (table, value) ->
        val bucket = syncJson.decodeFromJsonElement<ChangeBucket>(value)
        bucket.created + bucket.updated + bucket.deleted.map { snapshot.deletedRows.getValue(table).getValue(it).row }
    }
    fun resolvesStore(id: String): Boolean = id == storeId ||
        db.get("stores", id)?.string("server_id") == storeId

    fun candidates(table: String, id: String): List<JsonObject> {
        val saved = rows[table].orEmpty().filter { it.string("id") == id || it.string("server_id") == id }
        val current = db.get(table, id)?.let(::listOf)
            ?: db.select(table, "server_id = ?", listOf(id))
        return (saved + current).distinct()
    }

    fun verify(table: String, row: JsonObject, ancestors: Set<Pair<String, String>>) {
        val key = table to requireNotNull(row.string("id"))
        check(key !in ancestors) { "Unresolved pending ownership" }
        val path = ancestors + key
        var resolved = false
        if ("store_id" in row) {
            check(row.string("store_id")?.takeIf { it.isNotBlank() }?.let(::resolvesStore) == true) { "Pending work belongs to another or unresolved store" }
            resolved = true
        }
        fun parent(parentTable: String, field: String, required: Boolean = true) {
            val id = row.string(field)?.takeIf { it.isNotBlank() }
            if (id == null && !required) return
            check(id != null) { "Pending parent reference is missing" }
            val parents = candidates(parentTable, id)
            check(parents.isNotEmpty()) { "Pending parent cannot be resolved" }
            parents.forEach { verify(parentTable, it, path) }
            resolved = true
        }
        when (table) {
            "order_items" -> parent("orders", "order_id")
            "order_item_modifiers" -> parent("order_items", "order_item_id")
            "order_discounts", "order_voids", "order_payments" -> {
                parent("orders", "order_id")
                parent("order_items", "order_item_id", required = false)
            }
            "stores" -> {
                check(row.string("id") == storeId || row.string("server_id") == storeId) { "Pending store cannot be resolved" }
                resolved = true
            }
        }
        check(resolved) { "Pending ownership cannot be resolved" }
    }
    rows.forEach { (table, pending) -> pending.forEach { verify(table, it, emptySet()) } }
}

internal data class PendingWork(val current: ChangeSnapshot, val saved: SavedPush?)

/** Caller runs on IO. Read/validate one consistent view; never rewrite scope or old snapshot data. */
internal fun pendingWork(db: PosDatabase, storeId: String, deviceId: String): PendingWork = db.transaction {
    try {
        val current = db.pendingChanges().forDelivery()
        validateOwnership(db, current, storeId)
        val saved = db.localValue(SAVED_PUSH_KEY)?.takeIf { it.isNotEmpty() }?.let {
            syncJson.decodeFromString<SavedPush>(it).also { push ->
                push.validate(storeId, deviceId)
                validateOwnership(db, push.snapshot.forDelivery(), storeId)
            }
        }
        PendingWork(current, saved)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (failure: Exception) {
        // Seven ownership checks, every SavedPush check and any decode error share this one
        // sentence, because none of them is actionable by a cashier. The cause is retained so
        // support can tell which of them fired.
        throw AdoptionBlocked(
            "Pending work has invalid data or unresolved store ownership. Tablet data is preserved; repair is required before continuing.",
            failure,
        )
    }
}
