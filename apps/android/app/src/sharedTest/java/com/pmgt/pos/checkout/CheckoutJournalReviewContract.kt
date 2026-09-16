package com.pmgt.pos.checkout

import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assert.*

/**
 * Both adapters execute these checks against a real file, closing every connection between phases.
 */
object CheckoutJournalReviewContract {
    suspend fun firstExecutionAcrossCloseReopen(
        open: () -> Pair<PosDatabase, CheckoutFaultDriver>
    ) {
        val owner = CheckoutDatabaseContract.owner
        val lines =
            listOf(PaymentLine("a", cashReceived = "200"), PaymentLine("b", cashReceived = "200"))
        lateinit var id: String
        lateinit var ids: List<String>
        val times =
            listOf(1_800_057_599_000L, 1_800_057_601_000L, 1_800_057_602_000L, 1_800_057_603_000L)
        for (phase in 0..3) {
            val (db, fault) = open()
            db.use {
                if (phase == 0) id = CheckoutDatabaseContract.seed(db)
                val repo =
                    LocalCheckoutRepository(
                        db,
                        Dispatchers.Unconfined,
                        { owner },
                        clock = { times[phase] },
                    )
                when (phase) {
                    0 -> {
                        fault.failTable = "order_payments"
                        fault.successfulWrites = 1
                    }
                    1 -> fault.failTable = "orders"
                    2 -> fault.failTable = "tables"
                }
                val attempt = runCatching {
                    if (phase == 0)
                        repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                    else repo.resume(owner, id)
                }
                if (phase < 3) {
                    assertTrue(attempt.isFailure)
                    assertNull(activeJournal(db, id)!!.completedAt)
                } else {
                    val completed = attempt.getOrThrow()!!
                    assertEquals(times[3], completed.transactionAt)
                    assertEquals(completed, repo.resume(owner, id))
                }
                if (phase == 0) ids = activeJournal(db, id)!!.allocatedIds
                assertEquals(
                    times[0].toDouble(),
                    db.get("order_payments", ids[0])!!.number("created_at"),
                    0.0,
                )
                if (phase >= 1)
                    assertEquals(
                        times[1].toDouble(),
                        db.get("order_payments", ids[1])!!.number("created_at"),
                        0.0,
                    )
                assertEquals(
                    if (phase >= 2) "paid" else "open",
                    db.get("orders", id)!!.string("status"),
                )
                if (phase >= 2)
                    assertEquals(times[2].toDouble(), db.get("orders", id)!!.number("paid_at"), 0.0)
                db.acknowledge(db.pendingChanges(), emptySet())
                assertEquals(0, db.pendingCount())
                db.applyRemote(
                    "orders",
                    emptyList(),
                    listOf(row(id, "order_number" to "0099", "paid_by" to "cashier")),
                    emptyList(),
                )
                if (phase < 3)
                    assertEquals(
                        FinancialActionState.Recoverable,
                        repo.pendingActions("s").first().single().state,
                    )
                else assertTrue(repo.pendingActions("s").first().isEmpty())
            }
        }
    }

    suspend fun discountInsertAndPurgedRemoval(open: () -> Pair<PosDatabase, CheckoutFaultDriver>) {
        val owner = CheckoutDatabaseContract.owner
        lateinit var id: String
        lateinit var ids: List<String>
        var now = 1_800_057_599_000L
        open().let { (db, fault) ->
            db.use {
                id = CheckoutDatabaseContract.seed(db)
                LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
                    .addItem(id, ItemInput("p", 1.0))
                val input =
                    DiscountInput(
                        "pwd",
                        db.select("order_items").map { it.string("id")!! },
                        "Customer",
                        "ID",
                    )
                fault.failJournalAfter =
                    2 // intent + first insert committed; second insert/journal rolls back.
                val repo =
                    LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner }, clock = { now })
                assertTrue(
                    runCatching {
                            repo.apply(
                                owner,
                                id,
                                "discount",
                                input,
                                CheckoutApproval(owner, id, "discount", "manager"),
                            )
                        }
                        .isFailure
                )
                ids = activeJournal(db, id)!!.allocatedIds
                assertEquals(1, db.select("order_discounts").size)
                assertEquals(
                    now.toDouble(),
                    db.get("order_discounts", ids[0])!!.number("created_at"),
                    0.0,
                )
            }
        }
        now = 1_800_057_601_000L
        open().let { (db, fault) ->
            db.use {
                val repo =
                    LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner }, clock = { now })
                repo.resume(owner, id)
                assertEquals(
                    1_800_057_599_000.0,
                    db.get("order_discounts", ids[0])!!.number("created_at"),
                    0.0,
                )
                assertEquals(
                    now.toDouble(),
                    db.get("order_discounts", ids[1])!!.number("created_at"),
                    0.0,
                )
                db.acknowledge(db.pendingChanges(), emptySet())
                fault.failJournalAfter =
                    2 // removal intent + tombstone committed, next recalc rolls back.
                assertTrue(
                    runCatching {
                            repo.remove(
                                owner,
                                id,
                                "remove",
                                ids[0],
                                CheckoutApproval(owner, id, "remove", "manager"),
                            )
                        }
                        .isFailure
                )
                db.acknowledge(db.pendingChanges(), emptySet())
                assertNull(db.get("order_discounts", ids[0]))
                assertEquals(
                    FinancialActionState.Recoverable,
                    repo.pendingActions("s").first().single().state,
                )
            }
        }
        open().let { (db, _) ->
            db.use {
                val repo =
                    LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner }, clock = { now })
                repo.resume(owner, id)
                assertEquals(listOf(ids[1]), db.select("order_discounts").map { it.string("id") })
                assertTrue(repo.pendingActions("s").first().isEmpty())
                assertEquals(360.0, db.get("orders", id)!!.number("net_sales"), 0.0)
            }
        }
    }

    suspend fun corruptedPlanRetainsAllEvidence(db: PosDatabase, fault: CheckoutFaultDriver) {
        val owner = CheckoutDatabaseContract.owner
        val id = CheckoutDatabaseContract.seed(db)
        fault.failJournalAfter = 1
        val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
        assertTrue(
            runCatching {
                    repo.settle(
                        owner,
                        CheckoutRoute(id, "dine_in"),
                        listOf(PaymentLine(cashReceived = "300")),
                        "Cashier",
                    )
                }
                .isFailure
        )
        val journal = activeJournal(db, id)!!
        saveJournal(
            db,
            journal.copy(steps = journal.steps.filterNot { it.values.string("status") == "paid" }),
        )
        val pointer = db.localValue(activeKey(id))
        assertEquals(
            FinancialActionState.Unreadable,
            repo.pendingActions("s").first().single().state,
        )
        assertTrue(runCatching { repo.resume(owner, id) }.isFailure)
        assertEquals(pointer, db.localValue(activeKey(id)))
        assertEquals("open", db.get("orders", id)!!.string("status"))
        assertTrue(db.select("order_payments").isEmpty())
    }
}
