package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CorrectionRepositoryTest {
    @Test
    fun unfinishedForeignAndOldPaymentEvidenceAndStaleApprovalStayBlocked() = runBlocking {
        for (invalid in listOf("unfinished", "foreign-store", "v1", "approval")) {
            PosDatabase(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
                .use { db ->
                    val id = CorrectionDatabaseContract.seed(db)
                    val owner = CorrectionDatabaseContract.owner
                    val paymentId = db.localValue(settledKey(id))!!
                    val payment = loadJournal(db, id, paymentId)!!
                    when (invalid) {
                        "unfinished" -> saveJournal(db, payment.copy(done = false))
                        "foreign-store" ->
                            saveJournal(
                                db,
                                payment.copy(owner = payment.owner.copy(storeId = "foreign")),
                            )
                        "v1" -> saveJournal(db, payment.copy(version = 1))
                    }
                    val approval =
                        CheckoutApproval(owner, id, "correction", "manager") {
                            invalid != "approval"
                        }
                    assertTrue(
                        invalid,
                        runCatching {
                                CorrectionDatabaseContract.repo(db)
                                    .correct(
                                        owner,
                                        id,
                                        "correction",
                                        CorrectionInput("void", "Return"),
                                        approval,
                                    )
                            }
                            .isFailure,
                    )
                    assertEquals("paid", db.get("orders", id)!!.string("status"))
                    assertEquals(paymentId, db.localValue(settledKey(id)))
                    assertTrue(db.select("order_voids").isEmpty())
                }
        }
    }

    @Test
    fun fullVoidAuditCapturesTimeAfterConditionalTableRelease() = runBlocking {
        val delegate =
            JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
        var tick = 1000L
        var armed = false
        val driver =
            object : app.cash.sqldelight.db.SqlDriver by delegate {
                override fun execute(
                    identifier: Int?,
                    sql: String,
                    parameters: Int,
                    binders: (app.cash.sqldelight.db.SqlPreparedStatement.() -> Unit)?,
                ): app.cash.sqldelight.db.QueryResult<Long> =
                    delegate.execute(identifier, sql, parameters, binders).also {
                        if (armed && sql.startsWith("UPDATE \"tables\"")) tick = 9000L
                    }
            }
        PosDatabase(driver).use { db ->
            val id = CorrectionDatabaseContract.seed(db)
            db.updateLocal("tables", "t", fields("status" to "occupied", "current_order_id" to id))
            armed = true
            val owner = CorrectionDatabaseContract.owner
            CorrectionDatabaseContract.repo(db, clock = { tick })
                .correct(
                    owner,
                    id,
                    "c",
                    CorrectionInput("void", "Return"),
                    CheckoutApproval(owner, id, "c", "manager"),
                )
            assertEquals(1000.0, db.select("order_voids").single().number("created_at"), 0.0)
            assertEquals(9000.0, db.select("audit_logs").single().number("created_at"), 0.0)
        }
    }

    @Test
    fun foreignReferencesAndChangedEpochCannotCommitCorrection() = runBlocking {
        for (foreign in listOf("product", "table", "epoch")) {
            val driver =
                CheckoutFaultDriver(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
            PosDatabase(driver).use { db ->
                val id = CorrectionDatabaseContract.seed(db)
                val owner = CorrectionDatabaseContract.owner
                var current: CheckoutOwner? = owner
                if (foreign == "product")
                    db.updateLocal("products", "p", fields("store_id" to "foreign"))
                if (foreign == "table")
                    db.updateLocal("tables", "t", fields("store_id" to "foreign"))
                if (foreign == "epoch") driver.afterModelWrite = { current = null }
                val repo =
                    LocalCorrectionRepository(
                        db,
                        Dispatchers.Unconfined,
                        LocalOrderRepository(db, Dispatchers.Unconfined, { "d" }),
                        { current },
                    )
                val result = runCatching {
                    repo.correct(
                        owner,
                        id,
                        "c",
                        CorrectionDatabaseContract.input(db, id),
                        CheckoutApproval(owner, id, "c", "manager"),
                    )
                }
                assertTrue("$foreign must reject correction", result.isFailure)
                assertEquals("paid", db.get("orders", id)!!.string("status"))
                assertTrue(db.select("order_voids").isEmpty())
            }
        }
    }

    @Test
    fun authorizedHistoricalCorrectionRetainsDifferentSettlingCashierEvidence() = runBlocking {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                val id = CorrectionDatabaseContract.seed(db)
                val paymentId = db.localValue(settledKey(id))!!
                val payment = loadJournal(db, id, paymentId)!!
                val owner = CheckoutOwner("new-cashier", "s")
                val repo =
                    LocalCorrectionRepository(
                        db,
                        Dispatchers.Unconfined,
                        LocalOrderRepository(db, Dispatchers.Unconfined, { "device" }),
                        { owner },
                    )
                val result = runCatching {
                    repo.correct(
                        owner,
                        id,
                        "new-action",
                        CorrectionInput("void", "Return"),
                        CheckoutApproval(owner, id, "new-action", "manager"),
                    )
                }
                assertTrue(
                    "A completed prior cashier payment cannot block authorized correction: ${result.exceptionOrNull()}",
                    result.isSuccess,
                )
                assertEquals(payment, loadJournal(db, id, paymentId))
                assertEquals("manager", db.select("order_voids").single().string("approved_by"))
            }
    }

    @Test
    fun refundAuditCapturesTimeAfterReplacementPaymentWhileRefundRowsKeepStartTime() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { db ->
            val id = CheckoutDatabaseContract.seed(db)
            val owner = CheckoutDatabaseContract.owner
            val entry = LocalOrderRepository(db, Dispatchers.Unconfined, { "device" })
            entry.addItem(id, ItemInput("p", 1.0))
            db.updateLocal("orders", id, fields("status" to "paid"))
            var tick = 1000L
            driver.afterModelWrite = { tick = 9000L }
            val repo =
                LocalCorrectionRepository(
                    db,
                    Dispatchers.Unconfined,
                    entry,
                    { owner },
                    clock = { tick },
                )
            repo.correct(
                owner,
                id,
                "clock",
                CorrectionInput(
                    "refund",
                    "Return",
                    listOf(db.select("order_items").first().string("id")!!),
                    "cash",
                ),
                CheckoutApproval(owner, id, "clock", "manager"),
            )
            assertEquals(1000.0, db.select("order_voids").single().number("created_at"), 0.0)
            assertEquals(1000.0, db.select("order_payments").single().number("created_at"), 0.0)
            assertEquals(9000.0, db.select("audit_logs").single().number("created_at"), 0.0)
        }
    }

    @Test
    fun approvedFullVoidRetainsPaidEvidenceAndClearsLastTable() = runBlocking {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                val id = CheckoutDatabaseContract.seed(db)
                val owner = CheckoutDatabaseContract.owner
                LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    .settle(
                        owner,
                        CheckoutRoute(id, "dine_in"),
                        listOf(PaymentLine(cashReceived = "300")),
                        "Cashier",
                    )
                db.updateLocal(
                    "tables",
                    "t",
                    fields("current_order_id" to id, "status" to "occupied"),
                )
                val original = db.get("orders", id)!!
                val payments = db.select("order_payments")
                val items = db.select("order_items")
                val repo =
                    LocalCorrectionRepository(
                        db,
                        Dispatchers.Unconfined,
                        LocalOrderRepository(db, Dispatchers.Unconfined, { "device" }),
                        { owner },
                    )
                val result = runCatching {
                    repo.correct(
                        owner,
                        id,
                        "action",
                        CorrectionInput("void", "Return"),
                        CheckoutApproval(owner, id, "action", "manager"),
                    )
                }
                assertEquals(
                    "Approved correction changes the actual parent",
                    "voided",
                    db.get("orders", id)!!.string("status"),
                )
                assertTrue(result.isSuccess)
                assertEquals(
                    original.number("net_sales"),
                    db.get("orders", id)!!.number("net_sales"),
                    0.0,
                )
                assertEquals(payments, db.select("order_payments"))
                assertEquals(items, db.select("order_items"))
                assertEquals("available", db.get("tables", "t")!!.string("status"))
                assertNull(db.get("tables", "t")!!.string("current_order_id"))
                assertEquals("manager", db.select("order_voids").single().string("requested_by"))
                assertEquals("void_paid_order", db.select("audit_logs").single().string("action"))
            }
    }
}
