package com.pmgt.pos.checkout

import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assert.*

object CorrectionDatabaseContract {
    val owner = CheckoutDatabaseContract.owner

    suspend fun seed(db: PosDatabase): String {
        val id = CheckoutDatabaseContract.seed(db)
        val entry = LocalOrderRepository(db, Dispatchers.Unconfined, { "device" })
        entry.addItem(
            id,
            ItemInput(
                "p",
                1.0,
                notes = "retained",
                modifiers = listOf(com.pmgt.pos.catalog.ModifierSnapshot("Size", "Large", 28.0)),
            ),
        )
        val checkout = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
        val retained = db.select("order_items").last().string("id")!!
        checkout.apply(
            owner,
            id,
            "discount",
            DiscountInput("pwd", listOf(retained), "Synthetic", "ID"),
            CheckoutApproval(owner, id, "discount", "manager"),
        )
        checkout.settle(
            owner,
            CheckoutRoute(id, "dine_in"),
            listOf(PaymentLine(cashReceived = "500")),
            "Cashier",
        )
        return id
    }

    fun repo(db: PosDatabase, push: () -> Unit = {}, clock: () -> Long = { 1000L }) =
        LocalCorrectionRepository(
            db,
            Dispatchers.Unconfined,
            LocalOrderRepository(db, Dispatchers.Unconfined, { "device" }),
            { owner },
            push,
            clock,
        )

    fun input(db: PosDatabase, id: String) =
        CorrectionInput(
            "refund",
            "Return",
            listOf(db.select("order_items", "order_id = ?", listOf(id)).first().string("id")!!),
            "card_ewallet",
        )

    suspend fun selectedPlans(
        db: PosDatabase,
        recording: com.pmgt.pos.browse.BrowseRecordingDriver,
    ) {
        val order = seed(db)
        for (table in listOf("order_items", "order_discounts", "order_payments")) db.applyRemote(
            table,
            (1..1000).map { fields("id" to "$table-foreign-$it", "order_id" to "foreign") },
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "order_item_modifiers",
            (1..1000).map { fields("id" to "mod-foreign-$it", "order_item_id" to "foreign") },
            emptyList(),
            emptyList(),
        )
        val selected = input(db, order)
        recording.reads.clear()
        val start = System.nanoTime()
        repo(db)
            .correct(
                owner,
                order,
                "plan",
                selected,
                CheckoutApproval(owner, order, "plan", "manager"),
            )
        val elapsed = (System.nanoTime() - start) / 1_000_000
        assertTrue(recording.reads.isNotEmpty())
        assertTrue(
            "Unexpected full scan",
            recording.reads.all { it.plan.none { p -> p.contains("SCAN ") } },
        )
        assertTrue(
            "Unrelated rows crossed selected projection",
            recording.reads.all { it.rows <= 2 },
        )
        println(
            "Synthetic correction selected SQL: ${recording.reads.map { it.plan }.distinct()}; ${recording.reads.size} reads; ${elapsed}ms operation including reservation"
        )
    }

    suspend fun failureAndReopen(
        open: () -> Pair<PosDatabase, CheckoutFaultDriver>,
        reopen: () -> PosDatabase,
        table: String?,
        journalAfter: Int? = null,
        successfulWrites: Int = 0,
        wholeVoid: Boolean = false,
        pointer: String? = null,
    ) {
        lateinit var order: String
        lateinit var intent: CheckoutJournal
        lateinit var selected: CorrectionInput
        var originalModels = emptyMap<String, List<Row>>()
        val modelTables =
            listOf(
                "orders",
                "order_items",
                "order_item_modifiers",
                "order_discounts",
                "order_payments",
                "order_voids",
                "audit_logs",
                "tables",
            )
        val (db, driver) = open()
        db.use {
            order = seed(db)
            if (wholeVoid)
                db.updateLocal(
                    "tables",
                    "t",
                    fields("status" to "occupied", "current_order_id" to order),
                )
            selected = if (wholeVoid) CorrectionInput("void", "Return") else input(db, order)
            originalModels = modelTables.associateWith { db.select(it) }
            driver.failTable = table
            driver.failJournalAfter = journalAfter
            driver.successfulWrites = successfulWrites
            driver.failLocalKey =
                when (pointer) {
                    "corrected" -> correctedKey(order)
                    "active" -> activeKey(order)
                    else -> null
                }
            driver.successfulLocalWrites = if (pointer == "active") 1 else 0
            val attempt = runCatching {
                repo(db)
                    .correct(
                        owner,
                        order,
                        "correction",
                        selected,
                        CheckoutApproval(owner, order, "correction", "manager"),
                    )
            }
            assertTrue("Failure at $table journal=$journalAfter", attempt.isFailure)
            assertEquals(originalModels, modelTables.associateWith { db.select(it) })
            intent = requireNotNull(activeJournal(db, order))
            assertEquals(
                FinancialActionState.Recoverable,
                LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    .pendingActions("s")
                    .first()
                    .single()
                    .state,
            )
            assertTrue(runCatching { db.requireOrderWritable(order) }.isFailure)
            // Other orders remain writable while this correction is retained.
            val other =
                LocalOrderRepository(db, Dispatchers.Unconfined, { "device" })
                    .createOrder(NewOrder("s"))
            db.requireOrderWritable(other)
        }
        reopen().use { reopened ->
            val preserved = requireNotNull(activeJournal(reopened, order))
            assertEquals(intent, preserved)
            val result = repo(reopened, clock = { 9000L }).resume(owner, order)
            assertEquals(result, repo(reopened).resume(owner, order))
            assertEquals(1, reopened.select("order_voids").size)
            assertEquals(1, reopened.select("audit_logs").size)
            val void = reopened.get("order_voids", result.voidId)!!
            assertEquals(if (wholeVoid) 9000.0 else 1000.0, void.number("created_at"), 0.0)
            assertEquals(9000.0, reopened.select("audit_logs").single().number("created_at"), 0.0)
            result.replacementOrderId?.let { replacementId ->
                val replacement = reopened.get("orders", replacementId)!!
                if (preserved.correction!!.number != null)
                    assertEquals(preserved.correction.number, replacement.string("order_number"))
            }
            assertEquals(
                intent.allocatedIds.toSet(),
                modelTables
                    .flatMap { t ->
                        reopened
                            .select(t)
                            .filter { row -> row.string("id") in intent.allocatedIds }
                            .map { it.string("id") }
                    }
                    .toSet(),
            )
            for (t in
                listOf(
                    "order_items",
                    "order_item_modifiers",
                    "order_discounts",
                    "order_payments",
                )) {
                val originals = originalModels.getValue(t)
                assertEquals(
                    originals,
                    reopened.select(t).filter { r ->
                        originals.any { it.string("id") == r.string("id") }
                    },
                )
            }
            assertTrue(
                LocalCheckoutRepository(reopened, Dispatchers.Unconfined, { owner })
                    .pendingActions("s")
                    .first()
                    .isEmpty()
            )
        }
    }

    suspend fun pendingAndCorruption(db: PosDatabase, driver: CheckoutFaultDriver) {
        val order = seed(db)
        driver.failTable = "order_voids"
        assertTrue(
            runCatching {
                    repo(db)
                        .correct(
                            owner,
                            order,
                            "c",
                            input(db, order),
                            CheckoutApproval(owner, order, "c", "manager"),
                        )
                }
                .isFailure
        )
        val j = activeJournal(db, order)!!
        db.acknowledge(db.pendingChanges(), emptySet())
        assertEquals(0, db.pendingCount())
        val checkout = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
        assertEquals(
            FinancialActionState.Recoverable,
            checkout.pendingActions("s").first().single().state,
        )
        db.updateLocal("orders", order, fields("order_number" to "HYDRATED"))
        assertEquals(
            FinancialActionState.Recoverable,
            checkout.pendingActions("s").first().single().state,
        )
        db.updateLocal(
            "order_items",
            j.baseline!!.items.first().string("id")!!,
            fields("quantity" to 9.0),
        )
        assertEquals(
            FinancialActionState.Conflicted,
            checkout.pendingActions("s").first().single().state,
        )
        assertTrue(runCatching { repo(db).resume(owner, order) }.isFailure)
        assertTrue(db.select("order_voids").isEmpty())
        saveJournal(
            db,
            j.copy(
                correction =
                    j.correction!!.copy(
                        input = j.correction.input.copy(itemIds = listOf("foreign"))
                    )
            ),
        )
        assertEquals(
            FinancialActionState.Unreadable,
            checkout.pendingActions("s").first().first().state,
        )
        assertTrue(runCatching { repo(db).resume(owner, order) }.isFailure)
        assertEquals("c", db.localValue(activeKey(order)))
    }
}
