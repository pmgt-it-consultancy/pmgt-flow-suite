package com.pmgt.pos.checkout

import com.pmgt.pos.db.*
import com.pmgt.pos.money.Money
import com.pmgt.pos.orders.*
import java.security.MessageDigest
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
    val version: Int = 1,
)

private val journalJson = Json { encodeDefaults = true }

internal fun activeKey(orderId: String) = "kotlin.checkout.active:$orderId"

internal fun settledKey(orderId: String) = "kotlin.checkout.settled:$orderId"

private fun journalKey(orderId: String, id: String) =
    "kotlin.checkout.journal:" + JsonArray(listOf(JsonPrimitive(orderId), JsonPrimitive(id)))

internal fun loadJournal(db: PosDatabase, orderId: String, id: String): CheckoutJournal? =
    db.localValue(journalKey(orderId, id))?.let {
        try {
            check(Json.parseToJsonElement(it).jsonObject["version"]?.jsonPrimitive?.intOrNull == 1)
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
        }

internal fun settledJournal(db: PosDatabase, orderId: String) =
    db.localValue(settledKey(orderId))
        ?.takeIf { it.isNotEmpty() }
        ?.let {
            requireNotNull(loadJournal(db, orderId, it)) {
                "Saved payment recovery data is unavailable"
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
    fun valid(condition: Boolean) {
        check(condition) {
            "Saved checkout recovery data does not match this order; existing work is retained"
        }
    }
    valid(
        journal.version == 1 &&
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
    val inserts = journal.steps.filter { it.operation == "insert" }
    valid(inserts.map { it.table to it.id }.distinct().size == inserts.size)
    val totalFields =
        setOf(
            "gross_sales",
            "vatable_sales",
            "vat_amount",
            "vat_exempt_sales",
            "non_vat_sales",
            "discount_amount",
            "net_sales",
        )
    val paidFields =
        setOf(
            "status",
            "payment_method",
            "cash_received",
            "change_given",
            "card_payment_type",
            "card_reference_number",
            "paid_at",
            "paid_by",
        )
    journal.steps.forEachIndexed { index, step ->
        valid(step.id.isNotEmpty() && step.operation in setOf("insert", "update", "delete"))
        when (step.table) {
            "orders" ->
                valid(
                    step.id == orderId &&
                        step.operation == "update" &&
                        (step.values.keys == totalFields ||
                            journal.kind == "payment" &&
                                step.values.keys == paidFields &&
                                step.values.string("status") == "paid")
                )
            "order_payments" -> {
                valid(
                    journal.kind == "payment" &&
                        step.operation == "insert" &&
                        step.values.string("order_id") == orderId &&
                        step.values.string("store_id") == journal.owner.storeId
                )
                if (index < journal.next)
                    valid(db.get(step.table, step.id)?.string("order_id") == orderId)
            }
            "order_discounts" -> {
                when (step.operation) {
                    "insert" ->
                        valid(
                            journal.kind == "discount" &&
                                step.values.string("order_id") == orderId &&
                                step.values.string("approved_by") == journal.managerId &&
                                db.get("order_items", step.values.string("order_item_id").orEmpty())
                                    ?.string("order_id") == orderId
                        )
                    "update" ->
                        valid(
                            step.values.keys == setOf("discount_amount", "vat_exempt_amount") &&
                                (db.get(step.table, step.id)?.string("order_id") == orderId ||
                                    inserts.any { it.table == step.table && it.id == step.id })
                        )
                    "delete" ->
                        valid(
                            journal.kind == "remove" &&
                                step.id == journal.input &&
                                step.values.isEmpty() &&
                                (db.get(step.table, step.id)?.string("order_id") == orderId ||
                                    index < journal.next)
                        )
                }
            }
            else -> valid(false)
        }
    }
    if (journal.kind == "payment") {
        val completion = journal.completion
        valid(
            completion != null &&
                completion.route.orderId == orderId &&
                completion.view.cart.id == orderId &&
                completion.view.cart.storeId == journal.owner.storeId
        )
        val rows = journal.steps.filter { it.table == "order_payments" }
        valid(PaymentMath.validIdentities(completion!!.lines))
        valid(rows.size == completion.payments.size && rows.isNotEmpty())
        valid(
            completion.payments ==
                PaymentMath.build(completion.lines, completion.view.cart.checkoutTotals().netSales)
        )
        rows.zip(completion.payments).forEach { (step, p) ->
            valid(
                step.values.string("payment_method") == p.paymentMethod &&
                    step.values.number("amount") == p.amount &&
                    step.values.number("cash_received") == (p.cashReceived ?: 0.0) &&
                    step.values.number("change_given") == (p.changeGiven ?: 0.0) &&
                    step.values.string("card_payment_type") == p.cardPaymentType &&
                    step.values.string("card_reference_number") == p.cardReferenceNumber
            )
        }
    } else
        valid(
            journal.completion == null &&
                journal.tableId == null &&
                !journal.managerId.isNullOrEmpty()
        )
}

/** Hash actual selected domain values, never sync identity/ack markers or tombstone revisions. */
internal fun fingerprint(db: PosDatabase, orderId: String): String {
    val graph = readOrderGraph(db, orderId)
    fun clean(row: Row) =
        JsonObject(
            row.filterKeys {
                it !in
                    setOf("_status", "_changed", "server_id", "updated_at", "created_by", "paid_by")
            }
        )
    val snapshot =
        buildJsonObject {
                put("order", clean(graph.parent))
                put("orderDeleted", graph.parent.string("_status") == "deleted")
                put("items", JsonArray(graph.items.map(::clean)))
                put(
                    "modifiers",
                    JsonArray(
                        graph.items
                            .flatMap { graph.modifiers[it.string("id")].orEmpty() }
                            .map(::clean)
                    ),
                )
                put(
                    "vat",
                    JsonArray(
                        graph.items.map { item ->
                            buildJsonObject {
                                put("id", item["product_id"]!!)
                                put(
                                    "vat",
                                    graph.products[item.string("product_id")]?.get("is_vatable")
                                        ?: JsonNull,
                                )
                            }
                        }
                    ),
                )
                put("discounts", JsonArray(graph.discounts.map(::clean)))
                put(
                    "payments",
                    JsonArray(
                        db.select(
                                "order_payments",
                                "order_id = ? AND _status != 'deleted'",
                                listOf(orderId),
                            )
                            .map(::clean)
                    ),
                )
                put("rate", graph.vatRate)
            }
            .toString()
    return MessageDigest.getInstance("SHA-256").digest(snapshot.toByteArray()).joinToString("") {
        "%02x".format(it)
    }
}

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
