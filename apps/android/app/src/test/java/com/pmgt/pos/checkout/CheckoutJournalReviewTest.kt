package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CheckoutJournalReviewTest {
    private val owner = CheckoutDatabaseContract.owner
    private val lines =
        listOf(PaymentLine("a", cashReceived = "200"), PaymentLine("b", cashReceived = "200"))

    @Test
    fun activeAndSettledPointerRolesCannotAuthorizeImpossibleCompletion() = runBlocking {
        for (complete in listOf(false, true)) for (coexisting in listOf(false, true)) {
            val fault =
                CheckoutFaultDriver(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
            PosDatabase(fault).use { db ->
                val id = CheckoutDatabaseContract.seed(db)
                val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                if (!complete) fault.failTable = "order_payments"
                runCatching { repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier") }
                val j = (if (complete) settledJournal(db, id) else activeJournal(db, id))!!
                db.setLocalValue(if (complete) activeKey(id) else settledKey(id), j.id)
                if (!coexisting)
                    db.setLocalValue(if (complete) settledKey(id) else activeKey(id), "")
                val rows =
                    listOf("orders", "order_payments", "tables").associateWith { db.select(it) }
                assertTrue(
                    repo.pendingActions("s").first().all {
                        it.state == FinancialActionState.Unreadable
                    }
                )
                assertTrue(
                    "A pointer to the wrong journal phase must not resume or report completion",
                    runCatching { repo.resume(owner, id) }.isFailure,
                )
                rows.forEach { (table, before) -> assertEquals(before, db.select(table)) }
                assertEquals(j.id, db.localValue(if (complete) activeKey(id) else settledKey(id)))
            }
        }
    }

    @Test
    fun everyExecutionTimestampAndDiscountPurgeSurvivesRealReopen() = runBlocking {
        for (discount in listOf(false, true)) {
            val file = File.createTempFile("checkout-v2-contract-", ".sqlite")
            var first = true
            try {
                val open = {
                    val fault =
                        CheckoutFaultDriver(
                            JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                                if (first) {
                                    LegacySqlSchema.create(it)
                                    first = false
                                }
                            }
                        )
                    PosDatabase(fault) to fault
                }
                if (discount) CheckoutJournalReviewContract.discountInsertAndPurgedRemoval(open)
                else CheckoutJournalReviewContract.firstExecutionAcrossCloseReopen(open)
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun paymentTimestampsFollowFirstCommittedExecutionAcrossMidnight() = runBlocking {
        val file = File.createTempFile("checkout-clock-", ".sqlite")
        try {
            lateinit var id: String
            lateinit var firstId: String
            var now = 1_800_057_599_000L
            val driver =
                CheckoutFaultDriver(
                    JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                        LegacySqlSchema.create(it)
                    }
                )
            PosDatabase(driver).use { db ->
                id = CheckoutDatabaseContract.seed(db)
                driver.failTable = "order_payments"
                driver.successfulWrites = 1
                val repo =
                    LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner }, clock = { now })
                assertTrue(
                    runCatching {
                            repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                        }
                        .isFailure
                )
                val first = db.select("order_payments").single()
                firstId = first.string("id")!!
                assertEquals(1_800_057_599_000.0, first.number("created_at"), 0.0)
                assertEquals("open", db.get("orders", id)!!.string("status"))
            }
            now = 1_800_057_601_000L
            PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                val repo =
                    LocalCheckoutRepository(
                        db,
                        Dispatchers.Unconfined,
                        { owner },
                        clock = { now++ },
                    )
                val completed = repo.resume(owner, id)!!
                assertEquals(
                    1_800_057_599_000.0,
                    db.get("order_payments", firstId)!!.number("created_at"),
                    0.0,
                )
                assertEquals(
                    1_800_057_601_000.0,
                    db.select("order_payments")
                        .single { it.string("id") != firstId }
                        .number("created_at"),
                    0.0,
                )
                assertEquals(1_800_057_601_001.0, db.get("orders", id)!!.number("paid_at"), 0.0)
                assertEquals(1_800_057_601_002L, completed.transactionAt)
                now += 86_400_000
                assertEquals(completed, repo.resume(owner, id))
            }
        } finally {
            file.delete()
        }
    }

    @Test
    fun oldActiveAndSettledJournalsRetainEvidenceAndBlockUnknownCompletion() = runBlocking {
        for (complete in listOf(false, true)) {
            val driver =
                CheckoutFaultDriver(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
            PosDatabase(driver).use { db ->
                val id = CheckoutDatabaseContract.seed(db)
                val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                if (!complete) driver.failTable = "order_payments"
                runCatching { repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier") }
                val journal = (if (complete) settledJournal(db, id) else activeJournal(db, id))!!
                val key =
                    "kotlin.checkout.journal:" +
                        JsonArray(listOf(JsonPrimitive(id), JsonPrimitive(journal.id)))
                val old =
                    JsonObject(
                            Json.parseToJsonElement(db.localValue(key)!!).jsonObject +
                                ("version" to JsonPrimitive(1))
                        )
                        .toString()
                db.setLocalValue(key, old)
                val payments = db.select("order_payments")
                assertEquals(
                    FinancialActionState.Unreadable,
                    repo.pendingActions("s").first().single().state,
                )
                assertTrue(runCatching { repo.resume(owner, id) }.isFailure)
                assertEquals(old, db.localValue(key))
                assertEquals(payments, db.select("order_payments"))
            }
        }
    }

    @Test
    fun missingPaidTransitionCannotCompleteAnOpenOrder() = runBlocking {
        corrupt("payment") { j ->
            j.copy(steps = j.steps.filterNot { it.values.string("status") == "paid" })
        }
    }

    @Test
    fun alteredRecalculationCannotBecomeTrustedFinancialState() = runBlocking {
        for (kind in listOf("payment", "discount", "remove")) corrupt(kind) { j ->
            j.copy(
                steps =
                    j.steps.map { step ->
                        if ("net_sales" in step.values)
                            step.copy(
                                values = JsonObject(step.values + fields("net_sales" to 999.0))
                            )
                        else step
                    }
            )
        }
    }

    @Test
    fun missingDiscountInsertionCannotPretendApprovedActionCompleted() = runBlocking {
        corrupt("discount") { j -> j.copy(steps = j.steps.filterNot { it.operation == "insert" }) }
    }

    @Test
    fun missingDiscountDeletionCannotPretendRemovalCompleted() = runBlocking {
        corrupt("remove") { j -> j.copy(steps = j.steps.filterNot { it.operation == "delete" }) }
    }

    @Test
    fun reorderedAndDuplicatedPhasesCannotWrite() = runBlocking {
        for (kind in listOf("payment", "discount", "remove")) {
            corrupt(kind) { j -> j.copy(steps = j.steps.reversed()) }
            corrupt(kind) { j -> j.copy(steps = j.steps + j.steps.last()) }
        }
    }

    @Test
    fun everyRequiredPhaseAndCanonicalFieldIsValidated() = runBlocking {
        for (kind in listOf("payment", "discount", "remove")) {
            // Each source phase is mandatory, even a recalculation whose values happen to be
            // unchanged.
            val count =
                when (kind) {
                    "payment" -> 4
                    "discount" -> 3
                    else -> 2
                }
            repeat(count) { index ->
                corrupt(kind) { j -> j.copy(steps = j.steps.filterIndexed { i, _ -> i != index }) }
            }
            corrupt(kind) { j ->
                j.copy(
                    steps =
                        j.steps.map { step ->
                            if (step.table == "orders" && "net_sales" in step.values)
                                step.copy(
                                    values =
                                        JsonObject(step.values + fields("discount_amount" to 3.0))
                                )
                            else step
                        }
                )
            }
        }
        for (field in
            listOf(
                "amount",
                "cash_received",
                "change_given",
                "card_reference_number",
                "payment_method",
                "created_at",
            )) corrupt("payment") { j ->
            j.copy(
                steps =
                    j.steps.map { step ->
                        if (step.table == "order_payments")
                            step.copy(
                                values =
                                    JsonObject(
                                        step.values +
                                            fields(
                                                field to
                                                    if (
                                                        field in
                                                            listOf(
                                                                "payment_method",
                                                                "card_reference_number",
                                                            )
                                                    )
                                                        "corrupt"
                                                    else 123.0
                                            )
                                    )
                            )
                        else step
                    }
            )
        }
        for (field in
            listOf(
                "quantity_applied",
                "discount_amount",
                "vat_exempt_amount",
                "customer_name",
                "customer_id",
                "approved_by",
                "discount_type",
                "created_at",
            )) corrupt("discount") { j ->
            j.copy(
                steps =
                    j.steps.map { step ->
                        if (step.operation == "insert")
                            step.copy(
                                values =
                                    JsonObject(
                                        step.values +
                                            fields(
                                                field to
                                                    if (
                                                        field in
                                                            listOf(
                                                                "customer_name",
                                                                "customer_id",
                                                                "approved_by",
                                                                "discount_type",
                                                            )
                                                    )
                                                        "corrupt"
                                                    else 123.0
                                            )
                                    )
                            )
                        else step
                    }
            )
        }
    }

    @Test
    fun invalidOriginalInputsCannotAuthorizeAPlan() = runBlocking {
        for (kind in listOf("payment", "discount", "remove")) {
            corrupt(kind) { j ->
                j.copy(
                    baseline =
                        j.baseline!!.copy(
                            parent = JsonObject(j.baseline.parent + fields("store_id" to "foreign"))
                        )
                )
            }
            corrupt(kind) { j ->
                j.copy(
                    baseline =
                        j.baseline!!.copy(
                            items =
                                j.baseline.items.map { JsonObject(it + fields("quantity" to 7.0)) }
                        )
                )
            }
            corrupt(kind) { j ->
                j.copy(
                    baseline =
                        j.baseline!!.copy(parent = JsonObject(j.baseline.parent - "net_sales"))
                )
            }
        }
    }

    @Test
    fun missingUnknownMalformedAndForeignOldPointersRemainScopedAndIntact() = runBlocking {
        for (complete in listOf(false, true)) for (bad in
            listOf("v1", "unknown", "missing", "malformed", "foreign", "foreign-order")) {
            val file = File.createTempFile("checkout-old-pointer-", ".sqlite")
            try {
                lateinit var id: String
                lateinit var key: String
                lateinit var target: String
                var payload: String? = null
                lateinit var rows: List<Row>
                PosDatabase(
                        CheckoutFaultDriver(
                            JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                                LegacySqlSchema.create(it)
                            }
                        )
                    )
                    .use { db ->
                        id = CheckoutDatabaseContract.seed(db)
                        val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                        repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                        val j = settledJournal(db, id)!!
                        target = if (bad == "missing") "unknown-pointer-target" else j.id
                        key =
                            "kotlin.checkout.journal:" +
                                JsonArray(listOf(JsonPrimitive(id), JsonPrimitive(target)))
                        val raw =
                            Json.parseToJsonElement(
                                    db.localValue(
                                        "kotlin.checkout.journal:" +
                                            JsonArray(
                                                listOf(JsonPrimitive(id), JsonPrimitive(j.id))
                                            )
                                    )!!
                                )
                                .jsonObject
                        payload =
                            when (bad) {
                                "missing" -> null
                                "malformed" -> "{incomplete"
                                "foreign" ->
                                    JsonObject(
                                            raw +
                                                ("owner" to
                                                    fields(
                                                        "userId" to "foreign",
                                                        "storeId" to "other",
                                                    ))
                                        )
                                        .toString()
                                "foreign-order" ->
                                    JsonObject(raw + fields("orderId" to "foreign-order"))
                                        .toString()
                                else ->
                                    JsonObject(
                                            (if (bad == "v1")
                                                raw -
                                                    setOf(
                                                        "baseline",
                                                        "allocatedIds",
                                                        "executedAt",
                                                        "completedAt",
                                                    )
                                            else raw) +
                                                ("version" to
                                                    JsonPrimitive(if (bad == "v1") 1 else 99))
                                        )
                                        .toString()
                            }
                        if (payload != null) db.setLocalValue(key, payload!!)
                        db.setLocalValue(if (complete) settledKey(id) else activeKey(id), target)
                        rows = db.select("order_payments")
                    }
                PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    assertTrue(
                        repo.pendingActions("s").first().all {
                            it.state == FinancialActionState.Unreadable
                        }
                    )
                    assertTrue(repo.pendingActions("s").first().isNotEmpty())
                    assertTrue(runCatching { repo.resume(owner, id) }.isFailure)
                    assertTrue(
                        runCatching {
                                repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                            }
                            .isFailure
                    )
                    assertTrue(runCatching { db.requireOrderWritable(id) }.isFailure)
                    assertEquals(rows, db.select("order_payments"))
                    assertEquals(payload, db.localValue(key))
                    assertEquals(
                        target,
                        db.localValue(if (complete) settledKey(id) else activeKey(id)),
                    )
                    val entry = LocalOrderRepository(db, Dispatchers.Unconfined, { "device" })
                    val other = entry.createOrder(NewOrder("s"))
                    entry.addItem(other, ItemInput("p", 1.0))
                    assertEquals(112.0, db.get("orders", other)!!.number("net_sales"), 0.0)
                }
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun intentBeforeAnyFinancialCommitHasNoHistoricalEventTimestamp() = runBlocking {
        val file = File.createTempFile("checkout-before-first-phase-", ".sqlite")
        try {
            lateinit var id: String
            var clockReads = 0
            val fault =
                CheckoutFaultDriver(
                    JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                        LegacySqlSchema.create(it)
                    }
                )
            PosDatabase(fault).use { db ->
                id = CheckoutDatabaseContract.seed(db)
                fault.failJournalAfter = 1
                val repo =
                    LocalCheckoutRepository(
                        db,
                        Dispatchers.Unconfined,
                        { owner },
                        clock = {
                            clockReads++
                            1_800_057_599_000L
                        },
                    )
                assertTrue(
                    runCatching {
                            repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                        }
                        .isFailure
                )
                assertEquals(0, clockReads)
                val journal = activeJournal(db, id)!!
                assertEquals(0, journal.next)
                assertTrue(journal.executedAt.isEmpty())
                assertNull(journal.completedAt)
                assertTrue(db.select("order_payments").isEmpty())
            }
            PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                val repo =
                    LocalCheckoutRepository(
                        db,
                        Dispatchers.Unconfined,
                        { owner },
                        clock = { 1_800_057_601_000L },
                    )
                val completed = repo.resume(owner, id)!!
                assertTrue(
                    db.select("order_payments").all {
                        it.number("created_at") == 1_800_057_601_000.0
                    }
                )
                assertEquals(1_800_057_601_000.0, db.get("orders", id)!!.number("paid_at"), 0.0)
                assertEquals(1_800_057_601_000L, completed.transactionAt)
            }
        } finally {
            file.delete()
        }
    }

    @Test
    fun genuineRemoteFinancialAndOwnershipChangesNeverResume() = runBlocking {
        for ((table, values) in
            listOf(
                "orders" to fields("net_sales" to 999.0),
                "orders" to fields("status" to "voided"),
                "orders" to fields("table_id" to "other-table"),
                "orders" to fields("store_id" to "other-store"),
                "order_payments" to fields("amount" to 999.0),
            )) {
            val fault =
                CheckoutFaultDriver(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
            PosDatabase(fault).use { db ->
                val id = CheckoutDatabaseContract.seed(db)
                val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                fault.failTable = "order_payments"
                fault.successfulWrites = 1
                assertTrue(
                    runCatching {
                            repo.settle(owner, CheckoutRoute(id, "dine_in"), lines, "Cashier")
                        }
                        .isFailure
                )
                val pointer = db.localValue(activeKey(id))
                db.acknowledge(db.pendingChanges(), emptySet())
                val rowId =
                    if (table == "orders") id
                    else db.select("order_payments").single().string("id")!!
                db.applyRemote(
                    table,
                    emptyList(),
                    listOf(JsonObject(values + fields("id" to rowId))),
                    emptyList(),
                )
                assertNotEquals(
                    FinancialActionState.Recoverable,
                    repo.pendingActions("s").first().single().state,
                )
                val rows = db.select("order_payments")
                assertTrue(runCatching { repo.resume(owner, id) }.isFailure)
                assertEquals(rows, db.select("order_payments"))
                assertEquals(pointer, db.localValue(activeKey(id)))
            }
        }
    }

    @Test
    fun canonicalNumberHydrationAfterAckResumesOriginalPaymentIds() = runBlocking {
        for (original in listOf("", "0001")) {
            val file = File.createTempFile("checkout-number-hydration-", ".sqlite")
            try {
                lateinit var id: String
                lateinit var paymentIds: List<String>
                lateinit var receiptNumber: String
                val driver =
                    CheckoutFaultDriver(
                        JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                            LegacySqlSchema.create(it)
                        }
                    )
                PosDatabase(driver).use { db ->
                    id = CheckoutDatabaseContract.seed(db)
                    db.updateLocal(
                        "orders",
                        id,
                        fields(
                            "order_number" to original,
                            "order_type" to "takeout",
                            "table_id" to null,
                        ),
                    )
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    driver.failTable = "order_payments"
                    driver.successfulWrites = 1
                    assertTrue(
                        runCatching {
                                repo.settle(owner, CheckoutRoute(id, "takeout"), lines, "Cashier")
                            }
                            .isFailure
                    )
                    val journal = activeJournal(db, id)!!
                    paymentIds = journal.steps.filter { it.table == "order_payments" }.map { it.id }
                    receiptNumber = journal.completion!!.view.cart.orderNumber
                    db.acknowledge(db.pendingChanges(), emptySet())
                    assertEquals(0, db.pendingCount())
                    db.applyRemote(
                        "orders",
                        emptyList(),
                        listOf(row(id, "server_id" to "canonical-order", "order_number" to "0099")),
                        emptyList(),
                    )
                    assertEquals("0099", db.get("orders", id)!!.string("order_number"))
                }
                PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                    val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                    assertEquals(
                        FinancialActionState.Recoverable,
                        repo.pendingActions("s").first().single().state,
                    )
                    val completed = repo.resume(owner, id)!!
                    assertEquals(paymentIds, db.select("order_payments").map { it.string("id") })
                    assertEquals(receiptNumber, completed.view.cart.orderNumber)
                    assertEquals("0099", db.get("orders", id)!!.string("order_number"))
                    assertEquals("paid", db.get("orders", id)!!.string("status"))
                    assertTrue(repo.pendingActions("s").first().isEmpty())
                }
            } finally {
                file.delete()
            }
        }
    }

    private suspend fun corrupt(kind: String, edit: (CheckoutJournal) -> CheckoutJournal) {
        val file = File.createTempFile("checkout-plan-corruption-", ".sqlite")
        try {
            lateinit var id: String
            lateinit var originalRows: Map<String, List<Row>>
            lateinit var pointer: String
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
                if (kind == "remove")
                    repo.apply(
                        owner,
                        id,
                        "existing",
                        input,
                        CheckoutApproval(owner, id, "existing", "manager"),
                    )
                driver.failJournalAfter = 1
                assertTrue(
                    runCatching {
                            when (kind) {
                                "payment" ->
                                    repo.settle(
                                        owner,
                                        CheckoutRoute(id, "dine_in"),
                                        lines,
                                        "Cashier",
                                    )
                                "discount" ->
                                    repo.apply(
                                        owner,
                                        id,
                                        "new",
                                        input,
                                        CheckoutApproval(owner, id, "new", "manager"),
                                    )
                                else ->
                                    repo.remove(
                                        owner,
                                        id,
                                        "remove",
                                        db.select("order_discounts").single().string("id")!!,
                                        CheckoutApproval(owner, id, "remove", "manager"),
                                    )
                            }
                        }
                        .isFailure
                )
                val journal = activeJournal(db, id)!!
                assertEquals(0, journal.next)
                saveJournal(db, edit(journal))
                pointer = db.localValue(activeKey(id))!!
                originalRows =
                    listOf("orders", "order_payments", "order_discounts", "tables").associateWith {
                        db.select(it)
                    }
            }
            PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                assertEquals(
                    "Corrupt $kind must remain explicitly blocked",
                    FinancialActionState.Unreadable,
                    repo.pendingActions("s").first().single().state,
                )
                assertTrue(runCatching { repo.resume(owner, id) }.isFailure)
                originalRows.forEach { (table, rows) ->
                    assertEquals("No additional $table financial writes", rows, db.select(table))
                }
                assertEquals(pointer, db.localValue(activeKey(id)))
            }
        } finally {
            file.delete()
        }
    }
}
