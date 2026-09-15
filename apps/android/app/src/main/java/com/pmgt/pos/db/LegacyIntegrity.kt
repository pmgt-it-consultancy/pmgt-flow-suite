package com.pmgt.pos.db

import app.cash.sqldelight.db.QueryResult
import app.cash.sqldelight.db.SqlDriver

data class ServerReference(val table: String, val localId: String, val serverId: String, val localStatus: String)

data class AdoptionIntegrity(
    val rowCounts: Map<String, Long>,
    val pendingCounts: Map<String, Long>,
    val localValues: Map<String, String>,
    val serverReferences: List<ServerReference>,
)

/** Pure read-only validation, also used BEFORE Android's mutating open-helper constructor. */
object LegacyIntegrity {
    internal val validStatuses = setOf("synced", "created", "updated", "deleted", "disposable")

    fun inspect(driver: SqlDriver): AdoptionIntegrity = inspect { sql ->
        // Each probe specifies its width. SQLite has no driver-independent columnCount API.
        val width = when {
            sql.startsWith("PRAGMA table_info") -> 6
            sql.startsWith("SELECT id, server_id") -> 3
            sql.startsWith("SELECT key, value") -> 2
            else -> 1
        }
        driver.executeQuery(null, sql, { cursor ->
            val rows = mutableListOf<List<String?>>()
            while (cursor.next().value) rows += (0 until width).map(cursor::getString)
            QueryResult.Value(rows)
        }, 0).value
    }

    internal fun inspect(query: (String) -> List<List<String?>>): AdoptionIntegrity {
        fun requireSafe(condition: Boolean, message: String) {
            if (!condition) throw AdoptionBlocked(message)
        }
        fun scalar(sql: String) = query(sql).single().single()
        requireSafe(scalar("PRAGMA quick_check") == "ok", "Local database integrity check failed. Restore or repair the existing database before continuing.")
        requireSafe(scalar("PRAGMA user_version")?.toIntOrNull() == LegacyTables.version,
            "Unsupported local schema version. Open the tablet in the compatible React Native app before upgrading.")
        val actualTables = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map { it.single() }.toSet()
        requireSafe(actualTables == LegacyTables.tables.keys + "local_storage" + (actualTables intersect setOf("android_metadata")), "Unexpected local database tables. Adoption is blocked.")
        val counts = linkedMapOf<String, Long>()
        val pending = linkedMapOf<String, Long>()
        val references = mutableListOf<ServerReference>()
        for ((table, columns) in LegacyTables.tables) {
            val names = listOf("id", "_changed", "_status") + columns.map { it.name }
            val info = query("PRAGMA table_info(\"$table\")")
            requireSafe(info.map { it[1] }.toSet() == names.toSet(), "Unexpected columns in $table. Adoption is blocked.")
            requireSafe(info.all { it[2].isNullOrEmpty() && it[3] == "0" && it[5] == if (it[1] == "id") "1" else "0" }, "Incompatible SQLite column affinity in $table. Adoption is blocked.")
            val invalidMeta = "id IS NULL OR typeof(id) != 'text' OR id = '' OR _status IS NULL OR _status NOT IN ('synced','created','updated','deleted','disposable') OR _changed IS NULL OR typeof(_changed) != 'text'"
            requireSafe(scalar("SELECT COUNT(*) FROM \"$table\" WHERE $invalidMeta") == "0", "Unrecognized local sync markers in $table. Pending work must be repaired before adoption.")
            val changedValues = query("SELECT DISTINCT _changed FROM \"$table\"").map { it.single().orEmpty() }
            requireSafe(changedValues.all { changed -> changed.isEmpty() || changed.split(',').all { it in columns.map { c -> c.name } } }, "Unrecognized changed fields in $table. Adoption is blocked.")
            for (column in columns) {
                val field = "\"${column.name}\""
                val invalid = when (column.type) {
                    "number" -> "typeof($field) NOT IN ('integer','real')"
                    "boolean" -> "typeof($field) != 'integer' OR $field NOT IN (0,1)"
                    else -> "typeof($field) != 'text'"
                }
                requireSafe(scalar("SELECT COUNT(*) FROM \"$table\" WHERE $field IS NOT NULL AND ($invalid)") == "0", "Unconvertible local fields in $table. Adoption is blocked.")
            }
            counts[table] = scalar("SELECT COUNT(*) FROM \"$table\"")!!.toLong()
            pending[table] = scalar("SELECT COUNT(*) FROM \"$table\" WHERE _status IN ('created','updated','deleted')")!!.toLong()
            if (columns.any { it.name == "server_id" }) {
                references += query("SELECT id, server_id, _status FROM \"$table\" WHERE server_id IS NOT NULL AND server_id != ''")
                    .map { ServerReference(table, it[0]!!, it[1]!!, it[2]!!) }
            }
        }
        val storageInfo = query("PRAGMA table_info(\"local_storage\")")
        requireSafe(storageInfo.map { it[1] }.toSet() == setOf("key", "value"), "Incompatible local preference storage.")
        requireSafe(storageInfo.all { it[3] == "1" && it[5] == if (it[1] == "key") "1" else "0" }, "Incompatible local preference constraints.")
        val values = query("SELECT key, value FROM local_storage").associate { it[0]!! to it[1]!! }
        for (key in listOf("__watermelon_last_pulled_at", "__watermelon_last_pulled_schema_version")) {
            requireSafe(values[key] == null || values[key]!!.toLongOrNull()?.let { it >= 0 } == true, "Invalid saved sync cursor. Adoption is blocked.")
        }
        return AdoptionIntegrity(counts, pending, values, references)
    }
}
