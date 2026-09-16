package com.pmgt.pos.printer

import java.time.LocalDateTime

/** Immutable input snapshots consumed by the pure receipt and kitchen formatters. */
data class StoreSocial(val platform: String, val url: String)

data class PrinterModifier(val optionName: String, val priceAdjustment: Double)

enum class ServiceType { DINE_IN, TAKEOUT }

enum class OrderCategory { DINE_IN, TAKEOUT }

enum class OrderType { DINE_IN, TAKE_OUT, DELIVERY }

enum class DiscountType { SC, PWD, CUSTOM }

enum class PaymentMethod { CASH, CARD, CARD_EWALLET }

data class ReceiptItem(
    val name: String,
    val quantity: Double,
    val price: Double,
    val total: Double,
    val modifiers: List<PrinterModifier> = emptyList(),
    val serviceType: ServiceType? = null,
)

data class ReceiptDiscount(
    val type: DiscountType,
    val customerName: String,
    val customerId: String,
    val itemName: String,
    val amount: Double,
)

data class ReceiptPayment(
    val paymentMethod: PaymentMethod,
    val amount: Double,
    val cashReceived: Double? = null,
    val changeGiven: Double? = null,
    val cardPaymentType: String? = null,
    val cardReferenceNumber: String? = null,
)

/** Current order snapshot printed before settlement; deliberately carries no payment fields. */
data class BillDocument(
    val storeName: String,
    val storeAddress: String? = null,
    val storeTin: String? = null,
    val storeContactNumber: String? = null,
    val storeTelephone: String? = null,
    val storeEmail: String? = null,
    val storeWebsite: String? = null,
    val storeFooter: String? = null,
    val orderNumber: String,
    val tableName: String? = null,
    val tableMarker: String? = null,
    val orderCategory: OrderCategory? = null,
    val pax: Double? = null,
    val orderType: OrderType,
    val cashierName: String,
    val customerName: String? = null,
    val items: List<ReceiptItem>,
    val subtotal: Double,
    val discounts: List<ReceiptDiscount>,
    val vatableSales: Double,
    val vatAmount: Double,
    val vatExemptSales: Double,
    val total: Double,
    val orderDefaultServiceType: ServiceType? = null,
    val printedAt: LocalDateTime,
)

data class ReceiptDocument(
    val storeName: String,
    val storeAddress: String? = null,
    val storeTin: String? = null,
    val storeContactNumber: String? = null,
    val storeTelephone: String? = null,
    val storeEmail: String? = null,
    val storeWebsite: String? = null,
    val storeSocials: List<StoreSocial> = emptyList(),
    val storeFooter: String? = null,
    val orderNumber: String,
    val tableName: String? = null,
    val tableMarker: String? = null,
    val orderCategory: OrderCategory? = null,
    val pax: Double? = null,
    val orderType: OrderType,
    val cashierName: String,
    val items: List<ReceiptItem>,
    val subtotal: Double,
    val discounts: List<ReceiptDiscount>,
    val vatableSales: Double,
    val vatAmount: Double,
    val vatExemptSales: Double,
    val total: Double,
    val paymentMethod: PaymentMethod,
    val amountTendered: Double? = null,
    val change: Double? = null,
    val cardLastFour: String? = null,
    val cardPaymentType: String? = null,
    val cardReferenceNumber: String? = null,
    val payments: List<ReceiptPayment>? = null,
    val orderDefaultServiceType: ServiceType? = null,
    val transactionDate: LocalDateTime,
    val receiptNumber: String? = null,
    val customerName: String? = null,
    val customerId: String? = null,
    val customerAddress: String? = null,
    val customerTin: String? = null,
)

data class KitchenTicketItem(
    val name: String,
    val quantity: Double,
    val notes: String? = null,
    val modifiers: List<PrinterModifier> = emptyList(),
    val serviceType: ServiceType? = null,
)

data class KitchenTicketDocument(
    val orderNumber: String,
    val orderType: OrderType,
    val orderCategory: OrderCategory? = null,
    val orderDefaultServiceType: ServiceType? = null,
    val tableMarker: String? = null,
    val customerName: String? = null,
    val items: List<KitchenTicketItem>,
    val timestamp: LocalDateTime,
)

enum class PrinterAlignment(val nativeValue: Int) {
    LEFT(0),
    CENTER(1),
    RIGHT(2),
    ;

    companion object {
        fun fromNative(value: Int): PrinterAlignment =
            entries.firstOrNull { it.nativeValue == value }
                ?: throw IllegalArgumentException("Unsupported printer alignment: $value")
    }
}

data class PrinterTextStyle(
    val encoding: String = "UTF-8",
    val codePage: Int = 0,
    val widthTimes: Int = 0,
    val heightTimes: Int = 0,
    val fontType: Int = 0,
)

sealed interface PrinterCall {
    data class Align(val alignment: PrinterAlignment) : PrinterCall

    data class Text(
        val text: String,
        val style: PrinterTextStyle = PrinterTextStyle(),
        val cut: Boolean = false,
    ) : PrinterCall

    /** Approved repair for RN Test Print's missing native cutPaper bridge method. */
    data object FeedAndCut : PrinterCall

    /** RN openCashDrawer(): the bridge's openDrawer with the unchanged service defaults. */
    data object OpenDrawer : PrinterCall
}
