package com.pmgt.pos.orders

import com.pmgt.pos.checkout.CheckoutView
import com.pmgt.pos.printer.BillDocument
import com.pmgt.pos.printer.DiscountType
import com.pmgt.pos.printer.OrderCategory
import com.pmgt.pos.printer.OrderType
import com.pmgt.pos.printer.PrinterModifier
import com.pmgt.pos.printer.ReceiptDiscount
import com.pmgt.pos.printer.ReceiptItem
import com.pmgt.pos.printer.ServiceType
import java.time.LocalDateTime

/** Maps the latest local open-order view into a payment-free print snapshot. */
fun CheckoutView.toBill(cashierName: String, printedAt: LocalDateTime): BillDocument {
    val defaultService =
        when (cart.orderCategory) {
            "dine_in" -> ServiceType.DINE_IN
            "takeout" -> ServiceType.TAKEOUT
            else -> if (cart.orderType == "dine_in") ServiceType.DINE_IN else ServiceType.TAKEOUT
        }
    return BillDocument(
        storeName = store.name,
        storeAddress =
            listOfNotNull(store.address1, store.address2)
                .filter(String::isNotEmpty)
                .joinToString(", ")
                .takeIf(String::isNotEmpty),
        storeTin = store.tin,
        storeContactNumber = store.contactNumber,
        storeTelephone = store.telephone,
        storeEmail = store.email,
        storeWebsite = store.website,
        storeFooter = store.footer,
        orderNumber = cart.orderNumber,
        tableName = cart.tableName,
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
        customerName = cart.customerName,
        items =
            cart.lines.filterNot { it.isVoided }.map { line ->
                ReceiptItem(
                    name = line.productName,
                    quantity = line.quantity,
                    price = line.productPrice,
                    total = line.lineTotal,
                    modifiers =
                        line.modifiers.map {
                            PrinterModifier(it.optionName, it.priceAdjustment)
                        },
                    serviceType =
                        when (line.serviceType) {
                            "dine_in" -> ServiceType.DINE_IN
                            "takeout" -> ServiceType.TAKEOUT
                            else -> defaultService
                        },
                )
            },
        subtotal = cart.totals.grossSales,
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
        vatableSales = cart.totals.vatableSales,
        vatAmount = cart.totals.vatAmount,
        vatExemptSales = cart.totals.vatExemptSales,
        total = cart.totals.netSales,
        orderDefaultServiceType = defaultService,
        printedAt = printedAt,
    )
}
