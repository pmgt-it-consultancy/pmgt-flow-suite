package com.pmgt.pos.closing

import com.pmgt.pos.checkout.PendingFinancialAction
import java.time.DayOfWeek
import java.time.LocalDate

data class ScheduleSlot(val open: String, val close: String)

data class StoreSchedule(
    val monday: ScheduleSlot? = null,
    val tuesday: ScheduleSlot? = null,
    val wednesday: ScheduleSlot? = null,
    val thursday: ScheduleSlot? = null,
    val friday: ScheduleSlot? = null,
    val saturday: ScheduleSlot? = null,
    val sunday: ScheduleSlot? = null,
) {
    fun slot(date: String): ScheduleSlot? =
        when (LocalDate.parse(date).dayOfWeek) {
            DayOfWeek.MONDAY -> monday
            DayOfWeek.TUESDAY -> tuesday
            DayOfWeek.WEDNESDAY -> wednesday
            DayOfWeek.THURSDAY -> thursday
            DayOfWeek.FRIDAY -> friday
            DayOfWeek.SATURDAY -> saturday
            DayOfWeek.SUNDAY -> sunday
        }
}

data class ClosingStore(
    val id: String,
    val name: String,
    val address1: String,
    val address2: String?,
    val tin: String,
    val schedule: StoreSchedule?,
)

data class DailyClosingReport(
    val id: String,
    val reportDate: String,
    val startTime: String?,
    val endTime: String?,
    val grossSales: Double,
    val vatableSales: Double,
    val vatAmount: Double,
    val vatExemptSales: Double,
    val nonVatSales: Double,
    val netSales: Double,
    val seniorDiscounts: Double,
    val pwdDiscounts: Double,
    val promoDiscounts: Double,
    val manualDiscounts: Double,
    val totalDiscounts: Double,
    val voidCount: Int,
    val voidAmount: Double,
    val cashTotal: Double,
    val cardEwalletTotal: Double,
    val transactionCount: Int,
    val averageTicket: Double,
    val generatedAt: Long,
    val generatedByName: String,
    val isPrinted: Boolean,
    val printedAt: Long?,
)

data class ProductSale(
    val productId: String,
    val productName: String,
    val categoryId: String,
    val categoryName: String,
    val parentCategoryName: String,
    val quantitySold: Double,
    val grossAmount: Double,
    val voidedQuantity: Double,
    val voidedAmount: Double,
)

data class PaymentTransaction(
    val orderId: String,
    val orderNumber: String,
    val referenceNumber: String,
    val amount: Double,
    val paidAt: Long,
)

data class PaymentTransactionGroup(
    val paymentType: String,
    val transactions: List<PaymentTransaction>,
    val subtotal: Double,
)

enum class ReconciliationStatus { Pending, Failed }

data class ReconciliationJob(
    val jobId: String,
    val orderId: String,
    val mutationId: String,
    val status: ReconciliationStatus,
    val blockedReason: String? = null,
)

data class TotalsDivergence(
    val orderId: String,
    val deviceTotals: Map<String, Double>,
    val reconciledTotals: Map<String, Double>,
    val fields: List<String>,
)

data class ClosingAttention(
    val jobs: List<ReconciliationJob> = emptyList(),
    val divergences: List<TotalsDivergence> = emptyList(),
)

enum class ClosingOperation { Refreshing, Generating, Retrying, Syncing, Printing }

data class ClosingNotice(val title: String, val message: String)

data class ClosingState(
    val storeId: String? = null,
    val todayBusinessDate: String? = null,
    val selectedDate: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val store: ClosingStore? = null,
    val report: DailyClosingReport? = null,
    val productSales: List<ProductSale> = emptyList(),
    val paymentTransactions: List<PaymentTransactionGroup> = emptyList(),
    val attention: ClosingAttention = ClosingAttention(),
    val pendingFinancialActions: List<PendingFinancialAction> = emptyList(),
    val loading: Boolean = false,
    val operation: ClosingOperation? = null,
    val notice: ClosingNotice? = null,
    val finalized: Boolean = false,
    val readinessError: String? = "Closing readiness has not loaded",
    val pendingReadError: String? = "Local financial readiness has not loaded",
) {
    val crossesMidnight: Boolean get() = startTime != null && endTime != null && endTime <= startTime
    val canFinalize: Boolean
        get() =
            readinessError == null && pendingReadError == null && pendingFinancialActions.isEmpty() &&
                attention.jobs.isEmpty() && attention.divergences.isEmpty()
}

data class ZReportDocument(
    val storeName: String,
    val storeAddress: String?,
    val storeTin: String?,
    val report: DailyClosingReport,
    val productSales: List<ProductSale>,
    val paymentTransactions: List<PaymentTransactionGroup>,
    val printedAt: java.time.LocalDateTime,
)
