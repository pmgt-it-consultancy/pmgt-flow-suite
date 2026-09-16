package com.pmgt.pos.checkout

import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
internal data class CorrectionPayload(
    val input: CorrectionInput,
    val orderNumber: String?,
    val refundAt: Long?,
    val number: String? = null,
    val voidAt: Long? = null,
    val auditAt: Long? = null,
    val result: CompletedCorrection? = null,
)

internal fun correctedKey(orderId: String) = "kotlin.checkout.corrected:$orderId"

/** A settled payment is historical evidence, never a second active owner. */
internal fun validCorrectionPair(db: PosDatabase, correction: CheckoutJournal): Boolean {
    if (correction.version != 3 || correction.kind !in setOf("void", "refund") || correction.done)
        return false
    val settledId =
        db.localValue(settledKey(correction.orderId))?.takeIf { it.isNotEmpty() } ?: return true
    val payment = loadJournal(db, correction.orderId, settledId) ?: return false
    validateJournal(db, payment, correction.orderId, settledId)
    return payment.version == 2 &&
        payment.done &&
        payment.kind == "payment" &&
        payment.owner.storeId == correction.owner.storeId
}

internal fun correctionResult(j: CheckoutJournal): CompletedCorrection {
    val p = requireNotNull(j.correction)
    val steps = correctionWrites(j)
    val void = steps.single { it.table == "order_voids" }
    return CompletedCorrection(
        j.orderId,
        void.id,
        void.values.string("replacement_order_id"),
        void.values.number("amount"),
    )
}

/**
 * Derives every final model value from immutable source inputs, never from a saved executable plan.
 */
internal fun correctionWrites(j: CheckoutJournal): List<CheckoutWrite> {
    val p = requireNotNull(j.correction)
    val b = requireNotNull(j.baseline)
    val original = b.parent
    val steps = mutableListOf<CheckoutWrite>()
    val ids = j.allocatedIds.iterator()
    fun id() = ids.next()
    fun insert(table: String, id: String, row: Row) {
        steps += CheckoutWrite(table, id, "insert", row)
    }
    fun copy(row: Row, names: List<String>) = row.filterKeys { it in names }
    val manager = j.managerId!!
    var replacementId: String? = null
    var amount = original.number("net_sales")
    var replacementNet = 0.0
    val selected = p.input.itemIds.toSet()
    val retained = b.items.filter { it.string("id") !in selected }
    if (j.kind == "refund" && retained.isNotEmpty()) {
        replacementId = id()
        val parent =
            fields(
                "status" to "paid",
                "order_number" to p.number,
                "created_by" to manager,
                "paid_by" to manager,
                "created_at" to p.refundAt,
                "paid_at" to p.refundAt,
                "refunded_from_order_id" to j.orderId,
            )
        val copiedParent =
            JsonObject(
                copy(
                    original,
                    listOf(
                        "store_id",
                        "order_type",
                        "order_channel",
                        "table_id",
                        "table_name",
                        "customer_name",
                        "order_category",
                        "table_marker",
                        "pax",
                        "takeout_status",
                    ),
                ) + parent
            )
        val replacementItems = mutableListOf<Row>()
        val replacementMods = mutableListOf<Row>()
        val replacementDiscounts = mutableListOf<Row>()
        val mappedItems = mutableMapOf<String, String>()
        for (item in retained) {
            val itemId = id()
            mappedItems[item.string("id")!!] = itemId
            val row =
                JsonObject(
                    copy(
                        item,
                        listOf(
                            "product_id",
                            "product_name",
                            "product_price",
                            "quantity",
                            "notes",
                            "service_type",
                            "is_sent_to_kitchen",
                        ),
                    ) + fields("order_id" to replacementId, "is_voided" to false)
                )
            replacementItems += normalizedInsert("order_items", itemId, row)
            for (mod in b.modifiers.filter { it.string("order_item_id") == item.string("id") }) {
                val modId = id()
                replacementMods +=
                    normalizedInsert(
                        "order_item_modifiers",
                        modId,
                        JsonObject(
                            copy(
                                mod,
                                listOf(
                                    "modifier_group_name",
                                    "modifier_option_name",
                                    "price_adjustment",
                                ),
                            ) + fields("order_item_id" to itemId)
                        ),
                    )
            }
        }
        for (d in b.discounts) {
            val old = d.string("order_item_id")?.takeIf { it.isNotEmpty() }
            if (old != null && old !in mappedItems) continue
            val discountId = id()
            replacementDiscounts +=
                normalizedInsert(
                    "order_discounts",
                    discountId,
                    JsonObject(
                        copy(
                            d,
                            listOf(
                                "discount_type",
                                "customer_name",
                                "customer_id",
                                "quantity_applied",
                                "discount_amount",
                                "vat_exempt_amount",
                                "approved_by",
                            ),
                        ) +
                            fields(
                                "order_id" to replacementId,
                                "order_item_id" to old?.let { mappedItems[it] },
                                "created_at" to p.refundAt,
                            )
                    ),
                )
        }
        val graph =
            b.graph()
                .copy(
                    parent = normalizedInsert("orders", replacementId, copiedParent),
                    items = replacementItems,
                    modifiers = replacementMods.groupBy { it.string("order_item_id") },
                    discounts = replacementDiscounts,
                )
        val recalculated = recalculationWrites(graph)
        val totals = recalculated.last().values
        insert("orders", replacementId, JsonObject(copiedParent + totals))
        replacementItems.forEach { insert("order_items", it.string("id")!!, JsonObject(it - "id")) }
        replacementMods.forEach {
            insert("order_item_modifiers", it.string("id")!!, JsonObject(it - "id"))
        }
        replacementDiscounts.forEach { row ->
            val update =
                recalculated
                    .find { it.table == "order_discounts" && it.id == row.string("id") }
                    ?.values
                    .orEmpty()
            insert("order_discounts", row.string("id")!!, JsonObject(row - "id" + update))
        }
        replacementNet = totals.number("net_sales")
        amount -= replacementNet
    }
    val voidId = id()
    insert(
        "order_voids",
        voidId,
        fields(
            "order_id" to j.orderId,
            "void_type" to
                if (j.kind == "refund" || original.string("status") == "paid") "refund"
                else "full_order",
            "reason" to p.input.reason,
            "approved_by" to manager,
            "requested_by" to manager,
            "amount" to amount,
            "created_at" to if (j.kind == "refund") p.refundAt else p.voidAt,
            "refund_method" to p.input.refundMethod,
            "replacement_order_id" to replacementId,
        ),
    )
    steps +=
        CheckoutWrite(
            "orders",
            j.orderId,
            "update",
            if (j.kind == "void" && original.string("order_type") == "takeout")
                fields("status" to "voided", "takeout_status" to "cancelled")
            else fields("status" to "voided"),
        )
    if (replacementId != null)
        insert(
            "order_payments",
            id(),
            fields(
                "order_id" to replacementId,
                "store_id" to j.owner.storeId,
                "payment_method" to "cash",
                "amount" to replacementNet,
                "created_by" to manager,
                "created_at" to p.refundAt,
            ),
        )
    val details = buildJsonObject {
        put("orderNumber", p.orderNumber?.let(::JsonPrimitive) ?: JsonNull)
        if (j.kind == "refund") {
            put(
                "refundedItems",
                JsonArray(
                    b.items
                        .filter { it.string("id") in selected }
                        .map { item ->
                            fields(
                                "name" to item.string("product_name"),
                                "quantity" to item.number("quantity"),
                                "price" to item.number("product_price"),
                            )
                        }
                ),
            )
            put("refundAmount", amount)
            put("refundMethod", p.input.refundMethod)
            if (replacementId != null) put("replacementOrderId", replacementId)
        } else put("originalAmount", original.number("net_sales"))
        put("reason", p.input.reason)
    }
    insert(
        "audit_logs",
        id(),
        fields(
            "store_id" to j.owner.storeId,
            "action" to
                if (j.kind == "refund") "refund_order"
                else if (original.string("status") == "paid") "void_paid_order" else "void_order",
            "entity_type" to "order",
            "entity_id" to j.orderId,
            "details" to details.toString(),
            "user_id" to manager,
            "created_at" to p.auditAt,
        ),
    )
    check(!ids.hasNext()) { "Correction identities do not match the selected rows" }
    return steps
}

internal fun validateCorrectionJournal(
    db: PosDatabase,
    j: CheckoutJournal,
    orderId: String,
    id: String,
) {
    fun valid(ok: Boolean) {
        check(ok) { "Saved correction data is unreadable; existing work is retained" }
    }
    val b = requireNotNull(j.baseline)
    val p = requireNotNull(j.correction)
    valid(j.id == id && j.orderId == orderId && j.version == 3 && j.kind in setOf("void", "refund"))
    valid(
        j.steps.isEmpty() &&
            j.next == 0 &&
            j.completion == null &&
            j.input == null &&
            j.executedAt.isEmpty()
    )
    valid(
        j.owner.userId.isNotEmpty() && j.owner.storeId.isNotEmpty() && !j.managerId.isNullOrEmpty()
    )
    valid(
        b.parent.string("id") == orderId &&
            b.parent.string("store_id") == j.owner.storeId &&
            b.parent.string("status") in setOf("open", "paid")
    )
    valid(db.get("orders", orderId)?.string("store_id") == j.owner.storeId)
    valid(j.kind == p.input.kind && p.input.reason.trim().isNotEmpty())
    valid(j.tableId == b.parent.string("table_id")?.takeIf { it.isNotEmpty() })
    for ((table, rows) in
        listOf(
            "orders" to listOf(b.parent),
            "order_items" to b.items,
            "order_item_modifiers" to b.modifiers,
            "order_discounts" to b.discounts,
            "order_payments" to b.payments,
        )) {
        valid(rows.map { it.string("id") }.distinct().size == rows.size)
        rows.forEach { row ->
            valid(!row.string("id").isNullOrEmpty())
            valid(row == normalizedInsert(table, row.string("id")!!, row))
            LegacyTables.tables
                .getValue(table)
                .filter { it.name in row }
                .forEach { c ->
                    val v = row[c.name]!!
                    valid(
                        if (v == JsonNull) c.optional
                        else
                            v is JsonPrimitive &&
                                when (c.type) {
                                    "number" -> !v.isString && v.doubleOrNull?.isFinite() == true
                                    "boolean" -> !v.isString && v.booleanOrNull != null
                                    else -> v.isString
                                }
                    )
                }
        }
    }
    valid(b.items.all { it.string("order_id") == orderId && !it.boolean("is_voided") })
    valid(b.modifiers.all { mod -> b.items.any { it.string("id") == mod.string("order_item_id") } })
    valid(b.discounts.all { it.string("order_id") == orderId })
    valid(
        b.payments.all {
            it.string("order_id") == orderId && it.string("store_id") == j.owner.storeId
        }
    )
    valid(
        b.vatRate.isFinite() &&
            b.products.map { it.string("id") }.distinct().size == b.products.size
    )
    valid(
        b.products.all { product ->
            product.keys == setOf("id", "is_vatable") &&
                product["is_vatable"]?.jsonPrimitive?.booleanOrNull != null &&
                b.items.any { it.string("product_id") == product.string("id") }
        }
    )
    if (!j.done) {
        valid(db.get("stores", j.owner.storeId)?.let { it.string("_status") != "deleted" } == true)
        b.products.forEach { product ->
            db.get("products", product.string("id")!!)?.let {
                valid(it.string("store_id") == j.owner.storeId)
            }
        }
        j.tableId?.let { tableId ->
            valid(db.get("tables", tableId)?.string("store_id") == j.owner.storeId)
        }
    }
    if (j.kind == "refund") {
        valid(
            b.parent.string("status") == "paid" &&
                p.refundAt != null &&
                p.input.itemIds.isNotEmpty() &&
                p.input.refundMethod in setOf("cash", "card_ewallet")
        )
        valid(p.input.itemIds.all { selected -> b.items.any { it.string("id") == selected } })
        valid(p.voidAt == null)
    } else
        valid(
            p.input.itemIds.isEmpty() &&
                p.input.refundMethod == null &&
                p.refundAt == null &&
                p.number == null
        )
    valid(
        j.allocatedIds.all { it.isNotEmpty() } &&
            j.allocatedIds.distinct().size == j.allocatedIds.size
    )
    val steps = correctionWrites(j)
    valid(
        j.done == (p.result != null) &&
            j.done == (p.auditAt != null) &&
            j.done == (j.completedAt != null)
    )
    valid(j.kind != "void" || j.done == (p.voidAt != null))
    valid(!j.done || p.result == correctionResult(j))
    valid(
        !j.done ||
            steps.none {
                it.table == "orders" &&
                    it.operation == "insert" &&
                    it.values.string("order_number").isNullOrEmpty()
            }
    )
    val parentUpdate = steps.single { it.table == "orders" && it.operation == "update" }.values
    valid(
        j.fingerprint ==
            baselineFingerprint(
                if (j.done) b.copy(parent = JsonObject(b.parent + parentUpdate)) else b
            )
    )
    if (!j.done)
        steps.filter { it.operation == "insert" }.forEach { valid(db.get(it.table, it.id) == null) }
}
