package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import java.io.File
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CheckoutRecoveryTest {
    private val owner = CheckoutDatabaseContract.owner
    private val lines =
        listOf(PaymentLine("a", cashReceived = "200"), PaymentLine("b", cashReceived = "200"))

    @Test
    fun everyBulkDiscountJournalAndRemovalPhaseResumesWithoutNewApprovalOrIds() = runBlocking {
        for (remove in listOf(false, true)) for (commit in 1..if (remove) 4 else 6) {
            val file = File.createTempFile("bulk-discount-phase-", ".sqlite")
            try {
                lateinit var id: String
                var existingIds = emptyList<String?>()
                val driver =
                    CheckoutFaultDriver(
                        JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                            LegacySqlSchema.create(it)
                        }
                    )
                PosDatabase(driver).use { db ->
                    id = CheckoutDatabaseContract.seed(db)
                    LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
                        .addItem(id, ItemInput("p", 1.0, notes = "second synthetic line"))
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    val input =
                        DiscountInput(
                            "pwd",
                            db.select("order_items").map { it.string("id")!! },
                            "Customer",
                            "ID",
                        )
                    if (remove)
                        repo.apply(
                            owner,
                            id,
                            "bulk",
                            input,
                            CheckoutApproval(owner, id, "bulk", "manager"),
                        )
                    driver.failJournalAfter = commit
                    val attempt = runCatching {
                        if (remove)
                            repo.remove(
                                owner,
                                id,
                                "remove",
                                db.select("order_discounts").first().string("id")!!,
                                CheckoutApproval(owner, id, "remove", "manager"),
                            )
                        else
                            repo.apply(
                                owner,
                                id,
                                "bulk",
                                input,
                                CheckoutApproval(owner, id, "bulk", "manager"),
                            )
                    }
                    assertTrue("remove=$remove commit=$commit", attempt.isFailure)
                    existingIds = db.select("order_discounts").map { it.string("id") }
                }
                PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    repo.resume(owner, id)
                    val discounts = db.select("order_discounts")
                    assertEquals(2, discounts.size)
                    assertTrue(discounts.map { it.string("id") }.containsAll(existingIds))
                    assertEquals(
                        if (remove) 1 else 0,
                        discounts.count { it.string("_status") == "deleted" },
                    )
                    assertTrue(discounts.all { it.number("quantity_applied") == 1.0 })
                    assertTrue(repo.pendingActions("s").first().isEmpty())
                }
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun impossibleCompletedPhaseIsUnreadableAndCannotPretendSettlement() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { db ->
            val id = CheckoutDatabaseContract.seed(db)
            val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
            driver.failTable = "order_payments"
            assertTrue(
                runCatching { repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier") }
                    .isFailure
            )
            saveJournal(db, activeJournal(db, id)!!.copy(done = true))
            assertEquals(
                FinancialActionState.Unreadable,
                repo.pendingActions("s").first().single().state,
            )
            assertTrue(runCatching { repo.resume(owner, id) }.isFailure)
            assertEquals("open", db.get("orders", id)!!.string("status"))
            assertTrue(db.select("order_payments").isEmpty())
        }
    }

    @Test
    fun everyJournalCommitRollsBackItsOwnModelPhaseAndRetainsReplayIdentity() = runBlocking {
        for (commit in 0..5) {
            val file = File.createTempFile("checkout-journal-", ".sqlite")
            try {
                lateinit var id: String
                var rows: List<String?> = emptyList()
                val driver =
                    CheckoutFaultDriver(
                        JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                            LegacySqlSchema.create(it)
                        }
                    )
                PosDatabase(driver).use { db ->
                    id = CheckoutDatabaseContract.seed(db)
                    driver.failJournalAfter = commit
                    assertTrue(
                        "journal $commit",
                        runCatching {
                                LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                                    .settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                            }
                            .isFailure,
                    )
                    rows = db.select("order_payments").map { it.string("id") }
                    if (commit == 0) {
                        assertTrue(rows.isEmpty())
                        assertNull(activeJournal(db, id))
                    } else assertNotNull(activeJournal(db, id))
                }
                PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    if (commit == 0)
                        repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                    else repo.resume(owner, id)
                    assertEquals(2, db.select("order_payments").size)
                    assertTrue(
                        db.select("order_payments").map { it.string("id") }.containsAll(rows)
                    )
                    assertEquals("paid", db.get("orders", id)!!.string("status"))
                }
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun cancellationBetweenPaymentPhasesAndJournalFailureCannotDuplicateRows() = runBlocking {
        for (cancel in listOf(true, false)) {
            val driver =
                CheckoutFaultDriver(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
            PosDatabase(driver).use { db ->
                val id = CheckoutDatabaseContract.seed(db)
                val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                val job = Job()
                driver.afterModelWrite = {
                    driver.afterModelWrite = null
                    if (cancel) job.cancel() else driver.failNextJournal = true
                }
                assertTrue(
                    runCatching {
                            withContext(job) {
                                repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                            }
                        }
                        .isFailure
                )
                val rows = db.select("order_payments")
                assertEquals(if (cancel) 1 else 0, rows.size)
                assertEquals(
                    FinancialActionState.Recoverable,
                    repo.pendingActions("s").first().single().state,
                )
                repo.resume(owner, id)
                assertEquals(2, db.select("order_payments").size)
                assertTrue(
                    db.select("order_payments")
                        .map { it.string("id") }
                        .containsAll(rows.map { it.string("id") })
                )
                job.cancel()
            }
        }
    }

    @Test
    fun discountInsertAndTombstoneRecalculationRecoverAfterActualCloseReopen() = runBlocking {
        for ((remove, table, count) in
            listOf(
                Triple(false, "order_discounts", 0),
                Triple(false, "order_discounts", 1),
                Triple(false, "orders", 0),
                Triple(true, "order_discounts", 0),
                Triple(true, "orders", 0),
            )) {
            val file = File.createTempFile("discount-reopen-", ".sqlite")
            try {
                lateinit var id: String
                var discountId: String? = null
                val driver =
                    CheckoutFaultDriver(
                        JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                            LegacySqlSchema.create(it)
                        }
                    )
                PosDatabase(driver).use { db ->
                    id = CheckoutDatabaseContract.seed(db)
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    val input =
                        DiscountInput(
                            "pwd",
                            listOf(db.select("order_items").single().string("id")!!),
                            "Customer",
                            "ID",
                        )
                    if (remove) {
                        repo.apply(
                            owner,
                            id,
                            "applied",
                            input,
                            CheckoutApproval(owner, id, "applied", "manager"),
                        )
                        discountId = db.select("order_discounts").single().string("id")!!
                    }
                    // Force the recalculation discount UPDATE to be observable by using the
                    // first-row commit hook in this real adapter, not a fake repository.
                    driver.failTable = table
                    driver.successfulWrites = count
                    val result = runCatching {
                        if (remove)
                            repo.remove(
                                owner,
                                id,
                                "action",
                                discountId!!,
                                CheckoutApproval(owner, id, "action", "manager"),
                            )
                        else
                            repo.apply(
                                owner,
                                id,
                                "action",
                                input,
                                CheckoutApproval(owner, id, "action", "manager"),
                            )
                    }
                    if (!remove && table == "order_discounts" && count == 1) {
                        // Identical recalculation values are intentionally a DB no-op.
                        assertTrue(result.isSuccess)
                    } else assertTrue("$remove/$table/$count", result.isFailure)
                    if (!remove)
                        discountId = db.select("order_discounts").singleOrNull()?.string("id")
                }
                PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    repo.resume(owner, id)
                    val row = db.select("order_discounts").single()
                    if (discountId != null) assertEquals(discountId, row.string("id"))
                    assertEquals(if (remove) "deleted" else "created", row.string("_status"))
                    assertEquals(
                        if (remove) 280.0 else 240.0,
                        db.get("orders", id)!!.number("net_sales"),
                        0.0,
                    )
                    assertTrue(repo.pendingActions("s").first().isEmpty())
                }
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun siblingOpenTabAndSimultaneousSettlementKeepTableOccupiedAndPaymentIdsStable() =
        runBlocking {
            PosDatabase(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
                .use { db ->
                    val id = CheckoutDatabaseContract.seed(db)
                    LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
                        .createOrder(NewOrder("s", tableId = "t"))
                    db.updateLocal(
                        "tables",
                        "t",
                        fields("status" to "occupied", "current_order_id" to id),
                    )
                    val repo = LocalCheckoutRepository(db, Dispatchers.IO, { owner })
                    val receipts = coroutineScope {
                        List(5) {
                                async {
                                    repo.settle(
                                        owner,
                                        CheckoutRoute(id, "dine_in"),
                                        lines,
                                        "Cashier",
                                    )
                                }
                            }
                            .awaitAll()
                    }
                    assertEquals(1, receipts.distinct().size)
                    assertEquals(2, db.select("order_payments").size)
                    assertEquals("occupied", db.get("tables", "t")!!.string("status"))
                    assertEquals(id, db.get("tables", "t")!!.string("current_order_id"))
                }
        }

    @Test
    fun missingMalformedVersionAndPaidWithoutIntentCannotMintPayments() = runBlocking {
        for (bad in listOf<String?>(null, "{broken", "{}", "{\"version\":99}")) {
            PosDatabase(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
                .use { db ->
                    val id = CheckoutDatabaseContract.seed(db)
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    db.setLocalValue(activeKey(id), "missing")
                    if (bad != null)
                        db.setLocalValue(
                            "kotlin.checkout.journal:" +
                                JsonArray(listOf(JsonPrimitive(id), JsonPrimitive("missing"))),
                            bad,
                        )
                    assertEquals(
                        FinancialActionState.Unreadable,
                        repo.pendingActions("s").first().single().state,
                    )
                    assertTrue(
                        runCatching {
                                repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                            }
                            .isFailure
                    )
                    assertTrue(db.select("order_payments").isEmpty())
                    assertEquals("missing", db.localValue(activeKey(id)))
                }
        }
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                val id = CheckoutDatabaseContract.seed(db)
                db.updateLocal("orders", id, fields("status" to "paid"))
                val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                assertTrue(
                    runCatching {
                            repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                        }
                        .isFailure
                )
                assertTrue(db.select("order_payments").isEmpty())
            }
    }

    @Test
    fun schedulerFailureAfterLocalCommitDoesNotCauseAnotherSettlement() = runBlocking {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                val id = CheckoutDatabaseContract.seed(db)
                val repo =
                    LocalCheckoutRepository(
                        db,
                        Dispatchers.Unconfined,
                        { owner },
                        { error("Synthetic scheduler failure") },
                    )
                repeat(2) {
                    assertTrue(
                        runCatching {
                                repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                            }
                            .isFailure
                    )
                }
                assertEquals("paid", db.get("orders", id)!!.string("status"))
                assertEquals(2, db.select("order_payments").size)
                assertNotNull(
                    LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner }).resume(owner, id)
                )
            }
    }

    @Test
    fun acknowledgedRowsDoNotHideUnfinishedActionAndFinancialConflictIsRetained() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { db ->
            val id = CheckoutDatabaseContract.seed(db)
            val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
            driver.failTable = "order_payments"
            driver.successfulWrites = 1
            assertTrue(
                runCatching { repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier") }
                    .isFailure
            )
            db.acknowledge(db.pendingChanges(), emptySet())
            assertEquals(0, db.pendingCount())
            assertEquals(
                FinancialActionState.Recoverable,
                repo.pendingActions("s").first().single().state,
            )
            val payment = db.select("order_payments").single()
            db.applyRemote(
                "order_payments",
                emptyList(),
                listOf(
                    row(
                        payment.string("id")!!,
                        "server_id" to "server-payment",
                        "created_by" to "cashier",
                    )
                ),
                emptyList(),
            )
            assertEquals(
                FinancialActionState.Recoverable,
                repo.pendingActions("s").first().single().state,
            )
            val item = db.select("order_items").single().string("id")!!
            db.applyRemote(
                "order_items",
                emptyList(),
                listOf(row(item, "quantity" to 7)),
                emptyList(),
            )
            assertEquals(
                FinancialActionState.Conflicted,
                repo.pendingActions("s").first().single().state,
            )
            assertTrue(runCatching { repo.resume(owner, id) }.isFailure)
            assertEquals(
                listOf(payment.string("id")),
                db.select("order_payments").map { it.string("id") },
            )
        }
    }

    @Test
    fun foreignStepIdentityAndUnsupportedJournalNeverWriteOrDisappear() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { db ->
            val id = CheckoutDatabaseContract.seed(db)
            val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
            driver.failTable = "order_payments"
            driver.successfulWrites = 0
            assertTrue(
                runCatching { repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier") }
                    .isFailure
            )
            val journal = activeJournal(db, id)!!
            val index = journal.steps.indexOfFirst { it.table == "order_payments" }
            val foreign =
                journal.copy(
                    steps =
                        journal.steps.mapIndexed { i, step ->
                            if (i == index)
                                step.copy(
                                    values =
                                        JsonObject(
                                            step.values + ("order_id" to JsonPrimitive("foreign"))
                                        )
                                )
                            else step
                        }
                )
            saveJournal(db, foreign)
            assertEquals(
                FinancialActionState.Unreadable,
                repo.pendingActions("s").first().single().state,
            )
            assertTrue(runCatching { repo.resume(owner, id) }.isFailure)
            assertTrue(db.select("order_payments").isEmpty())
            assertNotNull(activeJournal(db, id))
        }
    }

    @Test
    fun interruptedPaymentRowsPreventEditorMutationButNotOtherOrders() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { db ->
            val id = CheckoutDatabaseContract.seed(db)
            val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
            driver.failTable = "order_payments"
            driver.successfulWrites = 1
            assertTrue(
                runCatching { repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier") }
                    .isFailure
            )
            assertEquals(1, db.select("order_payments").size)
            assertEquals("open", db.get("orders", id)!!.string("status"))
            val entry = LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
            val item = db.select("order_items").single().string("id")!!
            assertTrue(
                "Pending payment rows must protect the cart",
                runCatching { entry.quantity(item, 7.0) }.isFailure,
            )
            assertTrue(runCatching { entry.cancel(id) }.isFailure)
            assertTrue(runCatching { entry.customer(id, "changed") }.isFailure)
            val other = entry.createDraft("s")
            entry.addItem(other, ItemInput("p", 1.0))
            assertEquals(112.0, db.get("orders", other)!!.number("net_sales"), 0.0)
            val receipt = repo.resume(owner, id)!!
            assertEquals(280.0, receipt.payments.sumOf { it.amount }, 0.0)
        }
    }

    @Test
    fun everySourcePaymentCommitCanResumeAfterRealDiskCloseReopen() = runBlocking {
        for ((table, count) in
            listOf(
                "orders" to 0,
                "order_payments" to 0,
                "order_payments" to 1,
                "orders" to 1,
                "tables" to 0,
            )) {
            val file = File.createTempFile("checkout-reopen-", ".sqlite")
            try {
                lateinit var id: String
                var recorded: List<String?> = emptyList()
                PosDatabase(
                        CheckoutFaultDriver(
                                JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                                    LegacySqlSchema.create(it)
                                }
                            )
                            .also { driver ->
                                // Arm only after seeding below.
                            }
                    )
                    .use { db ->
                        id = CheckoutDatabaseContract.seed(db)
                        // Use a second owner on the same actual file to inject the selected phase.
                    }
                val driver =
                    CheckoutFaultDriver(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}"))
                PosDatabase(driver).use { db ->
                    // Force a real recalc UPDATE so the first orders phase is observable.
                    db.updateLocal(
                        "orders",
                        id,
                        row("unused", "net_sales" to 0).let {
                            kotlinx.serialization.json.JsonObject(it - "id")
                        },
                    )
                    driver.failTable = table
                    driver.successfulWrites = count
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    assertTrue(
                        "$table/$count failure must be observed",
                        runCatching {
                                repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                            }
                            .isFailure,
                    )
                    recorded = db.select("order_payments").map { it.string("id") }
                }
                PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                    var current: CheckoutOwner? = owner
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { current })
                    current = CheckoutOwner("other", "s")
                    assertTrue(runCatching { repo.resume(current!!, id) }.isFailure)
                    current = owner
                    assertTrue(
                        runCatching {
                                repo.settle(
                                    owner,
                                    CheckoutRoute(id, "dine_in"),
                                    listOf(PaymentLine(cashReceived = "999")),
                                    "Cashier",
                                )
                            }
                            .isFailure
                    )
                    val completed = repo.resume(owner, id)!!
                    assertEquals(2, db.select("order_payments").size)
                    assertTrue(
                        db.select("order_payments").map { it.string("id") }.containsAll(recorded)
                    )
                    assertEquals("paid", db.get("orders", id)!!.string("status"))
                    assertEquals("available", db.get("tables", "t")!!.string("status"))
                    assertEquals(completed, repo.resume(owner, id))
                }
            } finally {
                file.delete()
            }
        }
    }
}
