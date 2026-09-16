package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class CheckoutRepositoryTest {
    @Test
    fun initialSentMarkerIsNotTheRecalculationCompletionBarrier() = runBlocking {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                CheckoutDatabaseContract.seed(db)
                val entry =
                    com.pmgt.pos.orders.LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
                val result =
                    entry.createAndSend(
                        com.pmgt.pos.orders.NewOrder("s", tableId = "t"),
                        listOf(com.pmgt.pos.orders.ItemInput("p", 3.0)),
                    ) { committed ->
                        assertTrue(
                            db.select("order_items", "order_id = ?", listOf(committed.orderId))
                                .single()
                                .boolean("is_sent_to_kitchen")
                        )
                        assertEquals(
                            0.0,
                            db.get("orders", committed.orderId)!!.number("net_sales"),
                            0.0,
                        )
                    }
                assertEquals(336.0, db.get("orders", result.orderId)!!.number("net_sales"), 0.0)
            }
    }

    @Test
    fun malformedPublicPaymentLinesCannotSettleWithZeroOrDuplicatedAllocation() = runBlocking {
        for (lines in
            listOf(
                listOf(PaymentLine(paymentMethod = "unknown", amount = "300")),
                listOf(
                    PaymentLine(
                        "same",
                        "card_ewallet",
                        amount = "200",
                        cardPaymentType = "GCash",
                        cardReferenceNumber = "ref",
                    ),
                    PaymentLine(
                        "same",
                        "card_ewallet",
                        amount = "200",
                        cardPaymentType = "GCash",
                        cardReferenceNumber = "ref",
                    ),
                ),
            )) {
            PosDatabase(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
                .use { db ->
                    val id = CheckoutDatabaseContract.seed(db)
                    val repo =
                        LocalCheckoutRepository(
                            db,
                            Dispatchers.Unconfined,
                            { CheckoutDatabaseContract.owner },
                        )
                    assertTrue(
                        runCatching {
                                repo.settle(
                                    CheckoutDatabaseContract.owner,
                                    com.pmgt.pos.orders.CheckoutRoute(id, "dine_in"),
                                    lines,
                                    "Cashier",
                                )
                            }
                            .isFailure
                    )
                    assertEquals("open", db.get("orders", id)!!.string("status"))
                    assertTrue(db.select("order_payments").isEmpty())
                }
        }
    }

    @Test
    fun selectedObserverIgnoresUnrelatedChangesAndCancelsCleanly() = runBlocking {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                val id = CheckoutDatabaseContract.seed(db)
                val repo =
                    LocalCheckoutRepository(
                        db,
                        Dispatchers.Unconfined,
                        { CheckoutDatabaseContract.owner },
                    )
                val emissions = mutableListOf<CheckoutView?>()
                val job =
                    launch(start = CoroutineStart.UNDISPATCHED) {
                        repo.observe(CheckoutDatabaseContract.owner, id).collect { emissions += it }
                    }
                yield()
                assertEquals(1, emissions.size)
                db.setLocalValue("synthetic.unrelated", "changed")
                yield()
                assertEquals(1, emissions.size)
                db.updateLocal(
                    "orders",
                    id,
                    com.pmgt.pos.orders.fields("customer_name" to "Synthetic updated customer"),
                )
                yield()
                assertEquals(2, emissions.size)
                job.cancelAndJoin()
                db.setLocalValue("synthetic.unrelated", "again")
                yield()
                assertEquals(2, emissions.size)
            }
    }

    @Test
    fun actualJdbcCheckoutSelectedQueryPlansWithForeignVolume() = runBlocking {
        val recording =
            com.pmgt.pos.browse.BrowseRecordingDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(recording).use { CheckoutDatabaseContract.selectedQueryPlans(it, recording) }
    }

    @Test
    fun approvedDiscountRemovalAndSplitSettlementWriteLegacyRows() = runBlocking {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { CheckoutDatabaseContract.run(it) }
    }
}
