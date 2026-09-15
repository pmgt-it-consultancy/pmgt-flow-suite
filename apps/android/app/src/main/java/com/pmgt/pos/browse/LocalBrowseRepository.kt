package com.pmgt.pos.browse

import com.pmgt.pos.db.*
import java.util.Locale
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.yield

/** JSON never leaves this data boundary. Each subscription belongs to a visible route. */
@OptIn(ExperimentalCoroutinesApi::class)
class LocalBrowseRepository(private val db: PosDatabase, private val io: CoroutineDispatcher) :
    BrowseRepository {
    private fun <T> observe(read: suspend () -> T): Flow<T> =
        db.changes
            .mapLatest {
                db.prepareBrowseIndexes()
                read()
            }
            .distinctUntilChanged()
            .flowOn(io)

    override fun activeOrders(storeId: String) = observe {
        db.transaction { summaries(orders(storeId, "status = 'open'"), currentTable = false) }
    }

    override fun tables(storeId: String) = observe {
        db.transaction {
            val tables =
                db.select(
                    "tables",
                    "$LIVE AND store_id = ? AND is_active = 1",
                    listOf(storeId),
                    "sort_order ASC, id ASC",
                )
            val tabs =
                tables
                    .map { it.id() }
                    .chunked(400)
                    .flatMap { ids ->
                        orders(storeId, "status = 'open' AND table_id IN (${marks(ids)})", ids)
                    }
            val grouped = summaries(tabs, currentTable = false).groupBy { it.tableId }
            tables.map {
                DiningTable(
                    it.id(),
                    it.text("name"),
                    it.number("capacity").toInt(),
                    grouped[it.id()]
                        .orEmpty()
                        .sortedWith(compareBy<OrderSummary> { it.tabNumber }.thenBy { it.id }),
                )
            }
        }
    }

    override fun history(storeId: String, filter: HistoryFilter) = observe {
        val where =
            "$LIVE AND store_id = ? AND status != 'draft' AND created_at >= ? AND created_at <= ?" +
                if (filter.status.value != null) " AND status = ?" else ""
        val args =
            listOf(storeId, filter.range.start, filter.range.end) +
                listOfNotNull(filter.status.value)
        val selected =
            if (filter.search.isEmpty()) db.select("orders", where, args, NEWEST, 50)
            else {
                // SQLite LOWER is ASCII-only. Bounded keyset batches preserve RN Unicode/literal
                // search.
                val matches = mutableListOf<Row>()
                var last: Row? = null
                val needle = filter.search.lowercase(Locale.ROOT)
                while (matches.size < 50) {
                    val after = last
                    val rows =
                        db.select(
                            "orders",
                            where +
                                if (after == null) ""
                                else " AND (created_at < ? OR (created_at = ? AND id > ?))",
                            args +
                                if (after == null) emptyList()
                                else
                                    listOf(
                                        after.number("created_at"),
                                        after.number("created_at"),
                                        after.id(),
                                    ),
                            NEWEST,
                            50,
                        )
                    if (rows.isEmpty()) break
                    matches +=
                        rows
                            .filter {
                                it.text("order_number").lowercase(Locale.ROOT).contains(needle) ||
                                    it.text("customer_name").lowercase(Locale.ROOT).contains(needle)
                            }
                            .take(50 - matches.size)
                    last = rows.last()
                    yield()
                }
                matches
            }
        db.transaction { summaries(selected, currentTable = true) }
    }

    override fun takeout(storeId: String, range: DayRange) = observe {
        db.transaction {
            val rows =
                orders(
                    storeId,
                    "order_type = 'takeout' AND status IN ('open','paid','draft') AND created_at >= ? AND created_at <= ?",
                    listOf(range.start, range.end),
                )
            val orders =
                summaries(rows, currentTable = false, recalculate = true).map {
                    it.copy(refundedFromOrderId = null)
                }
            TakeoutLane(
                summaries(orders(storeId, "status = 'draft'"), currentTable = false),
                orders.filter { it.status == "open" && it.takeoutStatus == "pending" },
                orders.filter {
                    it.status == "paid" && it.takeoutStatus !in setOf("completed", "cancelled") ||
                        it.status == "open" &&
                            it.takeoutStatus in setOf("preparing", "ready_for_pickup")
                },
                orders.filter {
                    it.status == "paid" && it.takeoutStatus in setOf("completed", "cancelled")
                },
            )
        }
    }

    override fun detail(storeId: String, orderId: String) = observe {
        db.transaction {
            val order =
                db.select(
                        "orders",
                        "$LIVE AND store_id = ? AND id = ?",
                        listOf(storeId, orderId),
                        limit = 1,
                    )
                    .firstOrNull() ?: return@transaction null
            val items = children("order_items", "order_id", listOf(orderId))
            val modifiers =
                children("order_item_modifiers", "order_item_id", items.map { it.id() }).groupBy {
                    it.text("order_item_id")
                }
            val discounts = children("order_discounts", "order_id", listOf(orderId))
            val voids = children("order_voids", "order_id", listOf(orderId))
            val users =
                references(
                    "users",
                    listOfNotNull(order.string("created_by"), order.string("paid_by")) +
                        discounts.mapNotNull { it.string("approved_by") } +
                        voids.flatMap {
                            listOfNotNull(it.string("approved_by"), it.string("requested_by"))
                        },
                )
            val products = references("products", items.map { it.text("product_id") })
            val table = references("tables", listOfNotNull(order.string("table_id")))
            val store = references("stores", listOf(storeId))[storeId]
            val lines =
                items.map { item ->
                    OrderLine(
                        item.id(),
                        item.text("product_id"),
                        item.text("product_name"),
                        item.number("product_price"),
                        item.number("quantity"),
                        item.string("notes"),
                        item.boolean("is_voided"),
                        item.boolean("is_sent_to_kitchen"),
                        item.string("service_type"),
                        products[item.text("product_id")]?.boolean("is_vatable") ?: true,
                        modifiers[item.id()].orEmpty().map {
                            ItemModifier(
                                it.text("modifier_group_name"),
                                it.text("modifier_option_name"),
                                it.number("price_adjustment"),
                            )
                        },
                    )
                }
            val payments =
                children("order_payments", "order_id", listOf(orderId))
                    .map {
                        OrderPayment(
                            it.id(),
                            it.text("payment_method"),
                            it.number("amount"),
                            it.optionalNumber("cash_received"),
                            it.optionalNumber("change_given"),
                            it.string("card_payment_type"),
                            it.string("card_reference_number"),
                        )
                    }
                    .ifEmpty {
                        order
                            .string("payment_method")
                            ?.let {
                                listOf(
                                    OrderPayment(
                                        "legacy-$orderId",
                                        it,
                                        order.number("net_sales"),
                                        order.optionalNumber("cash_received"),
                                        order.optionalNumber("change_given"),
                                        order.string("card_payment_type"),
                                        order.string("card_reference_number"),
                                    )
                                )
                            }
                            .orEmpty()
                    }
            OrderDetail(
                summary(
                    order,
                    items.sumOf { if (it.boolean("is_voided")) 0.0 else it.number("quantity") },
                    table[order.string("table_id")]?.string("name"),
                ),
                storeId,
                store?.let {
                    ReceiptStore(
                        it.text("name"),
                        it.text("address1"),
                        it.string("address2"),
                        it.text("tin"),
                        it.text("min"),
                        it.string("footer"),
                    )
                },
                order.number("gross_sales"),
                order.number("vatable_sales"),
                order.number("vat_amount"),
                order.number("vat_exempt_sales"),
                order.number("non_vat_sales"),
                order.number("discount_amount"),
                order.text("created_by"),
                users[order.string("created_by")]?.string("name") ?: "Unknown",
                order.optionalNumber("paid_at")?.toLong(),
                order.string("paid_by"),
                order.optionalNumber("cash_received"),
                order.optionalNumber("change_given"),
                order.string("card_payment_type"),
                order.string("card_reference_number"),
                order.string("order_category"),
                order.string("table_marker"),
                lines,
                discounts.map { d ->
                    OrderDiscount(
                        d.id(),
                        d.string("order_item_id"),
                        items.find { it.id() == d.string("order_item_id") }?.string("product_name"),
                        d.text("discount_type"),
                        d.text("customer_name"),
                        d.text("customer_id"),
                        d.number("quantity_applied"),
                        d.number("discount_amount"),
                        d.number("vat_exempt_amount"),
                        users[d.string("approved_by")]?.string("name") ?: "Unknown",
                        d.number("created_at").toLong(),
                    )
                },
                payments,
                voids
                    .sortedByDescending { it.number("created_at") }
                    .map { v ->
                        OrderVoid(
                            v.id(),
                            v.text("void_type"),
                            v.string("order_item_id"),
                            v.text("reason"),
                            v.number("amount"),
                            users[v.string("approved_by")]?.string("name") ?: "Unknown",
                            users[v.string("requested_by")]?.string("name") ?: "Unknown",
                            v.number("created_at").toLong(),
                        )
                    },
            )
        }
    }

    private fun orders(storeId: String, where: String, args: List<Any?> = emptyList()) =
        db.select("orders", "$LIVE AND store_id = ? AND $where", listOf(storeId) + args, NEWEST)

    private fun children(table: String, foreignKey: String, ids: List<String>): List<Row> =
        ids.distinct().chunked(400).flatMap {
            db.select(table, "$LIVE AND $foreignKey IN (${marks(it)})", it)
        }

    private fun references(table: String, ids: List<String>) =
        children(table, "id", ids.filter { it.isNotEmpty() }).associateBy { it.id() }

    private fun summaries(
        rows: List<Row>,
        currentTable: Boolean,
        recalculate: Boolean = false,
    ): List<OrderSummary> {
        val items =
            children("order_items", "order_id", rows.map { it.id() }).groupBy {
                it.text("order_id")
            }
        val tableNames =
            if (currentTable) references("tables", rows.mapNotNull { it.string("table_id") })
            else emptyMap()
        val mods =
            if (recalculate)
                children(
                        "order_item_modifiers",
                        "order_item_id",
                        items.values.flatten().map { it.id() },
                    )
                    .groupBy { it.text("order_item_id") }
            else emptyMap()
        return rows.map { row ->
            val orderItems = items[row.id()].orEmpty()
            val liveItems = orderItems.filterNot { it.boolean("is_voided") }
            summary(
                    row,
                    liveItems.sumOf { it.number("quantity") },
                    tableNames[row.string("table_id")]?.string("name"),
                )
                .let { result ->
                    if (
                        recalculate &&
                            row.string("status") in setOf("open", "draft") &&
                            orderItems.isNotEmpty()
                    )
                        result.copy(
                            netSales =
                                liveItems.sumOf {
                                    (it.number("product_price") +
                                        mods[it.id()].orEmpty().sumOf { m ->
                                            m.number("price_adjustment")
                                        }) * it.number("quantity")
                                }
                        )
                    else result
                }
        }
    }

    private fun summary(row: Row, count: Double, tableName: String?) =
        OrderSummary(
            row.id(),
            row.text("order_number"),
            row.text("order_type"),
            row.text("status"),
            row.string("table_id"),
            tableName ?: row.string("table_name"),
            row.string("customer_name"),
            row.string("draft_label"),
            row.number("net_sales"),
            count,
            row.number("created_at").toLong(),
            row.string("payment_method"),
            row.string("takeout_status") ?: "pending",
            row.optionalNumber("tab_number")?.toInt() ?: 1,
            row.string("tab_name") ?: "Tab ${row.optionalNumber("tab_number")?.toInt() ?: 1}",
            row.optionalNumber("pax"),
            row.string("refunded_from_order_id"),
        )

    private fun Row.id() = text("id")

    private fun Row.text(key: String) = string(key).orEmpty()

    private fun Row.optionalNumber(key: String) = if (string(key) == null) null else number(key)

    private fun marks(ids: List<String>) = ids.joinToString { "?" }

    companion object {
        private const val LIVE = "_status != 'deleted'"
        private const val NEWEST = "created_at DESC, id ASC"
    }
}
