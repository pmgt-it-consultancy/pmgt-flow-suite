package com.pmgt.pos.orders

import app.cash.sqldelight.db.*
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.browse.BrowseRecordingDriver
import com.pmgt.pos.catalog.ModifierSnapshot
import com.pmgt.pos.db.*
import java.time.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*

class OrderFaultDriver(private val delegate: SqlDriver) : SqlDriver by delegate {
    var successfulOrderWritesBeforeFailure: Int? = null
    var failNextTableWrite = false

    override fun execute(
        identifier: Int?,
        sql: String,
        parameters: Int,
        binders: (SqlPreparedStatement.() -> Unit)?,
    ): QueryResult<Long> {
        fun writes(table: String) =
            sql.startsWith("INSERT INTO \"$table\"") || sql.startsWith("UPDATE \"$table\"")
        if (failNextTableWrite && writes("tables")) {
            failNextTableWrite = false
            throw IllegalStateException("Simulated table update failure")
        }
        if (writes("orders"))
            successfulOrderWritesBeforeFailure?.let { remaining ->
                if (remaining == 0) {
                    successfulOrderWritesBeforeFailure = null
                    throw IllegalStateException("Simulated disk write failure")
                }
                successfulOrderWritesBeforeFailure = remaining - 1
            }
        return delegate.execute(identifier, sql, parameters, binders)
    }
}

object OrderDatabaseContract {
    suspend fun verify(driver: SqlDriver) {
        val recorded = BrowseRecordingDriver(driver)
        val faults = OrderFaultDriver(recorded)
        val db = PosDatabase(faults)
        driver.execute(null, "PRAGMA user_version=3", 0)
        db.applyRemote("stores", listOf(row("s", "vat_rate" to 12)), emptyList(), emptyList())
        db.applyRemote(
            "tables",
            listOf(
                row(
                    "t",
                    "store_id" to "s",
                    "name" to "Table 1",
                    "status" to "available",
                    "is_active" to true,
                )
            ),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "products",
            listOf(
                row("p", "store_id" to "s", "name" to "Meal", "price" to 112, "is_vatable" to true)
            ) + (0 until 1000).map { row("foreignProduct$it", "store_id" to "other") },
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "orders",
            (0 until 1000).map {
                row("foreignOrder$it", "store_id" to "other", "status" to "paid")
            },
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "order_items",
            (0 until 1000).map {
                row(
                    "foreignItem$it",
                    "order_id" to "foreignOrder$it",
                    "product_id" to "foreignProduct$it",
                )
            },
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "order_item_modifiers",
            (0 until 1000).map { row("foreignModifier$it", "order_item_id" to "foreignItem$it") },
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "app_config",
            listOf(
                row(
                    "adoptedCounter",
                    "key" to "orderCounter.dine_in.2026-09-16",
                    "value" to "999suffix",
                )
            ) + (0 until 1000).map { row("config$it", "key" to "foreign$it") },
            emptyList(),
            emptyList(),
        )
        val beforeIndexes = db.integrity()
        db.prepareOrderIndexes()
        db.prepareOrderIndexes()
        assertEquals(beforeIndexes, db.integrity())
        val clock = Clock.fixed(Instant.parse("2026-09-16T08:00:00Z"), ZoneId.of("Asia/Manila"))
        var pushes = 0
        val repo =
            LocalOrderRepository(
                db,
                Dispatchers.Unconfined,
                { "device" },
                { "A" },
                { pushes++ },
                clock,
            )
        recorded.reads.clear()
        val order = repo.createOrder(NewOrder("s", tableId = "t", requestId = "same"))
        assertEquals("D-A1000", db.get("orders", order)!!.string("order_number"))
        assertTrue(
            recorded.reads.any {
                it.sql.contains("request_id =") &&
                    it.plan.any { p -> p.contains("kotlin_orders_request_id") }
            }
        )
        assertTrue(
            recorded.reads.any {
                it.sql.contains("FROM \"app_config\"") &&
                    it.rows == 1 &&
                    it.plan.any { p -> p.contains("app_config_key") }
            }
        )
        val mod = listOf(ModifierSnapshot("Size", "Large", 28.0))
        repo.addItem(order, ItemInput("p", 2.0, "No salt", mod))
        val item = db.select("order_items", "order_id = ?", listOf(order)).single().string("id")!!
        repo.serviceType(item, "takeout")
        recorded.reads.clear()
        val cart = repo.cart("s", order).first()!!
        assertEquals(280.0, cart.totals.netSales, 0.0)
        assertEquals(280.0, cart.checkoutTotals().netSales, 0.0)
        assertEquals("takeout", cart.lines.single().serviceType)
        assertTrue(
            recorded.reads.all { it.rows <= 1 && it.plan.none { p -> p.startsWith("SCAN ") } }
        )
        println("order cart: " + recorded.reads.joinToString { "rows=${it.rows} ${it.plan}" })
        // Fail only the later total write after quantity/count batch succeeds.
        faults.successfulOrderWritesBeforeFailure = 1
        assertTrue(runCatching { repo.quantity(item, 4.0) }.isFailure)
        assertEquals(4.0, db.get("order_items", item)!!.number("quantity"), 0.0)
        assertEquals(4.0, db.get("orders", order)!!.number("item_count"), 0.0)
        assertEquals(280.0, db.get("orders", order)!!.number("net_sales"), 0.0)
        repo.quantity(item, 4.0)
        assertEquals(4.0, db.get("orders", order)!!.number("item_count"), 0.0)
        assertEquals(560.0, db.get("orders", order)!!.number("net_sales"), 0.0)
        repo.send(order)
        assertTrue(db.get("order_items", item)!!.boolean("is_sent_to_kitchen"))
        db.deleteLocal("products", "p")
        repo.recalculate(order)
        val missing = repo.cart("s", order).first()!!
        assertEquals(0.0, missing.totals.vatableSales, 0.0)
        assertEquals(500.0, missing.checkoutTotals().vatableSales, 0.0)
        assertEquals(560.0, missing.totals.nonVatSales, 0.0)
        assertEquals(5, pushes)
        assertNull(repo.cart("other", order).first())
        // A consumed reservation remains consumed when the creation batch cannot validate products.
        assertTrue(
            runCatching {
                    repo.createAndSend(NewOrder("s", tableId = "t"), listOf(ItemInput("p", 1.0))) {}
                }
                .isFailure
        )
        assertEquals("1001", db.get("app_config", "adoptedCounter")!!.string("value"))
        assertEquals(1, db.select("orders", "store_id = ?", listOf("s")).size)
        assertEquals(1000, db.select("order_items", "order_id != ?", listOf(order)).size)
        // Actual driver verifies modifier-inclusive SC rewrite, not only synthetic oracle rows.
        db.applyRemote(
            "products",
            listOf(
                row(
                    "discountProduct",
                    "store_id" to "s",
                    "name" to "SC Meal",
                    "price" to 112,
                    "is_vatable" to true,
                )
            ),
            emptyList(),
            emptyList(),
        )
        val discountedOrder = repo.createDraft("s")
        repo.addItem(discountedOrder, ItemInput("discountProduct", 2.0, modifiers = mod))
        val discountedItem =
            db.select("order_items", "order_id = ?", listOf(discountedOrder))
                .single()
                .string("id")!!
        db.insertLocal(
            "order_discounts",
            row(
                "sc",
                "order_id" to discountedOrder,
                "order_item_id" to discountedItem,
                "discount_type" to "senior_citizen",
                "quantity_applied" to 1,
                "discount_amount" to 999,
                "vat_exempt_amount" to 999,
            ),
        )
        repo.recalculate(discountedOrder)
        assertEquals(25.0, db.get("order_discounts", "sc")!!.number("discount_amount"), 0.0)
        assertEquals(125.0, db.get("order_discounts", "sc")!!.number("vat_exempt_amount"), 0.0)
        assertEquals(240.0, db.get("orders", discountedOrder)!!.number("net_sales"), 0.0)
        val otherTab = repo.createOrder(NewOrder("s", tableId = "t"))
        repo.cancel(order)
        assertEquals("voided", db.get("orders", order)!!.string("status"))
        assertEquals("occupied", db.get("tables", "t")!!.string("status"))
        val cancellation = db.select("order_voids", "order_id = ?", listOf(order)).single()
        assertEquals("order", cancellation.string("void_type"))
        assertEquals("Order cancelled by cashier", cancellation.string("reason"))
        assertEquals("", cancellation.string("approved_by"))
        assertEquals("", cancellation.string("requested_by"))
        assertEquals(560.0, cancellation.number("amount"), 0.0)
        assertNotNull(db.get("order_items", item))
        assertEquals(1, db.select("order_item_modifiers", "order_item_id = ?", listOf(item)).size)
        repo.cancel(otherTab)
        assertEquals("available", db.get("tables", "t")!!.string("status"))
        db.close()
    }
}
