package com.pmgt.pos.browse

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class BrowseRepositoryTest {
    private fun fixture(): PosDatabase =
        PosDatabase(
            JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
        )

    private fun row(id: String, vararg fields: Pair<String, Any?>) = buildJsonObject {
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

    @Test
    fun tablesDeriveOccupancyFromOpenTabsAndIgnoreLargeHistory() = runTest {
        val db = fixture()
        db.applyRemote(
            "tables",
            listOf(
                row(
                    "t",
                    "store_id" to "s",
                    "name" to "Table 1",
                    "is_active" to true,
                    "status" to "available",
                )
            ),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "orders",
            (0 until 2500).map {
                row("old$it", "store_id" to "s", "status" to "paid", "table_id" to "t")
            } +
                listOf(
                    row(
                        "second",
                        "store_id" to "s",
                        "status" to "open",
                        "table_id" to "t",
                        "tab_number" to 2,
                        "net_sales" to 80,
                    ),
                    row(
                        "first",
                        "store_id" to "s",
                        "status" to "open",
                        "table_id" to "t",
                        "tab_number" to 1,
                        "net_sales" to 20,
                    ),
                ),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "order_items",
            listOf(
                row("i", "order_id" to "first", "quantity" to 3),
                row("v", "order_id" to "first", "quantity" to 99, "is_voided" to true),
            ),
            emptyList(),
            emptyList(),
        )
        val table =
            LocalBrowseRepository(db, StandardTestDispatcher(testScheduler))
                .tables("s")
                .first()
                .single()
        assertTrue(table.occupied)
        assertEquals(listOf("first", "second"), table.orders.map { it.id })
        assertEquals(3.0, table.totalItems, 0.0)
        assertEquals(100.0, table.totalNetSales, 0.0)
        assertTrue(
            LocalBrowseRepository(db, StandardTestDispatcher(testScheduler))
                .tables("other")
                .first()
                .isEmpty()
        )
        db.close()
    }

    @Test
    fun historyReturnsFirst50AfterFiltersAndDetailUsesSelectedReferences() = runTest {
        val db = fixture()
        db.applyRemote(
            "orders",
            (0 until 100).map {
                row(
                    "o${it.toString().padStart(3,'0')}",
                    "store_id" to "s",
                    "status" to if (it < 10) "draft" else "paid",
                    "created_at" to it,
                    "customer_name" to "A_20% Guest",
                    "table_id" to "t",
                    "table_name" to "Old",
                    "created_by" to "u",
                    "net_sales" to 110,
                )
            },
            emptyList(),
            emptyList(),
        )
        db.applyRemote("tables", listOf(row("t", "name" to "Current")), emptyList(), emptyList())
        db.applyRemote("users", listOf(row("u", "name" to "Cashier")), emptyList(), emptyList())
        db.applyRemote(
            "products",
            listOf(row("p", "is_vatable" to false)),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "order_items",
            listOf(
                row(
                    "i",
                    "order_id" to "o099",
                    "product_id" to "p",
                    "product_name" to "Rice",
                    "product_price" to 50,
                    "quantity" to 2,
                )
            ),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "order_item_modifiers",
            listOf(
                row(
                    "m",
                    "order_item_id" to "i",
                    "modifier_option_name" to "Large",
                    "price_adjustment" to 5,
                )
            ),
            emptyList(),
            emptyList(),
        )
        val repo = LocalBrowseRepository(db, StandardTestDispatcher(testScheduler))
        val page = repo.history("s", HistoryFilter(DayRange(0, 100), search = "_20%")).first()
        assertEquals(50, page.size)
        assertEquals("o099", page.first().id)
        assertEquals("o050", page.last().id)
        assertEquals("Current", page.first().tableName)
        val detail = repo.detail("s", "o099").first()!!
        assertEquals("Cashier", detail.createdByName)
        assertFalse(detail.items.single().isVatable)
        assertEquals(110.0, detail.items.single().lineTotal, 0.0)
        assertNull(repo.detail("other", "o099").first())
        assertTrue(
            repo.history("s", HistoryFilter(DayRange(0, 100), search = " Guest ")).first().isEmpty()
        )
        db.close()
    }

    @Test
    fun takeoutUsesSelectedDayButDraftsSpanDaysAndWorkflowDoesNotFollowPaymentStatus() = runTest {
        val db = fixture()
        db.applyRemote(
            "orders",
            listOf(
                row(
                    "draft",
                    "store_id" to "s",
                    "status" to "draft",
                    "order_type" to "dine_in",
                    "created_at" to 1,
                    "net_sales" to 70,
                ),
                row(
                    "open",
                    "store_id" to "s",
                    "status" to "open",
                    "order_type" to "takeout",
                    "created_at" to 100,
                    "net_sales" to 10,
                ),
                row(
                    "advance",
                    "store_id" to "s",
                    "status" to "open",
                    "order_type" to "takeout",
                    "takeout_status" to "preparing",
                    "created_at" to 100,
                ),
                row(
                    "paid",
                    "store_id" to "s",
                    "status" to "paid",
                    "order_type" to "takeout",
                    "takeout_status" to "completed",
                    "created_at" to 100,
                    "net_sales" to 90,
                ),
                row(
                    "void",
                    "store_id" to "s",
                    "status" to "voided",
                    "order_type" to "takeout",
                    "created_at" to 100,
                ),
            ),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "order_items",
            listOf(row("i", "order_id" to "open", "product_price" to 20, "quantity" to 2)),
            emptyList(),
            emptyList(),
        )
        val lane =
            LocalBrowseRepository(db, StandardTestDispatcher(testScheduler))
                .takeout("s", DayRange(100, 200))
                .first()
        assertEquals("draft", lane.drafts.single().id)
        assertEquals(70.0, lane.drafts.single().netSales, 0.0)
        assertEquals(40.0, lane.attention.single().netSales, 0.0)
        assertEquals("advance", lane.progress.single().id)
        assertEquals("paid", lane.history.single().id)
        db.close()
    }
}
