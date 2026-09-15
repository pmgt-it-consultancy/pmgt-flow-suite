package com.pmgt.pos.browse

import app.cash.sqldelight.db.*
import com.pmgt.pos.db.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assert.*

/** Executes each production SELECT on actual SQLite, captures the real plan and rows stepped. */
class BrowseRecordingDriver(private val delegate: SqlDriver) : SqlDriver by delegate {
    data class Read(val sql: String, val rows: Int, val plan: List<String>)

    val reads = mutableListOf<Read>()

    override fun <R> executeQuery(
        identifier: Int?,
        sql: String,
        mapper: (SqlCursor) -> QueryResult<R>,
        parameters: Int,
        binders: (SqlPreparedStatement.() -> Unit)?,
    ): QueryResult<R> {
        if (!sql.startsWith("SELECT "))
            return delegate.executeQuery(identifier, sql, mapper, parameters, binders)
        val plan =
            delegate
                .executeQuery(
                    null,
                    "EXPLAIN QUERY PLAN $sql",
                    { cursor ->
                        val result = mutableListOf<String>()
                        while (cursor.next().value) result += cursor.getString(3).orEmpty()
                        QueryResult.Value(result)
                    },
                    parameters,
                    binders,
                )
                .value
        var count = 0
        val result =
            delegate.executeQuery(
                identifier,
                sql,
                { cursor ->
                    mapper(
                        object : SqlCursor by cursor {
                            override fun next(): QueryResult<Boolean> =
                                cursor.next().also { if (it.value) count++ }
                        }
                    )
                },
                parameters,
                binders,
            )
        reads += Read(sql, count, plan)
        return result
    }
}

object BrowseDatabaseContract {
    fun row(id: String, vararg fields: Pair<String, Any?>) = buildJsonObject {
        put("id", id)
        fields.forEach { (key, value) ->
            put(
                key,
                when (value) {
                    null -> JsonNull
                    is Number -> JsonPrimitive(value)
                    is Boolean -> JsonPrimitive(value)
                    else -> JsonPrimitive(value.toString())
                },
            )
        }
    }

    suspend fun verify(driver: SqlDriver) {
        val recorded = BrowseRecordingDriver(driver)
        val db = PosDatabase(recorded)
        db.applyRemote(
            "orders",
            (0 until 5000).map {
                row(
                    "old$it",
                    "store_id" to "s",
                    "status" to "paid",
                    "created_at" to -100,
                    "table_id" to "table",
                )
            } +
                (0 until 120).map {
                    row(
                        "today${it.toString().padStart(3, '0')}",
                        "store_id" to "s",
                        "status" to "paid",
                        "created_at" to it,
                        "customer_name" to if (it < 60) "Kiosk İnez_%" else "other",
                        "table_id" to "table",
                    )
                } +
                listOf(
                    row(
                        "open",
                        "store_id" to "s",
                        "status" to "open",
                        "table_id" to "table",
                        "created_at" to 125,
                    )
                ),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "order_items",
            (0 until 5000).map { row("olditem$it", "order_id" to "old$it", "quantity" to 99) } +
                (0 until 120).map {
                    row(
                        "item$it",
                        "order_id" to "today${it.toString().padStart(3, '0')}",
                        "product_id" to "p",
                        "product_price" to 20,
                        "quantity" to 2,
                    )
                } +
                listOf(row("openitem", "order_id" to "open", "quantity" to 3)),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "tables",
            listOf(row("table", "store_id" to "s", "is_active" to true, "name" to "Table 1")),
            emptyList(),
            emptyList(),
        )
        db.applyRemote("products", listOf(row("p", "name" to "Product")), emptyList(), emptyList())
        val before = db.integrity()
        db.prepareBrowseIndexes()
        db.prepareBrowseIndexes()
        assertEquals(
            before,
            db.integrity(),
        ) // Extra indexes must remain adoption compatible and data-preserving.
        val repo = LocalBrowseRepository(db, Dispatchers.IO)
        recorded.reads.clear()
        assertEquals(1, repo.tables("s").first().single().orders.size)
        assertEquals(
            1,
            recorded.reads.filter { it.sql.contains("FROM \"order_items\"") }.sumOf { it.rows },
        )
        assertTrue(
            recorded.reads
                .flatMap { it.plan }
                .any { it.contains("kotlin_orders_store_status_created") }
        )
        assertTrue(
            recorded.reads
                .flatMap { it.plan }
                .any { it.contains("kotlin_tables_store_active_sort") }
        )
        printEvidence("tables", recorded.reads)
        recorded.reads.clear()
        val page = repo.history("s", HistoryFilter(DayRange(0, 200), HistoryStatus.Paid)).first()
        assertEquals(50, page.size)
        assertEquals(50, recorded.reads.single { it.sql.contains("FROM \"orders\"") }.rows)
        assertEquals(
            50,
            recorded.reads.filter { it.sql.contains("FROM \"order_items\"") }.sumOf { it.rows },
        )
        assertTrue(
            recorded.reads.first().plan.any { it.contains("created") && it.contains("SEARCH") }
        )
        printEvidence("history", recorded.reads)
        recorded.reads.clear()
        val searched =
            repo
                .history("s", HistoryFilter(DayRange(0, 200), HistoryStatus.Paid, "kiosk i"))
                .first()
        assertEquals(50, searched.size)
        val parentReads = recorded.reads.filter { it.sql.contains("FROM \"orders\"") }
        assertTrue(parentReads.all { it.rows <= 50 })
        assertEquals(120, parentReads.sumOf { it.rows })
        assertEquals(
            50,
            recorded.reads.filter { it.sql.contains("FROM \"order_items\"") }.sumOf { it.rows },
        )
        assertTrue(
            repo.history("s", HistoryFilter(DayRange(0, 200), search = "_%")).first().isNotEmpty()
        )
        assertTrue(
            repo.history("s", HistoryFilter(DayRange(0, 200), search = "_% ")).first().isEmpty()
        )
        printEvidence("unicode search", parentReads)
        recorded.reads.clear()
        val detail = repo.detail("s", "today010").first()!!
        assertEquals(1, detail.items.size)
        assertEquals(1, recorded.reads.single { it.sql.contains("FROM \"orders\"") }.rows)
        assertEquals(1, recorded.reads.single { it.sql.contains("FROM \"products\"") }.rows)
        assertTrue(recorded.reads.all { it.rows <= 1 })
        assertTrue(recorded.reads.all { read -> read.plan.none { it.startsWith("SCAN ") } })
        printEvidence("detail", recorded.reads)
        assertThrows(IllegalArgumentException::class.java) {
            db.explainSelect("orders", "id IN (SELECT id FROM users)")
        }
        assertThrows(IllegalArgumentException::class.java) {
            db.select("orders", "INSTR(id, 'a') > 0")
        }
        db.close()
    }

    private fun printEvidence(label: String, reads: List<BrowseRecordingDriver.Read>) {
        println(
            "$label: ${reads.map { it.rows }} stepped rows; ${reads.flatMap { it.plan }.distinct()}"
        )
    }
}
