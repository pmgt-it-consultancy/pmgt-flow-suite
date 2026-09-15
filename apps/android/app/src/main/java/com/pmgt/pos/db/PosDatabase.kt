package com.pmgt.pos.db

import app.cash.sqldelight.TransacterImpl
import app.cash.sqldelight.db.QueryResult
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.db.SqlPreparedStatement
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.*

/**
 * Synchronous storage boundary. Call on an injected IO dispatcher; transaction callbacks must
 * never suspend. The monitor serializes callers and keeps each snapshot/transaction consistent.
 * Feature repositories map these transport-shaped rows into domain models.
 */
class PosDatabase(private val driver: SqlDriver) : AutoCloseable {
    private val transacter = object : TransacterImpl(driver) {}
    private val invalidations = MutableStateFlow(0L)
    val changes: StateFlow<Long> = invalidations.asStateFlow()
    private var depth = 0
    private var dirty = false

    @Synchronized
    fun <T> transaction(block: () -> T): T {
        val outer = depth == 0
        if (outer) dirty = false
        depth++
        try {
            return transacter.transactionWithResult {
                if (outer) afterCommit { if (dirty) invalidations.value += 1 }
                block()
            }
        } finally {
            depth--
            if (outer) dirty = false
        }
    }

    @Synchronized
    fun get(table: String, id: String): Row? = select(table, "id = ?", listOf(id), limit = 1).firstOrNull()

    @Synchronized
    fun select(table: String, where: String = "1", args: List<Any?> = emptyList(), orderBy: String = "", limit: Int? = null): List<Row> {
        val columns = columns(table)
        val names = listOf("id", "_changed", "_status") + columns.map { it.name }
        val sql = selectSql(table, where, orderBy, limit)
        return driver.executeQuery(null, sql, { cursor ->
            val result = mutableListOf<Row>()
            while (cursor.next().value) {
                result += JsonObject(names.mapIndexed { index, name ->
                    val type = columns.getOrNull(index - 3)?.type
                    name to when {
                        cursor.getString(index) == null -> JsonNull
                        type == "number" -> JsonPrimitive(cursor.getDouble(index))
                        type == "boolean" -> JsonPrimitive(cursor.getLong(index) == 1L)
                        else -> JsonPrimitive(cursor.getString(index))
                    }
                }.toMap())
            }
            QueryResult.Value(result)
        }, args.size) { bind(args) }.value
    }

    /** Same validated query and bindings as select; diagnostics never execute arbitrary SQL. */
    @Synchronized
    fun explainSelect(table: String, where: String = "1", args: List<Any?> = emptyList(), orderBy: String = "", limit: Int? = null): List<String> =
        driver.executeQuery(null, "EXPLAIN QUERY PLAN " + selectSql(table, where, orderBy, limit), { cursor ->
            val rows = mutableListOf<String>()
            while (cursor.next().value) rows += cursor.getString(3).orEmpty()
            QueryResult.Value(rows)
        }, args.size) { bind(args) }.value

    /** Additive access paths only; caller must have passed adoption and run on IO. */
    @Synchronized
    fun prepareBrowseIndexes(): Unit = transaction {
        driver.execute(null, "CREATE INDEX IF NOT EXISTS kotlin_orders_store_status_created ON orders(store_id,status,created_at DESC,id)", 0)
        driver.execute(null, "CREATE INDEX IF NOT EXISTS kotlin_orders_store_created ON orders(store_id,created_at DESC,id)", 0)
        driver.execute(null, "CREATE INDEX IF NOT EXISTS kotlin_tables_store_active_sort ON tables(store_id,is_active,sort_order)", 0)
    }

    /** Additive request lookup only; not a uniqueness guarantee. */
    @Synchronized
    fun prepareOrderIndexes(): Unit = transaction {
        driver.execute(null, "CREATE INDEX IF NOT EXISTS kotlin_orders_request_id ON orders(request_id)", 0)
    }

    private fun selectSql(table: String, where: String, orderBy: String, limit: Int?): String {
        val names = listOf("id", "_changed", "_status") + columns(table).map { it.name }
        checkPredicate(where, names.toSet())
        val ordering = if (orderBy.isBlank()) "" else {
            require(orderBy.split(',').all { part ->
                val words = part.trim().split(Regex("\\s+"))
                words.first() in names && (words.size == 1 || words.size == 2 && words[1].uppercase() in setOf("ASC", "DESC"))
            }) { "Unsupported order expression" }
            " ORDER BY $orderBy"
        }
        require(limit == null || limit >= 0) { "Invalid limit" }
        return "SELECT ${names.joinToString { "\"$it\"" }} FROM \"$table\" WHERE $where$ordering${limit?.let { " LIMIT $it" }.orEmpty()}"
    }

    @Synchronized
    fun insertLocal(table: String, row: Row): Unit = transaction {
        val id = requireId(row)
        val existing = get(table, id)
        require(existing == null || existing.string("_status") == "deleted") { "Local row already exists" }
        val normalized = normalize(table, row)
        val changed = row.keys.filter { it !in metadata }.joinToString(",")
        put(table, JsonObject(normalized + mapOf("_status" to JsonPrimitive("created"), "_changed" to JsonPrimitive(changed))))
        bumpRevision(table, id)
    }

    @Synchronized
    fun updateLocal(table: String, id: String, changes: Row): Unit = transaction {
        require(changes.keys.none { it in metadata }) { "Sync metadata is managed by storage" }
        validateFields(table, changes)
        val current = requireNotNull(get(table, id)) { "Local row does not exist" }
        val actuallyChanged = changes.keys.filter { current[it] != changes[it] }
        if (actuallyChanged.isNotEmpty()) {
            val changed = current.string("_changed").orEmpty().split(',').filter { it.isNotBlank() }.toSet() + actuallyChanged
            put(table, JsonObject(current + changes + mapOf(
                "_status" to JsonPrimitive(if (current.string("_status") == "created") "created" else "updated"),
                "_changed" to JsonPrimitive(changed.joinToString(",")),
            )))
            bumpRevision(table, id)
        }
    }

    @Synchronized
    fun deleteLocal(table: String, id: String): Unit = transaction {
        get(table, id)?.let { current ->
            if (current.string("_status") != "deleted") {
                put(table, JsonObject(current + ("_status" to JsonPrimitive("deleted"))))
                bumpRevision(table, id)
            }
        }
    }

    @Synchronized
    fun applyRemote(table: String, created: List<Row>, updated: List<Row>, deleted: List<String>): Unit = transaction {
        columns(table)
        for (remote in created + updated) {
            val id = requireId(remote)
            validateFields(table, remote)
            val local = get(table, id)
            if (local?.string("_status") == "deleted") continue
            val result = if (local == null) normalize(table, remote) else {
                val protected = local.string("_changed").orEmpty().split(',').toSet()
                JsonObject(local + remote.filterKeys { it !in protected && it !in metadata })
            }
            val status = when (local?.string("_status")) {
                "created" -> "updated" // Server already knows this client ID.
                "updated" -> "updated"
                else -> "synced"
            }
            val merged = JsonObject(result + mapOf("_status" to JsonPrimitive(status), "_changed" to JsonPrimitive(local?.string("_changed").orEmpty())))
            if (merged != local) put(table, merged)
        }
        for (id in deleted) {
            val local = get(table, id) ?: continue
            if (local.string("_status") !in setOf("created", "updated", "deleted")) remove(table, id)
        }
    }

    @Synchronized
    fun pendingChanges(): ChangeSnapshot = transaction {
        val deletedRows = linkedMapOf<String, Map<String, DeletedRowSnapshot>>()
        val buckets = buildJsonObject {
            for (table in LegacyTables.tables.keys - LegacyTables.localOnly) {
                val pending = select(table, "_status IN ('created','updated','deleted')")
                val deleted = pending.filter { it.string("_status") == "deleted" }
                deletedRows[table] = deleted.associate { row ->
                    val id = requireId(row)
                    id to DeletedRowSnapshot(row, revision(table, id))
                }
                put(table, buildJsonObject {
                    put("created", JsonArray(pending.filter { it.string("_status") == "created" }))
                    put("updated", JsonArray(pending.filter { it.string("_status") == "updated" }))
                    put("deleted", JsonArray(deleted.map { JsonPrimitive(requireId(it)) }))
                })
            }
        }
        ChangeSnapshot(buckets, deletedRows)
    }

    @Synchronized
    fun acknowledge(snapshot: ChangeSnapshot, rejected: Set<Pair<String, String>>): Unit = transaction {
        for ((table, bucket) in snapshot.changes) {
            require(table !in LegacyTables.localOnly) { "Cannot acknowledge local-only data" }
            columns(table)
            val changes = bucket.jsonObject
            for (kind in listOf("created", "updated")) {
                for (sent in changes[kind]?.jsonArray.orEmpty()) {
                    val row = sent.jsonObject
                    val id = requireId(row)
                    if ((table to id) !in rejected && get(table, id) == row) {
                        put(table, JsonObject(row + mapOf("_status" to JsonPrimitive("synced"), "_changed" to JsonPrimitive(""))))
                    }
                }
            }
            for (sent in changes["deleted"]?.jsonArray.orEmpty()) {
                val id = sent.jsonPrimitive.content
                val evidence = snapshot.deletedRows[table]?.get(id) ?: continue
                val current = get(table, id)
                if ((table to id) !in rejected && current?.string("_status") == "deleted" && current == evidence.row && revision(table, id) == evidence.revision) {
                    remove(table, id)
                    // Never delete revision history: ID reuse must remain distinguishable after restart.
                }
            }
        }
    }

    @Synchronized
    fun pendingCount(): Int = (LegacyTables.tables.keys - LegacyTables.localOnly).sumOf { table ->
        driver.executeQuery(null, "SELECT COUNT(*) FROM \"$table\" WHERE _status IN ('created','updated','deleted')", { cursor ->
            cursor.next()
            QueryResult.Value(cursor.getLong(0)!!.toInt())
        }, 0).value
    }

    @Synchronized
    fun localValue(key: String): String? = driver.executeQuery(null, "SELECT value FROM local_storage WHERE key = ?", { cursor ->
        QueryResult.Value(if (cursor.next().value) cursor.getString(0) else null)
    }, 1) { bindString(0, key) }.value

    @Synchronized
    fun setLocalValue(key: String, value: String): Unit = transaction {
        if (localValue(key) != value) {
            driver.execute(null, "INSERT OR REPLACE INTO local_storage(key,value) VALUES (?,?)", 2) {
                bindString(0, key); bindString(1, value)
            }
            dirty = true
        }
    }

    @Synchronized override fun close() = driver.close()

    @Synchronized fun integrity(): AdoptionIntegrity = transaction { LegacyIntegrity.inspect(driver) }

    private fun columns(table: String) = requireNotNull(LegacyTables.tables[table]) { "Unknown local table" }
    private fun requireId(row: Row) = requireNotNull(row.string("id")?.takeIf { it.isNotBlank() }) { "Row ID is required" }

    private fun normalize(table: String, row: Row): Row {
        validateFields(table, row)
        return JsonObject(buildMap {
            put("id", JsonPrimitive(requireId(row)))
            put("_changed", JsonPrimitive(""))
            put("_status", JsonPrimitive("synced"))
            for (c in columns(table)) put(c.name, if (c.optional) JsonNull else when (c.type) {
                "number" -> JsonPrimitive(0.0)
                "boolean" -> JsonPrimitive(false)
                else -> JsonPrimitive("")
            })
            putAll(row)
        })
    }

    private fun validateFields(table: String, row: Row) {
        val fields = columns(table).associateBy { it.name }
        require(row.keys.all { it in fields || it in metadata }) { "Unknown local column" }
        for ((name, value) in row) {
            require(value is JsonPrimitive) { "Local columns require scalar values" }
            if (value == JsonNull) continue
            val primitive = value.jsonPrimitive
            require(when (fields[name]?.type) {
                "number" -> !primitive.isString && primitive.doubleOrNull?.isFinite() == true
                "boolean" -> !primitive.isString && primitive.booleanOrNull != null
                else -> primitive.isString
            }) { "Invalid local column value type" }
        }
    }

    private fun put(table: String, row: Row) {
        validateFields(table, row)
        // Model updates must retain SQLite rowid/query order, as the RN adapter's UPDATE does.
        // REPLACE deletes/reinserts text-PK rows, changing cart order and binary64 fold order.
        // Keep this inside the caller's existing serialized transaction; compatible with API26.
        val existing = get(table, requireId(row)) != null
        val names = if (existing) row.keys.filter { it != "id" } + "id" else row.keys.toList()
        val sql = if (existing) {
            "UPDATE \"$table\" SET ${names.dropLast(1).joinToString { "\"$it\" = ?" }} WHERE id = ?"
        } else {
            "INSERT INTO \"$table\" (${names.joinToString { "\"$it\"" }}) VALUES (${names.joinToString { "?" }})"
        }
        driver.execute(null, sql, names.size) {
            names.forEachIndexed { i, key ->
                val value = row[key]!!.jsonPrimitive
                when {
                    value == JsonNull -> bindString(i, null)
                    value.isString -> bindString(i, value.content)
                    value.booleanOrNull != null -> bindLong(i, if (value.boolean) 1 else 0)
                    else -> bindDouble(i, value.double)
                }
            }
        }
        dirty = true
    }

    private fun remove(table: String, id: String) {
        driver.execute(null, "DELETE FROM \"$table\" WHERE id = ?", 1) { bindString(0, id) }
        dirty = true
    }

    private fun revision(table: String, id: String): Long = localValue("__kotlin_revision.$table.$id")?.toLong() ?: 0L
    private fun bumpRevision(table: String, id: String) = setLocalValue("__kotlin_revision.$table.$id", Math.addExact(revision(table, id), 1L).toString())

    private fun SqlPreparedStatement.bind(args: List<Any?>) = args.forEachIndexed { index, value ->
        when (value) {
            null -> bindString(index, null)
            is String -> bindString(index, value)
            is Boolean -> bindLong(index, if (value) 1 else 0)
            is Int -> bindLong(index, value.toLong())
            is Long -> bindLong(index, value)
            is Double -> bindDouble(index, value)
            else -> error("Unsupported query argument")
        }
    }

    private fun checkPredicate(where: String, columns: Set<String>) {
        val tokens = Regex("'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\\.[0-9]+)?|[?(),=<>!+*/% -]+|\\s+")
        var end = 0
        for (match in tokens.findAll(where)) {
            require(match.range.first == end) { "Unsupported query expression" }
            val token = match.value
            if (token.first().isLetter() || token.first() == '_') {
                require(token in columns || token.uppercase() in setOf("AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE", "BETWEEN", "TRUE", "FALSE")) { "Unknown query identifier" }
            }
            require(!token.contains("--") && !token.contains("/*") && !token.contains("*/")) { "Unsupported query expression" }
            end = match.range.last + 1
        }
        require(end == where.length && where.isNotBlank()) { "Unsupported query expression" }
    }

    private companion object { val metadata = setOf("id", "_status", "_changed") }
}
