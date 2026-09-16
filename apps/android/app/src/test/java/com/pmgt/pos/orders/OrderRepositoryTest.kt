package com.pmgt.pos.orders

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.catalog.ModifierSnapshot
import com.pmgt.pos.db.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class OrderRepositoryTest {
    @Test
    fun selectedItemOrderSurvivesQuantityAndMetadataUpdates() = runBlocking {
        database().use { db ->
            db.applyRemote("stores", listOf(row("s", "vat_rate" to 12)), emptyList(), emptyList())
            db.applyRemote(
                "products",
                listOf(row("p", "name" to "Meal", "price" to 112)),
                emptyList(),
                emptyList(),
            )
            val repo = LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
            val id = repo.createDraft("s")
            repeat(3) { repo.addItem(id, ItemInput("p", 1.0, "line$it")) }
            val before = repo.cart("s", id).first()!!.lines.map { it.id }
            repo.quantity(before.first(), 2.0)
            assertEquals(before, repo.cart("s", id).first()!!.lines.map { it.id })
            repo.serviceType(before[1], "takeout")
            assertEquals(before, repo.cart("s", id).first()!!.lines.map { it.id })
        }
    }

    @Test
    fun publicNumberReservationKeepsDeviceDayTypeScopeAndConsumesWithoutParent() = runBlocking {
        database().use { db ->
            fun repo(day: String) =
                LocalOrderRepository(
                    db,
                    Dispatchers.Unconfined,
                    { "ab-cdef" },
                    clock =
                        java.time.Clock.fixed(
                            java.time.Instant.parse("${day}T16:00:00Z"),
                            java.time.ZoneId.of("Asia/Manila"),
                        ),
                )
            assertEquals("D-ABCD001", repo("2026-09-15").reserveOrderNumber("dine_in"))
            assertEquals("D-ABCD002", repo("2026-09-15").reserveOrderNumber("dine_in"))
            assertEquals("T-ABCD001", repo("2026-09-15").reserveOrderNumber("takeout"))
            assertEquals("D-ABCD001", repo("2026-09-16").reserveOrderNumber("dine_in"))
            assertTrue(db.select("orders").isEmpty())
            assertEquals(3, db.select("app_config").size)
        }
    }

    private fun database() =
        PosDatabase(
            JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
        )

    @Test
    fun takeoutDraftPersistsWithoutCounterAndNewTabOccupiesWithoutInventedTabNumber() =
        runBlocking {
            database().use { db ->
                db.applyRemote(
                    "tables",
                    listOf(
                        row("t", "store_id" to "s", "name" to "Table 1", "status" to "available")
                    ),
                    emptyList(),
                    emptyList(),
                )
                val repo = LocalOrderRepository(db, Dispatchers.Unconfined, { "a-b12345" })
                val draft = repo.createDraft("s", "Lunch")
                assertEquals("draft", db.get("orders", draft)?.string("status"))
                assertEquals("takeout", db.get("orders", draft)?.string("order_type"))
                assertEquals("", db.get("orders", draft)?.string("created_by"))
                assertTrue(db.select("app_config").isEmpty())
                val order = repo.createOrder(NewOrder("s", tableId = "t", requestId = "request"))
                assertEquals("D-AB12001", db.get("orders", order)?.string("order_number"))
                assertEquals("occupied", db.get("tables", "t")?.string("status"))
                assertNull(db.get("tables", "t")?.string("current_order_id"))
                assertNull(db.get("orders", order)?.string("tab_number"))
                assertEquals(order, repo.createOrder(NewOrder("s", requestId = "request")))
                val before = db.select("orders") to db.select("app_config")
                assertTrue(
                    runCatching { repo.createOrder(NewOrder("other", requestId = "request")) }
                        .isFailure
                )
                assertEquals(before, db.select("orders") to db.select("app_config"))
                assertEquals(2, db.select("orders").size)
                assertEquals("1", db.select("app_config").single().string("value"))
            }
        }

    @Test
    fun modifierSnapshotsAbsoluteQuantityAndVoidRecalculateAllRows() = runBlocking {
        database().use { db ->
            db.applyRemote("stores", listOf(row("s", "vat_rate" to 12)), emptyList(), emptyList())
            db.applyRemote(
                "products",
                listOf(row("p", "name" to "Current meal", "price" to 112, "is_vatable" to true)),
                emptyList(),
                emptyList(),
            )
            val repo = LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
            val id = repo.createDraft("s")
            repo.addItem(
                id,
                ItemInput("p", 2.0, "No ice", listOf(ModifierSnapshot("Size", "Large", 28.0))),
            )
            val item = db.select("order_items").singleOrNull()
            assertNotNull("A confirmed product creates its own persisted line", item)
            val itemId = item!!.string("id")!!
            assertEquals("Current meal", item.string("product_name"))
            assertEquals(112.0, item.number("product_price"), 0.0)
            assertEquals(280.0, db.get("orders", id)!!.number("net_sales"), 0.0)
            db.insertLocal(
                "order_discounts",
                row(
                    "sc",
                    "order_id" to id,
                    "order_item_id" to itemId,
                    "discount_type" to "senior_citizen",
                    "quantity_applied" to 1,
                ),
            )
            db.insertLocal(
                "order_discounts",
                row(
                    "global",
                    "order_id" to id,
                    "discount_type" to "promo",
                    "discount_amount" to 1000,
                ),
            )
            repo.quantity(itemId, 3.0)
            assertEquals(3.0, db.get("orders", id)!!.number("item_count"), 0.0)
            assertEquals(-620.0, db.get("orders", id)!!.number("net_sales"), 0.0)
            assertEquals(25.0, db.get("order_discounts", "sc")!!.number("discount_amount"), 0.0)
            assertEquals(125.0, db.get("order_discounts", "sc")!!.number("vat_exempt_amount"), 0.0)
            repo.quantity(itemId, 3.0)
            assertEquals(3.0, db.get("orders", id)!!.number("item_count"), 0.0)
            repo.addItem(id, ItemInput("p", 2.0, customPrice = 10.0))
            assertEquals(2, db.select("order_items").size)
            repo.remove(itemId, "Mistake")
            assertEquals(2.0, db.get("orders", id)!!.number("item_count"), 0.0)
            assertEquals(0.0, db.get("order_discounts", "sc")!!.number("discount_amount"), 0.0)
            assertEquals(-980.0, db.get("orders", id)!!.number("net_sales"), 0.0)
            assertEquals(1, db.select("order_item_modifiers").size)
            assertTrue(db.select("order_voids").isEmpty())
            // Source service accepts repeated removal and decrements the count again.
            repo.remove(itemId)
            assertEquals(0.0, db.get("orders", id)!!.number("item_count"), 0.0)
            assertEquals("created", db.get("orders", id)!!.string("_status"))
        }
    }

    @Test
    fun cancelRecordsCanonicalFullOrderVoid() = runBlocking {
        database().use { db ->
            val repo = LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
            val orderId = repo.createOrder(NewOrder("s"))

            repo.cancel(orderId)

            assertEquals("voided", db.get("orders", orderId)?.string("status"))
            assertEquals("full_order", db.select("order_voids").single().string("void_type"))
        }
    }

    @Test
    fun firstSendRetainsCommittedIdentityOnRecalcFailureAndRetryUsesExistingSnapshots() =
        runBlocking {
            database().use { db ->
                db.applyRemote(
                    "tables",
                    listOf(row("t", "store_id" to "s", "status" to "available")),
                    emptyList(),
                    emptyList(),
                )
                db.applyRemote(
                    "products",
                    listOf(row("p", "name" to "Latest", "price" to 112, "is_vatable" to true)),
                    emptyList(),
                    emptyList(),
                )
                val repo = LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
                var committed: CreatedOrder? = null
                val result = runCatching {
                    repo.createAndSend(
                        NewOrder("s", tableId = "t", pax = 3.0),
                        listOf(ItemInput("p", 2.0)),
                    ) {
                        committed = it
                    }
                }
                assertNotNull(
                    "Known local batch commit must publish durable identity before recalc",
                    committed,
                )
                assertTrue("Missing store fails recalc after the local batch", result.isFailure)
                assertEquals(1, db.select("orders").size)
                assertEquals(1, db.select("order_items").size)
                assertTrue(db.select("order_items").single().boolean("is_sent_to_kitchen"))
                db.applyRemote(
                    "stores",
                    listOf(row("s", "vat_rate" to 12)),
                    emptyList(),
                    emptyList(),
                )
                repo.recalculate(committed!!.orderId)
                repo.recalculate(committed!!.orderId)
                val resumed =
                    LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
                        .cart("s", committed!!.orderId)
                        .first()!!
                assertEquals("Latest", resumed.lines.single().productName)
                assertEquals(224.0, resumed.totals.netSales, 0.0)
                assertEquals("1", db.select("app_config").single().string("value"))
                assertEquals(1, db.select("orders").size)
            }
        }

    @Test
    fun customerClearsOnlyExplicitEmptyTransferReleasesLastTabAndTakeoutSubmitKeepsNumberBlank() =
        runBlocking {
            database().use { db ->
                db.applyRemote(
                    "stores",
                    listOf(row("s", "vat_rate" to 12)),
                    emptyList(),
                    emptyList(),
                )
                db.applyRemote(
                    "tables",
                    listOf(
                        row("a", "store_id" to "s", "name" to "A"),
                        row("b", "store_id" to "s", "name" to "B"),
                    ),
                    emptyList(),
                    emptyList(),
                )
                val repo = LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
                val id = repo.createOrder(NewOrder("s", tableId = "a"))
                repo.customer(id, "Ana", "dine_in", "5")
                assertEquals("Ana", db.get("orders", id)!!.string("customer_name"))
                repo.customer(id)
                assertEquals("5", db.get("orders", id)!!.string("table_marker"))
                repo.customer(id, name = "")
                assertNull(db.get("orders", id)!!.string("customer_name"))
                repo.pax(id, 4.0)
                repo.tabName(id, "Family")
                assertEquals("Family", db.get("orders", id)!!.string("tab_name"))
                assertEquals(4.0, db.get("orders", id)!!.number("pax"), 0.0)
                val other = repo.createOrder(NewOrder("s", tableId = "a"))
                repo.transfer(id, "b")
                assertEquals("occupied", db.get("tables", "a")!!.string("status"))
                repo.transfer(other, "b")
                assertEquals("available", db.get("tables", "a")!!.string("status"))
                assertEquals(id, db.get("tables", "b")!!.string("current_order_id"))
                assertEquals("Tab 2", db.get("orders", other)!!.string("tab_name"))
                assertEquals("B", db.get("orders", other)!!.string("table_name"))
                val draft = repo.createDraft("s")
                repo.submitDraft(draft)
                assertEquals("open", db.get("orders", draft)!!.string("status"))
                assertNull(db.get("orders", draft)!!.string("order_number"))
                repo.advanceTakeout(draft, "ready_for_pickup")
                assertEquals("ready_for_pickup", db.get("orders", draft)!!.string("takeout_status"))
                repo.discardDraft(draft)
                assertEquals("voided", db.get("orders", draft)!!.string("status"))
            }
        }
}
