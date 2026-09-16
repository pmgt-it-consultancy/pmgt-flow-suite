package com.pmgt.pos.checkout

import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*

class LocalCheckoutRepository(
    private val db: PosDatabase,
    private val io: CoroutineDispatcher,
    private val currentOwner: () -> CheckoutOwner?,
    private val triggerPush: () -> Unit = {},
    private val clock: () -> Long = System::currentTimeMillis,
) : CheckoutRepository {
    override suspend fun recoverablePayment(owner: CheckoutOwner, orderId: String): CheckoutRoute? =
        withContext(io) {
            db.transaction {
                if (currentOwner() != owner) return@transaction null
                val journal = activeJournal(db, orderId) ?: return@transaction null
                if (journal.owner != owner || journal.kind != "payment" || journal.done)
                    return@transaction null
                validateJournal(db, journal, orderId, journal.id)
                if (
                    db.get("orders", orderId)?.string("status") != "paid" ||
                        fingerprint(db, orderId) != journal.fingerprint
                )
                    null
                else journal.completion?.route
            }
        }

    override fun pendingActions(storeId: String): Flow<List<PendingFinancialAction>> =
        db.changes
            .map {
                db.transaction {
                    val active = db.checkoutPointers()
                    val settled = db.checkoutPointers(settled = true)
                    (active.map { Triple(it.key, it.value, false) } +
                            settled.map { Triple(it.key, it.value, true) })
                        .mapNotNull { (orderId, id, isSettled) ->
                            try {
                                val journal = requireNotNull(loadJournal(db, orderId, id))
                                validateJournal(db, journal, orderId, id)
                                check(
                                    journal.done == isSettled &&
                                        (!isSettled || journal.kind == "payment")
                                )
                                check(if (isSettled) orderId !in active else orderId !in settled)
                                if (journal.owner.storeId != storeId || journal.done) null
                                else
                                    PendingFinancialAction(
                                        orderId,
                                        journal.kind,
                                        if (fingerprint(db, orderId) == journal.fingerprint)
                                            FinancialActionState.Recoverable
                                        else FinancialActionState.Conflicted,
                                    )
                            } catch (_: Exception) {
                                PendingFinancialAction(null, null, FinancialActionState.Unreadable)
                            }
                        }
                }
            }
            .distinctUntilChanged()
            .flowOn(io)

    override fun observe(owner: CheckoutOwner, orderId: String): Flow<CheckoutView?> =
        db.changes
            .map {
                db.transaction {
                    val order = db.get("orders", orderId)
                    if (
                        order?.string("store_id") != owner.storeId ||
                            order.string("_status") == "deleted"
                    )
                        null
                    else readView(db, orderId)
                }
            }
            .distinctUntilChanged()
            .flowOn(io)

    private fun checkOwner(owner: CheckoutOwner, orderId: String) {
        check(currentOwner() == owner) { "Checkout session has changed" }
        val order = db.get("orders", orderId)
        check(order?.string("store_id") == owner.storeId && order.string("_status") != "deleted") {
            "Order is unavailable for this store"
        }
    }

    override suspend fun refreshTotals(owner: CheckoutOwner, orderId: String) =
        withContext(io) {
            synchronized(db) {
                checkOwner(owner, orderId)
                db.requireOrderWritable(orderId)
                val graph = readOrderGraph(db, orderId)
                if (graph.parent.string("status") == "open" && graph.items.isNotEmpty())
                    recalculationWrites(graph).forEach {
                        db.updateLocal(it.table, it.id, it.values)
                    }
            }
        }

    override suspend fun resume(owner: CheckoutOwner, orderId: String): CompletedCheckout? =
        withContext(io) {
            val context = currentCoroutineContext()
            val result =
                synchronized(db) {
                    checkOwner(owner, orderId)
                    val journal = activeJournal(db, orderId) ?: settledJournal(db, orderId)
                    journal?.let { finish(it, owner, context).completion }
                }
            triggerPush()
            result
        }

    override suspend fun settle(
        owner: CheckoutOwner,
        route: CheckoutRoute,
        lines: List<PaymentLine>,
        cashierName: String,
    ): CompletedCheckout =
        withContext(io) {
            val context = currentCoroutineContext()
            val result =
                synchronized(db) {
                    checkOwner(owner, route.orderId)
                    check(PaymentMath.validIdentities(lines)) { "Payment lines are invalid" }
                    val old = activeJournal(db, route.orderId) ?: settledJournal(db, route.orderId)
                    if (old != null) {
                        check(
                            old.kind == "payment" &&
                                old.completion?.lines == lines &&
                                old.completion.route == route
                        ) {
                            "Saved checkout must be resumed with its original payment details"
                        }
                        requireNotNull(finish(old, owner, context).completion)
                    } else {
                        val graph = readOrderGraph(db, route.orderId)
                        check(graph.parent.string("status") == "open") {
                            "Order is already settled or is not open"
                        }
                        check(
                            db.select(
                                    "order_payments",
                                    "order_id = ? AND _status != 'deleted'",
                                    listOf(route.orderId),
                                )
                                .isEmpty()
                        ) {
                            "Payment records already exist. This checkout needs review before continuing."
                        }
                        val view = readView(db, route.orderId)
                        val due = view.cart.checkoutTotals().netSales
                        check(lines.isNotEmpty()) { "Please add a payment method" }
                        PaymentMath.validation(lines, due)?.let { error(it) }
                        val payments = PaymentMath.build(lines, due)
                        check(
                            payments.all {
                                it.amount.isFinite() &&
                                    it.cashReceived?.isFinite() != false &&
                                    it.changeGiven?.isFinite() != false
                            }
                        ) {
                            "Please enter a valid payment amount"
                        }
                        val now = 0L
                        val complete =
                            CompletedCheckout(
                                view,
                                route,
                                cashierName,
                                lines.toList(),
                                payments,
                                now,
                                PaymentMath.coverage(lines, due).totalChange,
                            )
                        val draft =
                            CheckoutJournal(
                                uid(),
                                owner,
                                route.orderId,
                                "payment",
                                fingerprint(db, route.orderId),
                                emptyList(),
                                tableId =
                                    graph.parent.string("table_id")?.takeIf { it.isNotEmpty() },
                                completion = complete,
                                baseline = captureBaseline(db, graph),
                                allocatedIds = payments.map { uid() },
                            )
                        val journal = draft.copy(steps = canonicalSteps(draft))
                        saveNew(db, journal)
                        requireNotNull(finish(journal, owner, context).completion)
                    }
                }
            triggerPush()
            result
        }

    override suspend fun apply(
        owner: CheckoutOwner,
        orderId: String,
        actionId: String,
        input: DiscountInput,
        approval: CheckoutApproval,
    ) =
        withContext(io) {
            val context = currentCoroutineContext()
            synchronized(db) {
                checkOwner(owner, orderId)
                checkApproval(approval, owner, orderId, actionId)
                val intent = Json.encodeToJsonElement(input).toString()
                val existing = loadJournal(db, orderId, actionId)
                if (existing != null) {
                    check(
                        existing.kind == "discount" &&
                            existing.input == intent &&
                            existing.managerId == approval.managerId
                    ) {
                        "Discount intent has changed"
                    }
                    finish(existing, owner, context)
                } else {
                    db.requireOrderWritable(orderId)
                    val graph = readOrderGraph(db, orderId)
                    check(graph.parent.string("status") == "open") { "Order is not open" }
                    check(
                        input.type in listOf("senior_citizen", "pwd") &&
                            input.itemIds.isNotEmpty() &&
                            input.itemIds.distinct().size == input.itemIds.size &&
                            input.customerName.trim().isNotEmpty() &&
                            input.customerId.trim().isNotEmpty()
                    ) {
                        "Please complete the discount details"
                    }
                    input.itemIds.forEach { id ->
                        val item =
                            requireNotNull(graph.items.find { it.string("id") == id }) {
                                "Discount item is unavailable"
                            }
                        check(
                            graph.discounts
                                .filter { it.string("order_item_id") == id }
                                .fold(0.0) { sum, d -> sum + d.number("quantity_applied") } == 0.0
                        ) {
                            "This item already has a discount"
                        }
                        requireNotNull(graph.products[item.string("product_id")]) {
                            "Discount product is unavailable"
                        }
                    }
                    val draft =
                        CheckoutJournal(
                            actionId,
                            owner,
                            orderId,
                            "discount",
                            fingerprint(db, orderId),
                            emptyList(),
                            input = intent,
                            managerId = approval.managerId,
                            baseline = captureBaseline(db, graph),
                            allocatedIds = input.itemIds.map { uid() },
                        )
                    val journal = draft.copy(steps = canonicalSteps(draft))
                    validateJournal(db, journal, orderId, actionId)
                    saveNew(db, journal)
                    finish(journal, owner, context)
                }
            }
            triggerPush()
        }

    override suspend fun remove(
        owner: CheckoutOwner,
        orderId: String,
        actionId: String,
        discountId: String,
        approval: CheckoutApproval,
    ) =
        withContext(io) {
            val context = currentCoroutineContext()
            synchronized(db) {
                checkOwner(owner, orderId)
                checkApproval(approval, owner, orderId, actionId)
                val existing = loadJournal(db, orderId, actionId)
                if (existing != null) {
                    check(
                        existing.kind == "remove" &&
                            existing.input == discountId &&
                            existing.managerId == approval.managerId
                    ) {
                        "Discount removal intent has changed"
                    }
                    finish(existing, owner, context)
                } else {
                    db.requireOrderWritable(orderId)
                    val graph = readOrderGraph(db, orderId)
                    check(graph.parent.string("status") == "open") { "Order is not open" }
                    check(graph.discounts.any { it.string("id") == discountId }) {
                        "Discount is unavailable"
                    }
                    val draft =
                        CheckoutJournal(
                            actionId,
                            owner,
                            orderId,
                            "remove",
                            fingerprint(db, orderId),
                            emptyList(),
                            input = discountId,
                            managerId = approval.managerId,
                            baseline = captureBaseline(db, graph),
                        )
                    val journal = draft.copy(steps = canonicalSteps(draft))
                    saveNew(db, journal)
                    finish(journal, owner, context)
                }
            }
            triggerPush()
        }

    private fun finish(
        initial: CheckoutJournal,
        owner: CheckoutOwner,
        context: kotlin.coroutines.CoroutineContext,
    ): CheckoutJournal {
        check(initial.owner == owner) { "Saved checkout belongs to another cashier session" }
        validateJournal(db, initial, initial.orderId, initial.id)
        var journal = initial
        if (journal.done) return journal
        while (true) {
            context.ensureActive()
            checkOwner(owner, journal.orderId)
            check(fingerprint(db, journal.orderId) == journal.fingerprint) {
                "Order changed after checkout started. Saved payment work is retained for review."
            }
            journal =
                db.transaction {
                    if (journal.next < journal.steps.size) {
                        val planned = journal.steps[journal.next]
                        val stamped =
                            if ("created_at" in planned.values || "paid_at" in planned.values)
                                journal.copy(
                                    executedAt = journal.executedAt + (journal.next to clock())
                                )
                            else journal
                        val executing = stamped.copy(steps = canonicalSteps(stamped))
                        val step = executing.steps[journal.next]
                        when (step.operation) {
                            "insert" ->
                                db.insertLocal(
                                    step.table,
                                    JsonObject(step.values + fields("id" to step.id)),
                                )
                            "update" -> db.updateLocal(step.table, step.id, step.values)
                            "delete" -> db.deleteLocal(step.table, step.id)
                            else -> error("Unknown checkout phase")
                        }
                        executing
                            .copy(
                                next = journal.next + 1,
                                fingerprint = fingerprint(db, journal.orderId),
                            )
                            .also { saveJournal(db, it) }
                    } else {
                        journal.tableId?.let { tableId ->
                            val table = db.get("tables", tableId)
                            check(
                                table?.string("store_id") == owner.storeId &&
                                    table.string("_status") != "deleted"
                            ) {
                                "Checkout table is unavailable for this store"
                            }
                            if (
                                db.select(
                                        "orders",
                                        "table_id = ? AND status = 'open' AND _status != 'deleted'",
                                        listOf(tableId),
                                    )
                                    .isEmpty()
                            )
                                db.updateLocal("tables", tableId, fields("status" to "available"))
                        }
                        val completedAt = clock()
                        journal
                            .copy(
                                done = true,
                                completedAt = completedAt,
                                completion = journal.completion?.copy(transactionAt = completedAt),
                            )
                            .also {
                                saveJournal(db, it)
                                db.setLocalValue(activeKey(it.orderId), "")
                                if (it.kind == "payment")
                                    db.setLocalValue(settledKey(it.orderId), it.id)
                            }
                    }
                }
            if (journal.done) return journal
        }
    }

    private fun checkApproval(
        a: CheckoutApproval,
        owner: CheckoutOwner,
        orderId: String,
        actionId: String,
    ) {
        check(
            a.isCurrent() &&
                a.owner == owner &&
                a.orderId == orderId &&
                a.actionId == actionId &&
                a.managerId.isNotEmpty()
        ) {
            "Manager approval no longer matches this action"
        }
    }

    private fun uid() = UUID.randomUUID().toString()
}

internal fun readView(db: PosDatabase, orderId: String): CheckoutView {
    val graph = readOrderGraph(db, orderId)
    val store = requireNotNull(db.get("stores", graph.parent.string("store_id")!!))
    return CheckoutView(
        graph.cart(db),
        graph.discounts.map { d ->
            CheckoutDiscount(
                d.string("id")!!,
                d.string("order_item_id"),
                d.string("discount_type").orEmpty(),
                d.string("customer_name").orEmpty(),
                d.string("customer_id").orEmpty(),
                graph.items
                    .find { it.string("id") == d.string("order_item_id") }
                    ?.string("product_name"),
                d.number("discount_amount"),
                d.string("approved_by"),
            )
        },
        CheckoutStore(
            store.string("name") ?: "Store",
            store.string("address1"),
            store.string("address2"),
            store.string("tin"),
            store.string("contact_number"),
            store.string("telephone"),
            store.string("email"),
            store.string("website"),
            store.string("footer"),
        ),
    )
}
