package com.pmgt.pos.checkout

import com.pmgt.pos.db.*
import com.pmgt.pos.money.Money
import com.pmgt.pos.orders.*
import java.security.MessageDigest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

/** Original selected inputs, not executable effects. Never includes auth/session credentials. */
@Serializable
internal data class CheckoutBaseline(
    val parent: Row,
    val items: List<Row>,
    val modifiers: List<Row>,
    val products: List<Row>,
    val discounts: List<Row>,
    val payments: List<Row>,
    val vatRate: Double,
) {
    fun graph() =
        OrderGraph(
            parent,
            items,
            modifiers.groupBy { it.string("order_item_id") },
            products.associateBy { it.string("id") },
            discounts,
            vatRate,
        )
}

private val hydrationFields =
    setOf("_status", "_changed", "server_id", "updated_at", "created_by", "paid_by")

private fun financialRow(table: String, row: Row): Row =
    JsonObject(
        row.filterKeys { it !in hydrationFields && !(table == "orders" && it == "order_number") }
            .toSortedMap()
            .mapValues { (_, value) ->
                if (value is JsonPrimitive && !value.isString && value.doubleOrNull != null)
                    JsonPrimitive(value.double)
                else value
            }
    )

internal fun captureBaseline(db: PosDatabase, graph: OrderGraph): CheckoutBaseline =
    CheckoutBaseline(
        financialRow("orders", graph.parent),
        graph.items.map { financialRow("order_items", it) },
        graph.items
            .flatMap { graph.modifiers[it.string("id")].orEmpty() }
            .map { financialRow("order_item_modifiers", it) },
        graph.products.values.map {
            fields("id" to it.string("id"), "is_vatable" to it.boolean("is_vatable"))
        },
        graph.discounts.map { financialRow("order_discounts", it) },
        db.select(
                "order_payments",
                "order_id = ? AND _status != 'deleted'",
                listOf(graph.parent.string("id")),
            )
            .map { financialRow("order_payments", it) },
        graph.vatRate,
    )

internal fun baselineFingerprint(b: CheckoutBaseline): String {
    fun rows(table: String, rows: List<Row>) =
        JsonArray(rows.sortedBy { it.string("id") }.map { financialRow(table, it) })
    val snapshot =
        buildJsonObject {
                put("order", financialRow("orders", b.parent))
                put("items", rows("order_items", b.items))
                put("modifiers", rows("order_item_modifiers", b.modifiers))
                put("products", rows("products", b.products))
                put("discounts", rows("order_discounts", b.discounts))
                put("payments", rows("order_payments", b.payments))
                put("vatRate", b.vatRate)
            }
            .toString()
    return MessageDigest.getInstance("SHA-256").digest(snapshot.toByteArray()).joinToString("") {
        "%02x".format(it)
    }
}

private fun normalizedInsert(table: String, id: String, values: Row): Row =
    financialRow(
        table,
        JsonObject(
            buildMap {
                put("id", JsonPrimitive(id))
                for (column in LegacyTables.tables.getValue(table)) put(
                    column.name,
                    if (column.optional) JsonNull
                    else
                        when (column.type) {
                            "number" -> JsonPrimitive(0.0)
                            "boolean" -> JsonPrimitive(false)
                            else -> JsonPrimitive("")
                        },
                )
                putAll(values)
            }
        ),
    )

internal fun projectedBaseline(journal: CheckoutJournal): CheckoutBaseline {
    var result = requireNotNull(journal.baseline)
    for (step in journal.steps.take(journal.next)) {
        fun apply(rows: List<Row>): List<Row> =
            when (step.operation) {
                "insert" -> rows + normalizedInsert(step.table, step.id, step.values)
                "delete" -> rows.filter { it.string("id") != step.id }
                else ->
                    rows.map {
                        if (it.string("id") == step.id) JsonObject(it + step.values) else it
                    }
            }
        result =
            when (step.table) {
                "orders" -> result.copy(parent = JsonObject(result.parent + step.values))
                "order_discounts" -> result.copy(discounts = apply(result.discounts))
                "order_payments" -> result.copy(payments = apply(result.payments))
                else -> error("Invalid checkout table")
            }
    }
    return result
}

/** Rebuild the whole ordered source plan from captured inputs and allocated identities. */
internal fun canonicalSteps(j: CheckoutJournal): List<CheckoutWrite> {
    val graph = requireNotNull(j.baseline).graph()
    val steps = mutableListOf<CheckoutWrite>()
    when (j.kind) {
        "payment" -> {
            val completed = requireNotNull(j.completion)
            val payments =
                PaymentMath.build(completed.lines, completed.view.cart.checkoutTotals().netSales)
            steps += recalculationWrites(graph)
            payments.zip(j.allocatedIds).forEach { (p, id) ->
                steps +=
                    CheckoutWrite(
                        "order_payments",
                        id,
                        "insert",
                        fields(
                            "order_id" to j.orderId,
                            "store_id" to j.owner.storeId,
                            "payment_method" to p.paymentMethod,
                            "amount" to p.amount,
                            "cash_received" to p.cashReceived?.takeUnless { it == 0.0 },
                            "change_given" to p.changeGiven?.takeUnless { it == 0.0 },
                            "card_payment_type" to p.cardPaymentType?.takeIf { it.isNotEmpty() },
                            "card_reference_number" to
                                p.cardReferenceNumber?.takeIf { it.isNotEmpty() },
                            "created_at" to j.executedAt[steps.size],
                            "created_by" to "",
                        ),
                    )
            }
            val first = payments.first()
            steps +=
                CheckoutWrite(
                    "orders",
                    j.orderId,
                    "update",
                    fields(
                        "status" to "paid",
                        "payment_method" to first.paymentMethod,
                        "cash_received" to first.cashReceived?.takeUnless { it == 0.0 },
                        "change_given" to first.changeGiven?.takeUnless { it == 0.0 },
                        "card_payment_type" to first.cardPaymentType,
                        "card_reference_number" to first.cardReferenceNumber,
                        "paid_at" to j.executedAt[steps.size],
                        "paid_by" to "",
                    ),
                )
        }
        "discount" -> {
            val input = Json.decodeFromString<DiscountInput>(requireNotNull(j.input))
            val rows =
                input.itemIds.zip(j.allocatedIds).mapIndexed { index, (itemId, id) ->
                    val item = graph.items.single { it.string("id") == itemId }
                    val product = requireNotNull(graph.products[item.string("product_id")])
                    val amount =
                        Money.scPwdDiscount(
                            graph.unitPrice(item),
                            if (product.boolean("is_vatable")) graph.vatRate else 0.0,
                        )
                    fields(
                        "id" to id,
                        "order_id" to j.orderId,
                        "order_item_id" to itemId,
                        "discount_type" to input.type,
                        "customer_name" to input.customerName.trim(),
                        "customer_id" to input.customerId.trim(),
                        "quantity_applied" to 1.0,
                        "discount_amount" to amount.discountAmount,
                        "vat_exempt_amount" to amount.vatExemptAmount,
                        "approved_by" to j.managerId,
                        "created_at" to j.executedAt[index],
                    )
                }
            steps +=
                rows.map {
                    CheckoutWrite(
                        "order_discounts",
                        it.string("id")!!,
                        "insert",
                        JsonObject(it - "id"),
                    )
                }
            steps += recalculationWrites(graph.copy(discounts = graph.discounts + rows))
        }
        "remove" -> {
            steps += CheckoutWrite("order_discounts", requireNotNull(j.input), "delete", fields())
            steps +=
                recalculationWrites(
                    graph.copy(discounts = graph.discounts.filter { it.string("id") != j.input })
                )
        }
        else -> error("Unsupported checkout action")
    }
    return steps
}

internal fun validatePlan(j: CheckoutJournal) {
    val b = requireNotNull(j.baseline)
    fun valid(condition: Boolean) {
        check(condition) { "Saved checkout plan is unreadable; existing work is retained" }
    }
    fun rows(table: String, values: List<Row>) {
        val columns =
            LegacyTables.tables.getValue(table).filter {
                it.name !in hydrationFields && !(table == "orders" && it.name == "order_number")
            }
        valid(values.map { it.string("id") }.distinct().size == values.size)
        values.forEach { row ->
            valid(
                !row.string("id").isNullOrEmpty() &&
                    row.keys == columns.map { it.name }.toSet() + "id"
            )
            columns.forEach { c ->
                val v = row[c.name]
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
    rows("orders", listOf(b.parent))
    rows("order_items", b.items)
    rows("order_item_modifiers", b.modifiers)
    rows("order_discounts", b.discounts)
    rows("order_payments", b.payments)
    valid(
        b.parent.string("id") == j.orderId &&
            b.parent.string("store_id") == j.owner.storeId &&
            b.parent.string("status") == "open" &&
            b.vatRate.isFinite()
    )
    valid(b.items.all { it.string("order_id") == j.orderId && !it.boolean("is_voided") })
    valid(
        b.modifiers.all { modifier ->
            b.items.any { it.string("id") == modifier.string("order_item_id") }
        }
    )
    valid(b.discounts.all { it.string("order_id") == j.orderId })
    valid(
        b.payments.all {
            it.string("order_id") == j.orderId && it.string("store_id") == j.owner.storeId
        }
    )
    valid(b.products.map { it.string("id") }.distinct().size == b.products.size)
    valid(
        b.products.all { product ->
            product.keys == setOf("id", "is_vatable") &&
                product["is_vatable"]?.jsonPrimitive?.booleanOrNull != null &&
                b.items.any { it.string("product_id") == product.string("id") }
        }
    )
    valid(
        j.allocatedIds.all { it.isNotEmpty() } &&
            j.allocatedIds.distinct().size == j.allocatedIds.size
    )
    when (j.kind) {
        "payment" -> {
            val c = requireNotNull(j.completion)
            valid(b.payments.isEmpty() && j.input == null && j.managerId == null)
            valid(
                c.route.orderId == j.orderId &&
                    c.view.cart.id == j.orderId &&
                    c.view.cart.storeId == j.owner.storeId
            )
            valid(
                PaymentMath.validIdentities(c.lines) &&
                    PaymentMath.validation(c.lines, c.view.cart.checkoutTotals().netSales) == null
            )
            valid(
                c.payments == PaymentMath.build(c.lines, c.view.cart.checkoutTotals().netSales) &&
                    c.payments.size == j.allocatedIds.size
            )
            valid(
                c.displayChange ==
                    PaymentMath.coverage(c.lines, c.view.cart.checkoutTotals().netSales).totalChange
            )
            valid(c.transactionAt == (j.completedAt ?: 0L))
            // Snapshot calculation inputs must match the original graph, not a second mutable
            // total.
            valid(c.view.cart.lines.map { it.id } == b.items.map { it.string("id") })
            c.view.cart.lines.zip(b.items).forEach { (line, item) ->
                valid(
                    line.productId == item.string("product_id") &&
                        line.productPrice == item.number("product_price") &&
                        line.quantity == item.number("quantity")
                )
                valid(
                    line.isVatable ==
                        (b.graph().products[item.string("product_id")]?.boolean("is_vatable")
                            ?: true)
                )
                valid(
                    line.modifiers.map { it.priceAdjustment } ==
                        b.graph().modifiers[item.string("id")].orEmpty().map {
                            it.number("price_adjustment")
                        }
                )
            }
            valid(c.view.cart.vatRate == b.vatRate)
            valid(
                c.view.cart.discounts ==
                    b.discounts.map {
                        CartDiscount(
                            it.string("id")!!,
                            it.string("order_item_id"),
                            it.string("discount_type").orEmpty(),
                            it.number("quantity_applied"),
                            it.number("discount_amount"),
                            it.number("vat_exempt_amount"),
                        )
                    }
            )
            valid(j.tableId == b.parent.string("table_id")?.takeIf { it.isNotEmpty() })
        }
        "discount",
        "remove" -> {
            valid(j.completion == null && j.tableId == null && !j.managerId.isNullOrEmpty())
            if (j.kind == "discount") {
                val input = Json.decodeFromString<DiscountInput>(requireNotNull(j.input))
                valid(
                    input.type in listOf("senior_citizen", "pwd") &&
                        input.itemIds.isNotEmpty() &&
                        input.itemIds.distinct().size == input.itemIds.size
                )
                valid(
                    input.customerName.trim().isNotEmpty() &&
                        input.customerId.trim().isNotEmpty() &&
                        input.itemIds.size == j.allocatedIds.size
                )
                valid(
                    input.itemIds.all { id ->
                        b.items.any { it.string("id") == id } &&
                            b.discounts
                                .filter { it.string("order_item_id") == id }
                                .fold(0.0) { sum, d -> sum + d.number("quantity_applied") } == 0.0
                    }
                )
                valid(j.allocatedIds.none { id -> b.discounts.any { it.string("id") == id } })
            } else valid(j.allocatedIds.isEmpty() && b.discounts.any { it.string("id") == j.input })
        }
        else -> valid(false)
    }
    val expected = canonicalSteps(j)
    valid(j.steps == expected)
    valid(
        j.executedAt.keys ==
            expected.indices
                .filter {
                    it < j.next &&
                        ("created_at" in expected[it].values || "paid_at" in expected[it].values)
                }
                .toSet()
    )
    valid(j.done == (j.completedAt != null))
    valid(j.fingerprint == baselineFingerprint(projectedBaseline(j)))
}
