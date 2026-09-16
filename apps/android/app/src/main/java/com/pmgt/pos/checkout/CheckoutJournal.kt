package com.pmgt.pos.checkout

import com.pmgt.pos.db.*
import com.pmgt.pos.money.Money
import com.pmgt.pos.orders.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
internal data class CheckoutWrite(
    val table: String,
    val id: String,
    val operation: String,
    val values: Row,
)

@Serializable
internal data class CheckoutJournal(
    val id: String,
    val owner: CheckoutOwner,
    val orderId: String,
    val kind: String,
    val fingerprint: String,
    val steps: List<CheckoutWrite>,
    val next: Int = 0,
    val done: Boolean = false,
    val tableId: String? = null,
    val completion: CompletedCheckout? = null,
    val input: String? = null,
    val managerId: String? = null,
    val baseline: CheckoutBaseline? = null,
    val allocatedIds: List<String> = emptyList(),
    val executedAt: Map<Int, Long> = emptyMap(),
    val completedAt: Long? = null,
    val version: Int = 2,
    val correction: CorrectionPayload? = null,
)

private val journalJson = Json { encodeDefaults = true }

internal fun activeKey(orderId: String) = "kotlin.checkout.active:$orderId"

internal fun settledKey(orderId: String) = "kotlin.checkout.settled:$orderId"

private fun journalKey(orderId: String, id: String) =
    "kotlin.checkout.journal:" + JsonArray(listOf(JsonPrimitive(orderId), JsonPrimitive(id)))

internal fun loadJournal(db: PosDatabase, orderId: String, id: String): CheckoutJournal? =
    db.localValue(journalKey(orderId, id))?.let {
        try {
            check(
                Json.parseToJsonElement(it).jsonObject["version"]?.jsonPrimitive?.intOrNull in
                    setOf(2, 3)
            )
            journalJson.decodeFromString<CheckoutJournal>(it).also { journal ->
                check(journal.orderId == orderId && journal.id == id)
            }
        } catch (_: Exception) {
            error("Saved checkout recovery data is unreadable; existing work is retained")
        }
    }

internal fun activeJournal(db: PosDatabase, orderId: String) =
    db.localValue(activeKey(orderId))
        ?.takeIf { it.isNotEmpty() }
        ?.let {
            requireNotNull(loadJournal(db, orderId, it)) {
                    "Saved checkout recovery data is unavailable"
                }
                .also { journal ->
                    check(
                        !journal.done &&
                            (db.localValue(settledKey(orderId)).isNullOrEmpty() ||
                                validCorrectionPair(db, journal))
                    ) {
                        "Saved checkout pointer is inconsistent; existing work is retained"
                    }
                }
        }

internal fun settledJournal(db: PosDatabase, orderId: String) =
    db.localValue(settledKey(orderId))
        ?.takeIf { it.isNotEmpty() }
        ?.let {
            requireNotNull(loadJournal(db, orderId, it)) {
                    "Saved payment recovery data is unavailable"
                }
                .also { journal ->
                    check(
                        journal.done &&
                            journal.kind == "payment" &&
                            (db.localValue(activeKey(orderId)).isNullOrEmpty() ||
                                loadJournal(db, orderId, db.localValue(activeKey(orderId))!!)?.let {
                                    validCorrectionPair(db, it)
                                } == true)
                    ) {
                        "Saved payment pointer is inconsistent; existing work is retained"
                    }
                }
        }

internal fun saveJournal(db: PosDatabase, journal: CheckoutJournal) =
    db.setLocalValue(journalKey(journal.orderId, journal.id), journalJson.encodeToString(journal))

internal fun saveNew(db: PosDatabase, journal: CheckoutJournal) =
    db.transaction {
        db.requireOrderWritable(journal.orderId)
        saveJournal(db, journal)
        db.setLocalValue(activeKey(journal.orderId), journal.id)
    }

internal fun validateJournal(
    db: PosDatabase,
    journal: CheckoutJournal,
    orderId: String,
    id: String,
) {
    if (journal.version == 3) {
        validateCorrectionJournal(db, journal, orderId, id)
        return
    }
    check(journal.correction == null) { "Unexpected correction payload in checkout data" }
    fun valid(condition: Boolean) {
        check(condition) {
            "Saved checkout recovery data does not match this order; existing work is retained"
        }
    }
    valid(
        journal.version == 2 &&
            journal.id == id &&
            journal.orderId == orderId &&
            journal.kind in setOf("payment", "discount", "remove") &&
            journal.next in 0..journal.steps.size
    )
    valid(!journal.done || journal.next == journal.steps.size)
    valid(
        journal.owner.userId.isNotEmpty() &&
            journal.owner.storeId.isNotEmpty() &&
            journal.steps.isNotEmpty()
    )
    val parent = db.get("orders", orderId)
    valid(parent?.string("store_id") == journal.owner.storeId)
    valid(journal.tableId == null || journal.tableId == parent?.string("table_id"))
    validatePlan(journal)
    journal.steps.forEachIndexed { index, step ->
        if (step.operation == "insert" && index >= journal.next)
            valid(db.get(step.table, step.id) == null)
    }
}

/** Financial projection excludes only explicit sync hydration and parent numbering metadata. */
internal fun fingerprint(db: PosDatabase, orderId: String): String =
    baselineFingerprint(captureBaseline(db, readOrderGraph(db, orderId)))

/** Same persisted branch and per-row order as LocalOrderRepository.recalculate. */
internal fun recalculationWrites(graph: OrderGraph): List<CheckoutWrite> {
    val totals =
        Money.persisted(
            graph.items.map(graph::calculation),
            graph.discounts
                .filter { it.string("order_item_id").isNullOrEmpty() }
                .fold(0.0) { sum, d -> sum + d.number("discount_amount") },
        )
    val updates = mutableListOf<CheckoutWrite>()
    for (item in graph.items) for (discount in
        graph.discounts.filter { it.string("order_item_id") == item.string("id") }) {
        if (discount.string("discount_type") !in setOf("senior_citizen", "pwd")) continue
        val quantity = discount.number("quantity_applied")
        val amount =
            Money.itemTotals(
                graph.unitPrice(item),
                quantity,
                graph.products[item.string("product_id")]?.boolean("is_vatable") ?: false,
                quantity,
                graph.vatRate,
            )
        updates +=
            CheckoutWrite(
                "order_discounts",
                discount.string("id")!!,
                "update",
                fields(
                    "discount_amount" to amount.discountAmount,
                    "vat_exempt_amount" to amount.vatExemptAmount,
                ),
            )
    }
    val active = graph.items.map { it.string("id") }.toSet()
    for (discount in graph.discounts) if (
        !discount.string("order_item_id").isNullOrEmpty() &&
            discount.string("order_item_id") !in active
    )
        updates +=
            CheckoutWrite(
                "order_discounts",
                discount.string("id")!!,
                "update",
                fields("discount_amount" to 0.0, "vat_exempt_amount" to 0.0),
            )
    updates +=
        CheckoutWrite(
            "orders",
            graph.parent.string("id")!!,
            "update",
            fields(
                "gross_sales" to totals.grossSales,
                "vatable_sales" to totals.vatableSales,
                "vat_amount" to totals.vatAmount,
                "vat_exempt_sales" to totals.vatExemptSales,
                "non_vat_sales" to totals.nonVatSales,
                "discount_amount" to totals.discountAmount,
                "net_sales" to totals.netSales,
            ),
        )
    return updates
}
