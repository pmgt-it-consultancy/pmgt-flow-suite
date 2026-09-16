package com.pmgt.pos.checkout

import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.catalog.ModifierSnapshot
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import org.junit.Assert.*

object CheckoutDatabaseContract {
    val owner = CheckoutOwner("cashier", "s")

    suspend fun selectedQueryPlans(
        db: PosDatabase,
        recording: com.pmgt.pos.browse.BrowseRecordingDriver,
    ) {
        val id = seed(db)
        db.applyRemote(
            "order_discounts",
            (1..1000).map {
                row("foreign-discount-$it", "order_id" to "foreign", "discount_amount" to 1)
            },
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "order_payments",
            (1..1000).map {
                row(
                    "foreign-payment-$it",
                    "order_id" to "foreign",
                    "store_id" to "other",
                    "amount" to 1,
                )
            },
            emptyList(),
            emptyList(),
        )
        val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
        repo.settle(
            owner,
            CheckoutRoute(id, "dine_in"),
            listOf(PaymentLine(cashReceived = "300")),
            "Cashier",
        )
        recording.reads.clear()
        assertEquals(id, repo.observe(owner, id).first()!!.cart.id)
        assertTrue(repo.pendingActions("s").first().isEmpty())
        repo.resume(owner, id)
        assertTrue(recording.reads.isNotEmpty())
        assertTrue(recording.reads.all { read -> read.plan.none { it.contains("SCAN ") } })
        assertTrue(recording.reads.all { it.rows <= 2 })
        println("Synthetic checkout selected SQL: " + recording.reads.map { it.plan }.distinct())
    }

    suspend fun seed(db: PosDatabase): String {
        db.applyRemote(
            "stores",
            listOf(row("s", "name" to "Synthetic Store", "vat_rate" to 12)),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "tables",
            listOf(row("t", "store_id" to "s", "name" to "Table 1", "status" to "available")),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "products",
            listOf(
                row("p", "store_id" to "s", "name" to "Meal", "price" to 112, "is_vatable" to true)
            ),
            emptyList(),
            emptyList(),
        )
        val entry = LocalOrderRepository(db, Dispatchers.Unconfined, { "device" })
        val id = entry.createOrder(NewOrder("s", tableId = "t"))
        entry.addItem(
            id,
            ItemInput("p", 2.0, modifiers = listOf(ModifierSnapshot("Size", "Large", 28.0))),
        )
        return id
    }

    suspend fun run(db: PosDatabase) {
        val order = seed(db)
        var pushes = 0
        val repository =
            LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner }, { pushes++ })
        val item = db.select("order_items").single().string("id")!!
        repository.apply(
            owner,
            order,
            "approve-1",
            DiscountInput("senior_citizen", listOf(item), " Customer ", " ID "),
            CheckoutApproval(owner, order, "approve-1", "manager"),
        )
        val discount = db.select("order_discounts").singleOrNull()
        assertNotNull("Approved checkout creates discount evidence", discount)
        assertEquals(25.0, discount!!.number("discount_amount"), 0.0)
        assertEquals(125.0, discount.number("vat_exempt_amount"), 0.0)
        assertEquals(1.0, discount.number("quantity_applied"), 0.0)
        assertEquals("manager", discount.string("approved_by"))
        assertEquals("Customer", discount.string("customer_name"))
        assertEquals(240.0, db.get("orders", order)!!.number("net_sales"), 0.0)
        repository.apply(
            owner,
            order,
            "approve-1",
            DiscountInput("senior_citizen", listOf(item), " Customer ", " ID "),
            CheckoutApproval(owner, order, "approve-1", "manager"),
        )
        assertEquals(1, db.select("order_discounts").size)
        repository.remove(
            owner,
            order,
            "remove-1",
            discount.string("id")!!,
            CheckoutApproval(owner, order, "remove-1", "manager"),
        )
        assertEquals(
            "deleted",
            db.get("order_discounts", discount.string("id")!!)!!.string("_status"),
        )
        assertEquals(280.0, db.get("orders", order)!!.number("net_sales"), 0.0)
        val lines =
            listOf(
                PaymentLine("1", cashReceived = "50"),
                PaymentLine(
                    "2",
                    "card_ewallet",
                    amount = "400",
                    cardPaymentType = "GCash",
                    cardReferenceNumber = " RAW ",
                ),
            )
        val receipt =
            repository.settle(
                owner,
                CheckoutRoute(order, "dine_in", "t", "Table 1"),
                lines,
                "Cashier",
            )
        val payments = db.select("order_payments", "order_id = ?", listOf(order))
        assertEquals(2, payments.size)
        assertEquals(0.0, payments[0].number("amount"), 0.0)
        assertEquals(50.0, payments[0].number("cash_received"), 0.0)
        assertEquals(50.0, payments[0].number("change_given"), 0.0)
        assertEquals(280.0, payments[1].number("amount"), 0.0)
        assertEquals(" RAW ", payments[1].string("card_reference_number"))
        assertEquals("paid", db.get("orders", order)!!.string("status"))
        assertEquals("cash", db.get("orders", order)!!.string("payment_method"))
        assertEquals("", db.get("orders", order)!!.string("paid_by"))
        assertEquals("available", db.get("tables", "t")!!.string("status"))
        assertEquals(170.0, receipt.displayChange, 0.0)
        assertEquals(receipt, repository.resume(owner, order))
        assertEquals(receipt, repository.settle(owner, receipt.route, lines, "Cashier"))
        assertEquals(
            payments.map { it.string("id") },
            db.select("order_payments").map { it.string("id") },
        )
        assertNull(repository.observe(CheckoutOwner("cashier", "other"), order).first())
        assertTrue(pushes >= 3)
    }
}
