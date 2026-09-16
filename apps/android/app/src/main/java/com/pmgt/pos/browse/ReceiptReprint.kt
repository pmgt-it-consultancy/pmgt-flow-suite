package com.pmgt.pos.browse

import com.pmgt.pos.orders.KitchenRequest
import com.pmgt.pos.printer.DiscountType
import com.pmgt.pos.printer.KitchenTicketDocument
import com.pmgt.pos.printer.OrderCategory
import com.pmgt.pos.printer.OrderType
import com.pmgt.pos.printer.PaymentMethod
import com.pmgt.pos.printer.PrinterModifier
import com.pmgt.pos.printer.ReceiptDiscount
import com.pmgt.pos.printer.ReceiptDocument
import com.pmgt.pos.printer.ReceiptItem
import com.pmgt.pos.printer.ReceiptPayment
import com.pmgt.pos.printer.ServiceType
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.coroutines.CancellationException

/**
 * The server receipt audit for a history reprint. The source awaits this before any printer write,
 * so a failed audit means nothing is printed.
 */
interface ReprintAudit {
    /**
     * The order's verified server id, or null when it has never synced. A local-only order has no
     * server identity, and one is never fabricated to satisfy the mutation.
     */
    suspend fun serverOrderId(orderId: String): String?

    suspend fun logReceiptReprint(serverOrderId: String)
}

sealed interface ReprintResult {
    /** The audit was written and the receipt reached the printer. */
    data object Printed : ReprintResult

    /** The order has no verified server id yet, so no audit could be written. */
    data object NotSynced : ReprintResult

    /** The audit failed; per the source ordering nothing was printed. */
    data object AuditFailed : ReprintResult

    /** The audit was written and is retained; only the printer write failed. */
    data object PrintFailed : ReprintResult
}

/**
 * Ports the source order-detail reprint: audit first, then print. Retrying calls this again, so a
 * second attempt writes a second audit entry, exactly as the source does. The receipt preview's
 * Print Again and the kitchen ticket are separate, unaudited paths and must not route through here.
 */
suspend fun reprintReceipt(
    detail: OrderDetail,
    audit: ReprintAudit,
    print: suspend (ReceiptDocument) -> Unit,
): ReprintResult {
    val serverId =
        try {
            audit.serverOrderId(detail.summary.id)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            null
        } ?: return ReprintResult.NotSynced
    try {
        audit.logReceiptReprint(serverId)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        return ReprintResult.AuditFailed
    }
    return try {
        print(detail.toReceipt())
        ReprintResult.Printed
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        ReprintResult.PrintFailed
    }
}

/**
 * Maps a stored order to the printable receipt the source builds for history reprint and the paid
 * takeout preview. This is deliberately narrower than the checkout receipt: the source's history
 * path carries only store name, address and TIN — no contacts, socials or footer — and derives the
 * default service type from `orderType` alone, never from `orderCategory`.
 */
fun OrderDetail.toReceipt(zone: ZoneId = ZoneId.systemDefault()): ReceiptDocument {
    val defaultService =
        if (summary.orderType == "dine_in") ServiceType.DINE_IN else ServiceType.TAKEOUT
    return ReceiptDocument(
        storeName = store?.name ?: "Store",
        storeAddress =
            listOfNotNull(store?.address1, store?.address2)
                .filter { it.isNotEmpty() }
                .joinToString(", "),
        storeTin = store?.tin,
        orderNumber = summary.orderNumber,
        tableName = summary.tableName,
        tableMarker = tableMarker,
        orderCategory =
            when (orderCategory) {
                "dine_in" -> OrderCategory.DINE_IN
                "takeout" -> OrderCategory.TAKEOUT
                else -> null
            },
        pax = summary.pax,
        orderType =
            when (summary.orderType) {
                "take_out" -> OrderType.TAKE_OUT
                "delivery" -> OrderType.DELIVERY
                else -> OrderType.DINE_IN
            },
        cashierName = createdByName,
        items =
            items.filterNot { it.isVoided }.map { line ->
                ReceiptItem(
                    name = line.productName,
                    quantity = line.quantity,
                    price = line.productPrice,
                    total = line.lineTotal,
                    modifiers =
                        line.modifiers.map { PrinterModifier(it.optionName, it.priceAdjustment) },
                    serviceType = line.serviceType?.toStoredServiceType() ?: defaultService,
                )
            },
        subtotal = grossSales,
        discounts =
            discounts.map { discount ->
                ReceiptDiscount(
                    type =
                        when (discount.type) {
                            "senior_citizen" -> DiscountType.SC
                            "pwd" -> DiscountType.PWD
                            else -> DiscountType.CUSTOM
                        },
                    customerName = discount.customerName,
                    customerId = discount.customerId,
                    itemName = discount.itemName ?: "Order",
                    amount = discount.amount,
                )
            },
        vatableSales = vatableSales,
        vatAmount = vatAmount,
        vatExemptSales = vatExemptSales,
        total = summary.netSales,
        paymentMethod =
            if (summary.paymentMethod == "cash") PaymentMethod.CASH else PaymentMethod.CARD_EWALLET,
        amountTendered = cashReceived,
        change = changeGiven ?: 0.0,
        cardPaymentType = cardType,
        cardReferenceNumber = cardReference,
        payments =
            payments.map { payment ->
                ReceiptPayment(
                    paymentMethod =
                        if (payment.method == "cash") PaymentMethod.CASH
                        else PaymentMethod.CARD_EWALLET,
                    amount = payment.amount,
                    cashReceived = payment.cashReceived,
                    changeGiven = payment.changeGiven,
                    cardPaymentType = payment.cardType,
                    cardReferenceNumber = payment.cardReference,
                )
            },
        orderDefaultServiceType = defaultService,
        transactionDate =
            LocalDateTime.ofInstant(Instant.ofEpochMilli(paidAt ?: summary.createdAt), zone),
        receiptNumber = summary.orderNumber,
    )
}

/**
 * Kitchen ticket for the stored order, used by the paid detail preview. Like the source, that
 * preview writes no reprint audit.
 */
fun OrderDetail.toKitchenTicket(timestamp: LocalDateTime): KitchenTicketDocument =
    KitchenRequest(
            orderId = summary.id,
            orderNumber = summary.orderNumber,
            tableName = summary.tableName,
            pax = summary.pax,
            lines = items.filterNot { it.isVoided },
            orderCategory = orderCategory,
            tableMarker = tableMarker,
            customerName = summary.customerName,
            takeout = summary.orderType != "dine_in",
        )
        .toTicket(timestamp)

private fun String.toStoredServiceType(): ServiceType? =
    when (this) {
        "dine_in" -> ServiceType.DINE_IN
        "takeout" -> ServiceType.TAKEOUT
        else -> null
    }
