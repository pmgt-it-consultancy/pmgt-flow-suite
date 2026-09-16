package com.pmgt.pos.browse

import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow

data class OrderSummary(
    val id: String,
    val orderNumber: String,
    val orderType: String,
    val status: String,
    val tableId: String?,
    val tableName: String?,
    val customerName: String?,
    val draftLabel: String?,
    val netSales: Double,
    val itemCount: Double,
    val createdAt: Long,
    val paymentMethod: String?,
    val takeoutStatus: String = "pending",
    val tabNumber: Int = 1,
    val tabName: String = "Tab 1",
    val pax: Double? = null,
    val refundedFromOrderId: String? = null,
)

data class DiningTable(
    val id: String,
    val name: String,
    val capacity: Int,
    val orders: List<OrderSummary>,
) {
    val occupied
        get() = orders.isNotEmpty()

    val totalItems
        get() = orders.sumOf { it.itemCount }

    val totalNetSales
        get() = orders.sumOf { it.netSales }
}

enum class DatePreset(val label: String) {
    Today("Today"),
    Yesterday("Yesterday"),
    Week("Last 7 Days"),
    Month("Last 30 Days"),
}

enum class HistoryStatus(val label: String, val value: String?) {
    All("All", null),
    Paid("Paid", "paid"),
    Voided("Voided", "voided"),
}

data class DayRange(val start: Long, val end: Long) {
    companion object {
        fun of(date: LocalDate, zone: ZoneId = ZoneId.systemDefault()) =
            DayRange(
                date.atStartOfDay(zone).toInstant().toEpochMilli(),
                date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() - 1,
            )

        fun preset(
            preset: DatePreset,
            today: LocalDate = LocalDate.now(),
            zone: ZoneId = ZoneId.systemDefault(),
        ): DayRange {
            val end = if (preset == DatePreset.Yesterday) today.minusDays(1) else today
            val start =
                when (preset) {
                    DatePreset.Week -> today.minusDays(6)
                    DatePreset.Month -> today.minusDays(29)
                    else -> end
                }
            return DayRange(of(start, zone).start, of(end, zone).end)
        }
    }
}

data class HistoryFilter(
    val range: DayRange,
    val status: HistoryStatus = HistoryStatus.All,
    val search: String = "",
)

data class TakeoutLane(
    val drafts: List<OrderSummary>,
    val attention: List<OrderSummary>,
    val progress: List<OrderSummary>,
    val history: List<OrderSummary>,
)

data class DashboardSummary(val totalOrdersToday: Int, val todayRevenue: Double)

@kotlinx.serialization.Serializable
data class ItemModifier(val groupName: String, val optionName: String, val priceAdjustment: Double)

@kotlinx.serialization.Serializable
data class OrderLine(
    val id: String,
    val productId: String,
    val productName: String,
    val productPrice: Double,
    val quantity: Double,
    val notes: String?,
    val isVoided: Boolean,
    val isSentToKitchen: Boolean,
    val serviceType: String?,
    val isVatable: Boolean,
    val modifiers: List<ItemModifier>,
) {
    val lineTotal
        get() =
            if (isVoided) 0.0
            else (productPrice + modifiers.sumOf { it.priceAdjustment }) * quantity
}

data class OrderDiscount(
    val id: String,
    val itemId: String?,
    val itemName: String?,
    val type: String,
    val customerName: String,
    val customerId: String,
    val quantityApplied: Double,
    val amount: Double,
    val vatExemptAmount: Double,
    val approvedByName: String,
    val createdAt: Long,
)

data class OrderPayment(
    val id: String,
    val method: String,
    val amount: Double,
    val cashReceived: Double?,
    val changeGiven: Double?,
    val cardType: String?,
    val cardReference: String?,
)

data class OrderVoid(
    val id: String,
    val type: String,
    val itemId: String?,
    val reason: String,
    val amount: Double,
    val approvedByName: String,
    val requestedByName: String,
    val createdAt: Long,
)

data class ReceiptStore(
    val name: String,
    val address1: String,
    val address2: String?,
    val tin: String,
    val min: String,
    val footer: String?,
)

data class OrderDetail(
    val summary: OrderSummary,
    val storeId: String,
    val store: ReceiptStore?,
    val grossSales: Double,
    val vatableSales: Double,
    val vatAmount: Double,
    val vatExemptSales: Double,
    val nonVatSales: Double,
    val discountAmount: Double,
    val createdBy: String,
    val createdByName: String,
    val paidAt: Long?,
    val paidBy: String?,
    val cashReceived: Double?,
    val changeGiven: Double?,
    val cardType: String?,
    val cardReference: String?,
    val orderCategory: String?,
    val tableMarker: String?,
    val items: List<OrderLine>,
    val discounts: List<OrderDiscount>,
    val payments: List<OrderPayment>,
    val voids: List<OrderVoid>,
)

interface BrowseRepository {
    fun activeOrders(storeId: String): Flow<List<OrderSummary>>

    fun tables(storeId: String): Flow<List<DiningTable>>

    fun takeout(storeId: String, range: DayRange): Flow<TakeoutLane>

    fun history(storeId: String, filter: HistoryFilter): Flow<List<OrderSummary>>

    fun detail(storeId: String, orderId: String): Flow<OrderDetail?>
}

/**
 * Navigation/mutation ownership remains with the order, checkout, printing and settings features.
 */
sealed interface BrowseAction {
    data class OpenDineIn(
        val storeId: String,
        val tableId: String,
        val tableName: String,
        val orderId: String? = null,
    ) : BrowseAction

    data class OpenTakeout(val storeId: String, val orderId: String) : BrowseAction

    data class NewTableTab(val storeId: String, val tableId: String, val tableName: String) :
        BrowseAction

    data class NewTakeout(val storeId: String) : BrowseAction

    data class DiscardDraft(val orderId: String) : BrowseAction

    data class AdvanceTakeout(val orderId: String, val nextStatus: String) : BrowseAction

    data class Checkout(val orderId: String, val orderType: String) : BrowseAction

    data class Reprint(val orderId: String) : BrowseAction

    data class ReceiptPreview(val orderId: String) : BrowseAction

    data class Refund(val orderId: String) : BrowseAction

    data class Void(val orderId: String) : BrowseAction

    data object Settings : BrowseAction

    data object DayClosing : BrowseAction

    data object SystemStatus : BrowseAction
}
