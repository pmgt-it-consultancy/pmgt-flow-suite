package com.pmgt.pos.browse

import com.pmgt.pos.checkout.CompletedCheckout
import com.pmgt.pos.checkout.PaymentMath
import com.pmgt.pos.printer.DiscountType
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

/**
 * Maps the immutable completed checkout to the printable customer receipt, following the source
 * `createReceiptData`. The committed snapshot is the only input: nothing is re-read from the
 * database and no money value is recomputed, so a later edit cannot change a printed sale.
 */
fun CompletedCheckout.toReceipt(zone: ZoneId = ZoneId.systemDefault()): ReceiptDocument {
    val cart = view.cart
    val totals = cart.totals
    val takeout = route.orderType == "takeout"
    val defaultService =
        when (cart.orderCategory) {
            "dine_in" -> ServiceType.DINE_IN
            null -> if (cart.orderType == "dine_in") ServiceType.DINE_IN else ServiceType.TAKEOUT
            else -> ServiceType.TAKEOUT
        }
    val itemService = if (takeout) ServiceType.TAKEOUT else ServiceType.DINE_IN
    val primary = lines.firstOrNull()
    val card = primary?.takeIf { it.paymentMethod == "card_ewallet" }
    // Source sums the entered cash lines, not the capped payment records.
    val tendered =
        lines.filter { it.paymentMethod == "cash" }
            .sumOf { PaymentMath.number(it.cashReceived) }
    return ReceiptDocument(
        storeName = view.store.name,
        storeAddress =
            listOfNotNull(view.store.address1, view.store.address2)
                .filter { it.isNotEmpty() }
                .joinToString(", "),
        storeTin = view.store.tin,
        storeContactNumber = view.store.contactNumber,
        storeTelephone = view.store.telephone,
        storeEmail = view.store.email,
        storeWebsite = view.store.website,
        storeFooter = view.store.footer,
        orderNumber = cart.orderNumber,
        tableName = route.tableName,
        tableMarker = cart.tableMarker,
        orderCategory =
            when (cart.orderCategory) {
                "dine_in" -> OrderCategory.DINE_IN
                "takeout" -> OrderCategory.TAKEOUT
                else -> null
            },
        pax = cart.pax,
        orderType =
            when (cart.orderType) {
                "take_out" -> OrderType.TAKE_OUT
                "delivery" -> OrderType.DELIVERY
                else -> OrderType.DINE_IN
            },
        cashierName = cashierName,
        items =
            cart.lines.filterNot { it.isVoided }.map { line ->
                ReceiptItem(
                    name = line.productName,
                    quantity = line.quantity,
                    price = line.productPrice,
                    total = line.lineTotal,
                    modifiers =
                        line.modifiers.map { PrinterModifier(it.optionName, it.priceAdjustment) },
                    serviceType = line.serviceType?.toReceiptServiceType() ?: itemService,
                )
            },
        subtotal = totals.grossSales,
        discounts =
            view.discounts.map { discount ->
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
        vatableSales = totals.vatableSales,
        vatAmount = totals.vatAmount,
        vatExemptSales = totals.vatExemptSales,
        total = totals.netSales,
        paymentMethod =
            if (paymentMethod == "card_ewallet") PaymentMethod.CARD_EWALLET else PaymentMethod.CASH,
        amountTendered = tendered.takeIf { it > 0.0 },
        change = displayChange,
        cardPaymentType = card?.cardPaymentType?.takeIf { it.isNotEmpty() },
        cardReferenceNumber = card?.cardReferenceNumber?.takeIf { it.isNotEmpty() },
        payments =
            payments.map {
                ReceiptPayment(
                    paymentMethod =
                        if (it.paymentMethod == "card_ewallet") PaymentMethod.CARD_EWALLET
                        else PaymentMethod.CASH,
                    amount = it.amount,
                    cashReceived = it.cashReceived,
                    changeGiven = it.changeGiven,
                    cardPaymentType = it.cardPaymentType,
                    cardReferenceNumber = it.cardReferenceNumber,
                )
            },
        orderDefaultServiceType = defaultService,
        transactionDate = LocalDateTime.ofInstant(Instant.ofEpochMilli(transactionAt), zone),
        receiptNumber = cart.orderNumber,
    )
}

private fun String.toReceiptServiceType(): ServiceType? =
    when (this) {
        "dine_in" -> ServiceType.DINE_IN
        "takeout" -> ServiceType.TAKEOUT
        else -> null
    }
