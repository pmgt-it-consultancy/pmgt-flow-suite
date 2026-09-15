package com.pmgt.pos.orders

import com.pmgt.pos.db.*
import com.pmgt.pos.money.Money
import java.time.Clock
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

class LocalOrderRepository(
    private val db: PosDatabase,
    private val io: CoroutineDispatcher,
    private val deviceId: () -> String,
    private val deviceCode: () -> String = { "" },
    private val triggerPush: () -> Unit = {},
    private val clock: Clock = Clock.systemDefaultZone(),
) : OrderEntryRepository {
    override suspend fun createDraft(storeId: String, label: String?): String =
        withContext(io) {
            val id = uid()
            db.insertLocal(
                "orders",
                fields(
                    "id" to id,
                    "store_id" to storeId,
                    "order_type" to "takeout",
                    "status" to "draft",
                    "draft_label" to label?.takeIf { it.isNotEmpty() },
                    "created_by" to "",
                    "created_at" to clock.millis(),
                    "takeout_status" to "pending",
                ),
            )
            triggerPush()
            id
        }

    override suspend fun createOrder(input: NewOrder): String =
        withContext(io) {
            if (!input.requestId.isNullOrEmpty()) {
                db.prepareOrderIndexes()
                db.select(
                        "orders",
                        "request_id = ? AND _status != 'deleted'",
                        listOf(input.requestId),
                        limit = 1,
                    )
                    .firstOrNull()
                    ?.let {
                        check(it.string("store_id") == input.storeId) {
                            "This request belongs to another store"
                        }
                        return@withContext it.string("id")!!
                    }
            }
            val number = nextNumber(input.orderType)
            val id = uid()
            // RN writer is serialized, but each create/update commits separately.
            synchronized(db) {
                db.insertLocal("orders", parent(id, number, input))
                input.tableId
                    ?.takeIf { it.isNotEmpty() }
                    ?.let { db.updateLocal("tables", it, fields("status" to "occupied")) }
            }
            triggerPush()
            id
        }

    override suspend fun reserveOrderNumber(orderType: String): String =
        withContext(io) { nextNumber(orderType) }

    override suspend fun cancel(orderId: String, committed: (CancelCommit) -> Unit) =
        withContext(io) {
            // Source writer serializes separate commits; child rows and current_order_id are
            // retained.
            val commit =
                synchronized(db) {
                    val order = required("orders", orderId)
                    val voidId = uid()
                    db.updateLocal("orders", orderId, fields("status" to "voided"))
                    db.insertLocal(
                        "order_voids",
                        fields(
                            "id" to voidId,
                            "order_id" to orderId,
                            "void_type" to "order",
                            "reason" to "Order cancelled by cashier",
                            "approved_by" to "",
                            "requested_by" to "",
                            "amount" to order.number("net_sales"),
                            "created_at" to clock.millis(),
                        ),
                    )
                    CancelCommit(
                            orderId,
                            voidId,
                            order.string("table_id").takeUnless { it.isNullOrEmpty() },
                        )
                        .also(committed)
                }
            finishCancellation(commit)
        }

    override suspend fun finishCancellation(commit: CancelCommit) =
        withContext(io) {
            synchronized(db) {
                val order = required("orders", commit.orderId)
                val evidence = required("order_voids", commit.voidId)
                check(
                    order.string("status") == "voided" &&
                        order.string("table_id").takeUnless { it.isNullOrEmpty() } ==
                            commit.tableId &&
                        evidence.string("order_id") == commit.orderId &&
                        evidence.string("void_type") == "order" &&
                        evidence.string("reason") == "Order cancelled by cashier" &&
                        evidence.string("approved_by").isNullOrEmpty() &&
                        evidence.string("requested_by").isNullOrEmpty()
                ) {
                    "Cancellation identity no longer matches the saved order"
                }
                commit.tableId?.let { tableId ->
                    val otherOpen =
                        db.select(
                            "orders",
                            "table_id = ? AND status = 'open' AND _status != 'deleted'",
                            listOf(tableId),
                        )
                    if (otherOpen.isEmpty())
                        db.updateLocal("tables", tableId, fields("status" to "available"))
                }
            }
            triggerPush()
        }

    private fun nextNumber(type: String): String {
        val code =
            deviceCode().ifEmpty {
                deviceId().replace(Regex("[^a-zA-Z0-9]"), "").take(4).uppercase().ifEmpty { "X" }
            }
        val key = "orderCounter.$type.${LocalDate.now(clock)}"
        val next =
            db.transaction {
                val row =
                    db.select(
                            "app_config",
                            "key = ? AND _status != 'deleted'",
                            listOf(key),
                            limit = 1,
                        )
                        .firstOrNull()
                val current =
                    row?.string("value")?.trimStart()?.let {
                        Regex("^[+-]?\\d+").find(it)?.value?.toDoubleOrNull()
                    } ?: 0.0
                val value = numberText(current + 1.0)
                if (row == null)
                    db.insertLocal(
                        "app_config",
                        fields("id" to uid(), "key" to key, "value" to value),
                    )
                else db.updateLocal("app_config", row.string("id")!!, fields("value" to value))
                value
            }
        return "${if (type == "dine_in") "D" else "T"}-$code${next.padStart(3, '0')}"
    }

    private fun parent(id: String, number: String, input: NewOrder) =
        fields(
            "id" to id,
            "store_id" to input.storeId,
            "order_number" to number,
            "order_type" to input.orderType,
            "table_id" to input.tableId?.takeIf { it.isNotEmpty() },
            "customer_name" to input.customerName?.takeIf { it.isNotEmpty() },
            "pax" to input.pax,
            "request_id" to input.requestId?.takeIf { it.isNotEmpty() },
            "status" to "open",
            "created_by" to "",
            "created_at" to clock.millis(),
        )

    override suspend fun addItem(orderId: String, item: ItemInput, committed: (String) -> Unit) =
        withContext(io) {
            val addedId =
                db.transaction {
                    val order = required("orders", orderId)
                    val id = insertItem(orderId, item, false)
                    db.updateLocal(
                        "orders",
                        orderId,
                        fields("item_count" to order.number("item_count") + item.quantity),
                    )
                    id
                }
            committed(addedId)
            recalculate(orderId)
            triggerPush()
        }

    override suspend fun quantity(itemId: String, quantity: Double) =
        withContext(io) {
            val orderId =
                db.transaction {
                    val item = required("order_items", itemId)
                    val id = item.string("order_id")!!
                    val order = required("orders", id)
                    db.updateLocal("order_items", itemId, fields("quantity" to quantity))
                    db.updateLocal(
                        "orders",
                        id,
                        fields(
                            "item_count" to
                                (order.number("item_count") - item.number("quantity") + quantity)
                        ),
                    )
                    id
                }
            recalculate(orderId)
            triggerPush()
        }

    override suspend fun remove(itemId: String, reason: String?) =
        withContext(io) {
            val orderId =
                db.transaction {
                    val item = required("order_items", itemId)
                    val id = item.string("order_id")!!
                    val order = required("orders", id)
                    db.updateLocal(
                        "order_items",
                        itemId,
                        fields(
                            "is_voided" to true,
                            "void_reason" to reason?.takeIf { it.isNotEmpty() },
                            "voided_at" to clock.millis(),
                        ),
                    )
                    db.updateLocal(
                        "orders",
                        id,
                        fields(
                            "item_count" to
                                maxOf(0.0, order.number("item_count") - item.number("quantity"))
                        ),
                    )
                    id
                }
            recalculate(orderId)
            triggerPush()
        }

    override suspend fun recalculate(orderId: String) =
        withContext(io) {
            // RN takes its read snapshot before its later writer. Do not fold this into the item
            // batch.
            val graph = db.transaction { readOrderGraph(db, orderId) }
            val calculations = graph.items.map { item -> graph.calculation(item) }
            val global =
                graph.discounts
                    .filter { it.string("order_item_id").isNullOrEmpty() }
                    .fold(0.0) { sum, discount -> sum + discount.number("discount_amount") }
            val totals = Money.persisted(calculations, global)
            val updates = mutableListOf<Pair<String, Row>>()
            for (item in graph.items) for (discount in
                graph.discounts.filter { it.string("order_item_id") == item.string("id") }) {
                if (discount.string("discount_type") !in setOf("senior_citizen", "pwd")) continue
                val quantity = discount.number("quantity_applied")
                val calc =
                    Money.itemTotals(
                        graph.unitPrice(item),
                        quantity,
                        graph.products[item.string("product_id")]?.boolean("is_vatable") ?: false,
                        quantity,
                        graph.vatRate,
                    )
                updates +=
                    discount.string("id")!! to
                        fields(
                            "discount_amount" to calc.discountAmount,
                            "vat_exempt_amount" to calc.vatExemptAmount,
                        )
            }
            val active = graph.items.map { it.string("id") }.toSet()
            for (discount in graph.discounts) if (
                !discount.string("order_item_id").isNullOrEmpty() &&
                    discount.string("order_item_id") !in active
            )
                updates +=
                    discount.string("id")!! to
                        fields("discount_amount" to 0.0, "vat_exempt_amount" to 0.0)
            synchronized(db) {
                for ((id, fields) in updates) db.updateLocal("order_discounts", id, fields)
                db.updateLocal(
                    "orders",
                    orderId,
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
            }
        }

    override fun cart(storeId: String, orderId: String): Flow<OrderCart?> =
        db.changes
            .map {
                db.transaction {
                    val order = db.get("orders", orderId)
                    if (
                        order == null ||
                            order.string("store_id") != storeId ||
                            order.string("_status") == "deleted"
                    )
                        null
                    else readOrderGraph(db, orderId).cart(db)
                }
            }
            .distinctUntilChanged()
            .flowOn(io)

    override fun availableTables(storeId: String): Flow<List<TransferTable>> =
        db.changes
            .map {
                db.select(
                        "tables",
                        "store_id = ? AND is_active = 1 AND status = 'available' AND _status != 'deleted'",
                        listOf(storeId),
                        orderBy = "sort_order ASC",
                    )
                    .map {
                        TransferTable(
                            it.string("id")!!,
                            it.string("name").orEmpty(),
                            it.number("capacity"),
                        )
                    }
            }
            .distinctUntilChanged()
            .flowOn(io)

    override suspend fun createAndSend(
        input: NewOrder,
        items: List<ItemInput>,
        committed: (CreatedOrder) -> Unit,
    ): CreatedOrder =
        withContext(io) {
            val id = uid()
            val number = nextNumber("dine_in")
            val sent =
                db.transaction {
                    required("tables", requireNotNull(input.tableId))
                    items.forEach { required("products", it.productId) }
                    db.insertLocal(
                        "orders",
                        JsonObject(
                            parent(id, number, input.copy(orderType = "dine_in")) +
                                fields(
                                    "item_count" to
                                        items.fold(0.0) { sum, item -> sum + item.quantity }
                                )
                        ),
                    )
                    val ids = items.map { insertItem(id, it, true) }
                    db.updateLocal("tables", input.tableId, fields("status" to "occupied"))
                    ids
                }
            val result = CreatedOrder(id, number, sent)
            // Runs before a dispatcher return can throw cancellation: callers retain this known
            // commit.
            committed(result)
            recalculate(id)
            triggerPush()
            result
        }

    override suspend fun serviceType(itemId: String, type: String) =
        patch("order_items", itemId, fields("service_type" to type))

    override suspend fun pax(orderId: String, pax: Double) =
        patch("orders", orderId, fields("pax" to pax))

    override suspend fun tabName(orderId: String, name: String) =
        patch("orders", orderId, fields("tab_name" to name))

    override suspend fun customer(
        orderId: String,
        name: String?,
        category: String?,
        marker: String?,
    ) {
        val updates = mutableListOf<Pair<String, Any?>>()
        if (name != null) updates += "customer_name" to name.takeIf { it.isNotEmpty() }
        if (category != null) updates += "order_category" to category
        if (marker != null) updates += "table_marker" to marker.takeIf { it.isNotEmpty() }
        patch("orders", orderId, fields(*updates.toTypedArray()))
    }

    override suspend fun send(orderId: String) =
        withContext(io) {
            synchronized(db) {
                db.select(
                        "order_items",
                        "order_id = ? AND is_voided = 0 AND is_sent_to_kitchen = 0 AND _status != 'deleted'",
                        listOf(orderId),
                    )
                    .forEach {
                        db.updateLocal(
                            "order_items",
                            it.string("id")!!,
                            fields("is_sent_to_kitchen" to true),
                        )
                    }
            }
            triggerPush()
        }

    override suspend fun transfer(orderId: String, tableId: String) =
        withContext(io) {
            synchronized(db) {
                val order = required("orders", orderId)
                check(order.string("status") == "open") { "Order is not open" }
                val sourceId =
                    requireNotNull(order.string("table_id")) { "Order is not a dine-in order" }
                val destination = required("tables", tableId)
                val destOrders =
                    db.select(
                        "orders",
                        "table_id = ? AND status = 'open' AND _status != 'deleted'",
                        listOf(tableId),
                    )
                val sourceOrders =
                    db.select(
                        "orders",
                        "table_id = ? AND status = 'open' AND _status != 'deleted'",
                        listOf(sourceId),
                    )
                val number =
                    destOrders.fold(0.0) { max, row ->
                        maxOf(max, row.string("tab_number")?.toDoubleOrNull() ?: 1.0)
                    } + 1.0
                if (sourceOrders.none { it.string("id") != orderId })
                    db.updateLocal(
                        "tables",
                        sourceId,
                        fields("status" to "available", "current_order_id" to null),
                    )
                if (destOrders.isEmpty())
                    db.updateLocal(
                        "tables",
                        tableId,
                        fields("status" to "occupied", "current_order_id" to orderId),
                    )
                db.updateLocal(
                    "orders",
                    orderId,
                    fields(
                        "table_id" to tableId,
                        "table_name" to destination.string("name"),
                        "tab_number" to number,
                        "tab_name" to "Tab ${numberText(number)}",
                    ),
                )
            }
            triggerPush()
        }

    override suspend fun discardDraft(orderId: String) =
        patch("orders", orderId, fields("status" to "voided"))

    override suspend fun submitDraft(orderId: String) =
        patch("orders", orderId, fields("status" to "open", "takeout_status" to "pending"))

    override suspend fun advanceTakeout(orderId: String, status: String) =
        patch("orders", orderId, fields("takeout_status" to status))

    private suspend fun patch(table: String, id: String, values: Row) =
        withContext(io) {
            db.updateLocal(table, id, values)
            triggerPush()
        }

    private fun required(table: String, id: String) =
        requireNotNull(db.get(table, id)?.takeUnless { it.string("_status") == "deleted" }) {
            "Local record is unavailable"
        }

    private fun insertItem(orderId: String, item: ItemInput, sent: Boolean): String {
        val product = required("products", item.productId)
        val id = uid()
        db.insertLocal(
            "order_items",
            fields(
                "id" to id,
                "order_id" to orderId,
                "product_id" to item.productId,
                "product_name" to product.string("name"),
                "product_price" to (item.customPrice ?: product.number("price")),
                "quantity" to item.quantity,
                "notes" to item.notes?.takeIf { it.isNotEmpty() },
                "is_voided" to false,
                "is_sent_to_kitchen" to sent,
            ),
        )
        for (modifier in item.modifiers) db.insertLocal(
            "order_item_modifiers",
            fields(
                "id" to uid(),
                "order_item_id" to id,
                "modifier_group_name" to modifier.modifierGroupName,
                "modifier_option_name" to modifier.modifierOptionName,
                "price_adjustment" to modifier.priceAdjustment,
            ),
        )
        return id
    }
}

internal fun uid() = UUID.randomUUID().toString()

internal fun numberText(number: Double): String =
    if (number == number.toLong().toDouble()) number.toLong().toString() else number.toString()

internal fun fields(vararg values: Pair<String, Any?>): Row =
    JsonObject(
        values.associate { (key, value) ->
            key to
                when (value) {
                    null -> JsonNull
                    is Boolean -> JsonPrimitive(value)
                    is Number -> JsonPrimitive(value)
                    else -> JsonPrimitive(value.toString())
                }
        }
    )
