package com.pmgt.pos.orders

import com.pmgt.pos.browse.ItemModifier
import com.pmgt.pos.browse.OrderLine
import com.pmgt.pos.db.*
import com.pmgt.pos.money.Money
import com.pmgt.pos.money.OrderTotals

internal data class OrderGraph(
    val parent: Row,
    val items: List<Row>,
    val modifiers: Map<String?, List<Row>>,
    val products: Map<String?, Row>,
    val discounts: List<Row>,
    val vatRate: Double,
) {
    fun unitPrice(item: Row) =
        item.number("product_price") +
            modifiers[item.string("id")].orEmpty().fold(0.0) { sum, modifier ->
                sum + modifier.number("price_adjustment")
            }

    fun calculation(item: Row) =
        Money.itemTotals(
            unitPrice(item),
            item.number("quantity"),
            products[item.string("product_id")]?.boolean("is_vatable") ?: false,
            discounts
                .filter { it.string("order_item_id") == item.string("id") }
                .fold(0.0) { sum, discount -> sum + discount.number("quantity_applied") },
            vatRate,
        )
}

internal fun selectedRows(
    db: PosDatabase,
    table: String,
    field: String,
    ids: List<String>,
): List<Row> =
    ids.distinct().chunked(400).flatMap { chunk ->
        db.select(
            table,
            "$field IN (${chunk.joinToString { "?" }}) AND _status != 'deleted'",
            chunk,
        )
    }

internal fun readOrderGraph(db: PosDatabase, orderId: String): OrderGraph {
    val order =
        requireNotNull(
            db.get("orders", orderId)?.takeUnless { it.string("_status") == "deleted" }
        ) {
            "Order is unavailable"
        }
    val items =
        db.select(
            "order_items",
            "order_id = ? AND is_voided = 0 AND _status != 'deleted'",
            listOf(orderId),
        )
    val modifiers =
        selectedRows(db, "order_item_modifiers", "order_item_id", items.map { it.string("id")!! })
            .groupBy { it.string("order_item_id") }
    val products =
        selectedRows(db, "products", "id", items.map { it.string("product_id")!! }).associateBy {
            it.string("id")
        }
    val discounts =
        db.select("order_discounts", "order_id = ? AND _status != 'deleted'", listOf(orderId))
    val store =
        requireNotNull(db.get("stores", order.string("store_id")!!)) { "Store is unavailable" }
    return OrderGraph(
        order,
        items,
        modifiers,
        products,
        discounts,
        store.string("vat_rate")?.toDoubleOrNull() ?: 0.12,
    )
}

internal fun OrderGraph.cart(db: PosDatabase): OrderCart {
    val p = parent
    return OrderCart(
        p.string("id")!!,
        p.string("store_id")!!,
        p.string("order_type").orEmpty(),
        p.string("status").orEmpty(),
        p.string("order_number").orEmpty(),
        p.string("table_id"),
        p.string("table_id")?.let { db.get("tables", it)?.string("name") }
            ?: p.string("table_name"),
        p.string("customer_name"),
        p.string("order_category"),
        p.string("table_marker"),
        p.string("pax")?.toDoubleOrNull(),
        p.string("tab_number")?.toDoubleOrNull(),
        p.string("tab_name"),
        items.map { item ->
            OrderLine(
                item.string("id")!!,
                item.string("product_id")!!,
                item.string("product_name").orEmpty(),
                item.number("product_price"),
                item.number("quantity"),
                item.string("notes"),
                false,
                item.boolean("is_sent_to_kitchen"),
                item.string("service_type"),
                products[item.string("product_id")]?.boolean("is_vatable") ?: true,
                modifiers[item.string("id")].orEmpty().map {
                    ItemModifier(
                        it.string("modifier_group_name").orEmpty(),
                        it.string("modifier_option_name").orEmpty(),
                        it.number("price_adjustment"),
                    )
                },
            )
        },
        discounts.map {
            CartDiscount(
                it.string("id")!!,
                it.string("order_item_id"),
                it.string("discount_type").orEmpty(),
                it.number("quantity_applied"),
                it.number("discount_amount"),
                it.number("vat_exempt_amount"),
            )
        },
        OrderTotals(
            p.number("gross_sales"),
            p.number("vatable_sales"),
            p.number("vat_amount"),
            p.number("vat_exempt_sales"),
            p.number("non_vat_sales"),
            p.number("discount_amount"),
            p.number("net_sales"),
        ),
        vatRate,
        p.string("takeout_status") ?: "pending",
    )
}

/** Checkout uses hydrated current-product VAT (missing => true), unlike persisted recalc. */
fun OrderCart.checkoutTotals(): OrderTotals =
    Money.checkout(
        lines.map { item ->
            Money.itemTotals(
                item.productPrice +
                    item.modifiers.fold(0.0) { sum, modifier -> sum + modifier.priceAdjustment },
                item.quantity,
                item.isVatable,
                discounts
                    .filter { it.itemId == item.id }
                    .fold(0.0) { sum, discount -> sum + discount.quantity },
                vatRate,
            )
        },
        discounts
            .filter { it.itemId.isNullOrEmpty() }
            .fold(0.0) { sum, discount -> sum + discount.amount },
    )
