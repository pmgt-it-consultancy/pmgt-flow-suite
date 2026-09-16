package com.pmgt.pos.checkout

import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

class LocalCorrectionRepository(
    private val db: PosDatabase,
    private val io: CoroutineDispatcher,
    private val orders: LocalOrderRepository,
    private val currentOwner: () -> CheckoutOwner?,
    private val triggerPush: () -> Unit = {},
    private val clock: () -> Long = System::currentTimeMillis,
) : CorrectionRepository {
    override suspend fun correct(
        owner: CheckoutOwner,
        orderId: String,
        actionId: String,
        input: CorrectionInput,
        approval: CheckoutApproval,
    ): CompletedCorrection =
        withContext(io) {
            val context = currentCoroutineContext()
            val result =
                synchronized(db) {
                    checkOwner(owner, orderId)
                    check(
                        approval.isCurrent() &&
                            approval.owner == owner &&
                            approval.orderId == orderId &&
                            approval.actionId == actionId &&
                            approval.managerId.isNotEmpty()
                    ) {
                        "Manager approval no longer matches this action"
                    }
                    val existing = loadJournal(db, orderId, actionId)
                    val journal =
                        if (existing != null) {
                            check(
                                existing.owner == owner &&
                                    existing.version == 3 &&
                                    existing.correction?.input == input &&
                                    existing.managerId == approval.managerId
                            ) {
                                "Saved correction belongs to a different action"
                            }
                            existing
                        } else {
                            db.requireOrderWritable(orderId)
                            check(db.localValue(correctedKey(orderId)).isNullOrEmpty()) {
                                "Order is already corrected"
                            }
                            val graph = readOrderGraph(db, orderId)
                            check(
                                graph.products.values.all { it.string("store_id") == owner.storeId }
                            ) {
                                "Referenced product belongs to another store"
                            }
                            graph.parent
                                .string("table_id")
                                ?.takeIf { it.isNotEmpty() }
                                ?.let { tableId ->
                                    val table = db.get("tables", tableId)
                                    check(
                                        table?.string("store_id") == owner.storeId &&
                                            table.string("_status") != "deleted"
                                    ) {
                                        "Referenced table is unavailable for this store"
                                    }
                                }
                            check(graph.parent.string("status") != "voided") {
                                "Order is already voided"
                            }
                            check(input.reason.trim().isNotEmpty()) { "Please enter a reason" }
                            check(input.kind in setOf("void", "refund")) {
                                "Unsupported correction"
                            }
                            if (input.kind == "refund") {
                                check(input.itemIds.isNotEmpty()) { "No items selected for refund" }
                                check(graph.parent.string("status") == "paid") {
                                    "Can only refund paid orders"
                                }
                                input.itemIds.forEach { item ->
                                    check(graph.items.any { it.string("id") == item }) {
                                        "Item $item not found or already voided"
                                    }
                                }
                                check(input.refundMethod in setOf("cash", "card_ewallet")) {
                                    "Invalid refund method"
                                }
                            } else check(input.itemIds.isEmpty() && input.refundMethod == null)
                            val retained =
                                if (input.kind == "refund")
                                    graph.items.filter { it.string("id") !in input.itemIds }
                                else emptyList()
                            val retainedIds = retained.map { it.string("id") }.toSet()
                            val count =
                                if (retained.isEmpty()) 2
                                else
                                    4 +
                                        retained.size +
                                        retained.sumOf {
                                            graph.modifiers[it.string("id")].orEmpty().size
                                        } +
                                        graph.discounts.count {
                                            it.string("order_item_id").isNullOrEmpty() ||
                                                it.string("order_item_id") in retainedIds
                                        }
                            val draft =
                                CheckoutJournal(
                                    actionId,
                                    owner,
                                    orderId,
                                    input.kind,
                                    fingerprint(db, orderId),
                                    emptyList(),
                                    tableId =
                                        graph.parent.string("table_id")?.takeIf { it.isNotEmpty() },
                                    managerId = approval.managerId,
                                    baseline = captureBaseline(db, graph),
                                    allocatedIds = List(count) { UUID.randomUUID().toString() },
                                    version = 3,
                                    correction =
                                        CorrectionPayload(
                                            input,
                                            graph.parent.string("order_number"),
                                            if (input.kind == "refund") clock() else null,
                                        ),
                                )
                            validateJournal(db, draft, orderId, actionId)
                            saveNew(db, draft)
                            draft
                        }
                    finish(journal, owner, context)
                }
            scheduleCompletedPush()
            result
        }

    override suspend fun saved(owner: CheckoutOwner, orderId: String): SavedCorrection? =
        withContext(io) {
            db.transaction {
                checkOwner(owner, orderId)
                val j = activeJournal(db, orderId) ?: return@transaction null
                check(j.owner == owner) { "Saved action belongs to another cashier" }
                if (j.version != 3) return@transaction null
                validateJournal(db, j, orderId, j.id)
                check(j.fingerprint == fingerprint(db, orderId)) {
                    "Order changed; saved correction is retained for review"
                }
                SavedCorrection(
                    j.id,
                    j.correction!!.input,
                    j.baseline!!
                        .items
                        .filter { it.string("id") in j.correction.input.itemIds }
                        .map {
                            SavedCorrectionItem(
                                it.string("product_name").orEmpty(),
                                it.number("quantity"),
                            )
                        },
                )
            }
        }

    override suspend fun resume(
        owner: CheckoutOwner,
        orderId: String,
        expectedActionId: String?,
    ): CompletedCorrection =
        withContext(io) {
            val context = currentCoroutineContext()
            val result =
                synchronized(db) {
                    checkOwner(owner, orderId)
                    val j =
                        activeJournal(db, orderId)
                            ?: db.localValue(correctedKey(orderId))
                                ?.takeIf { it.isNotEmpty() }
                                ?.let { loadJournal(db, orderId, it) }
                    check(expectedActionId == null || j?.id == expectedActionId) {
                        "Saved correction changed; reopen its original details before continuing"
                    }
                    finish(requireNotNull(j) { "No saved correction" }, owner, context)
                }
            scheduleCompletedPush()
            result
        }

    private fun checkOwner(owner: CheckoutOwner, orderId: String) {
        check(currentOwner() == owner) { "Correction session has changed" }
        val parent = db.get("orders", orderId)
        check(
            parent?.string("store_id") == owner.storeId && parent.string("_status") != "deleted"
        ) {
            "Order is unavailable for this store"
        }
    }

    private fun scheduleCompletedPush() {
        try {
            triggerPush()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Financial completion is durable. Normal periodic/manual sync still owns delivery.
        }
    }

    private fun finish(
        initial: CheckoutJournal,
        owner: CheckoutOwner,
        context: kotlin.coroutines.CoroutineContext,
    ): CompletedCorrection {
        check(initial.owner == owner && initial.version == 3) {
            "Saved action belongs to another cashier"
        }
        validateJournal(db, initial, initial.orderId, initial.id)
        var j = initial
        if (j.done) {
            check(
                db.localValue(correctedKey(j.orderId)) == j.id &&
                    db.localValue(activeKey(j.orderId)).isNullOrEmpty()
            ) {
                "Saved correction no longer owns this order"
            }
            return j.correction!!.result!!
        }
        fun current() {
            context.ensureActive()
            checkOwner(owner, j.orderId)
            check(
                db.localValue(activeKey(j.orderId)) == j.id &&
                    validCorrectionPair(db, j) &&
                    db.localValue(correctedKey(j.orderId)).isNullOrEmpty()
            ) {
                "Saved correction no longer owns this order"
            }
            check(fingerprint(db, j.orderId) == j.fingerprint) {
                "Order changed; saved correction is retained for review"
            }
        }
        current()
        val payload = j.correction!!
        if (
            j.kind == "refund" &&
                j.baseline!!.items.any { it.string("id") !in payload.input.itemIds } &&
                payload.number == null
        ) {
            orders.reserveCorrectionNumber(j.baseline.parent.string("order_type").orEmpty()) {
                number ->
                current()
                j = j.copy(correction = j.correction!!.copy(number = number))
                saveJournal(db, j)
            }
        }
        current()
        // Task10-only approved atomic publication: append-only first push must see final amounts.
        return db.transaction {
            current()
            var stamped =
                j.copy(
                    correction =
                        j.correction!!.copy(voidAt = if (j.kind == "void") clock() else null)
                )
            val writes = correctionWrites(stamped)
            writes.forEach { planned ->
                val step =
                    if (planned.table == "audit_logs") {
                        if (j.kind == "void")
                            j.tableId?.let { tableId ->
                                val table = db.get("tables", tableId)
                                check(
                                    table?.string("store_id") == owner.storeId &&
                                        table.string("_status") != "deleted"
                                ) {
                                    "Correction table is unavailable for this store"
                                }
                                if (
                                    db.select(
                                            "orders",
                                            "table_id = ? AND status = 'open' AND _status != 'deleted'",
                                            listOf(tableId),
                                        )
                                        .isEmpty()
                                )
                                    db.updateLocal(
                                        "tables",
                                        tableId,
                                        fields("status" to "available", "current_order_id" to null),
                                    )
                            }
                        stamped =
                            stamped.copy(correction = stamped.correction!!.copy(auditAt = clock()))
                        correctionWrites(stamped).last()
                    } else planned
                when (step.operation) {
                    "insert" ->
                        db.insertLocal(
                            step.table,
                            JsonObject(step.values + fields("id" to step.id)),
                        )
                    "update" -> db.updateLocal(step.table, step.id, step.values)
                }
            }
            val result = correctionResult(stamped)
            context.ensureActive()
            checkOwner(owner, j.orderId)
            val done =
                stamped.copy(
                    done = true,
                    completedAt = stamped.correction!!.auditAt,
                    fingerprint = fingerprint(db, j.orderId),
                    correction = stamped.correction.copy(result = result),
                )
            validateJournal(db, done, done.orderId, done.id)
            saveJournal(db, done)
            db.setLocalValue(activeKey(j.orderId), "")
            db.setLocalValue(correctedKey(j.orderId), j.id)
            result
        }
    }
}
