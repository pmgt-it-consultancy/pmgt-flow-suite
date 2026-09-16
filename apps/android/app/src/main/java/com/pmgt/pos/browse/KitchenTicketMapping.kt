package com.pmgt.pos.browse

import com.pmgt.pos.checkout.CompletedCheckout
import com.pmgt.pos.orders.KitchenRequest
import com.pmgt.pos.printer.KitchenTicketDocument
import com.pmgt.pos.printer.KitchenTicketItem
import com.pmgt.pos.printer.OrderCategory
import com.pmgt.pos.printer.OrderType
import com.pmgt.pos.printer.PrinterModifier
import com.pmgt.pos.printer.ServiceType
import java.time.LocalDateTime

/**
 * Maps the editor's captured kitchen request to the printable ticket. The source builds a
 * different header per route: dine-in fixes `dine_in`/`dine_in` and prints the table name as the
 * marker, takeout fixes `take_out`/`takeout` and prints the stored tent-card marker. The item
 * service default follows the same route, never `orderCategory`.
 */
fun KitchenRequest.toTicket(timestamp: LocalDateTime): KitchenTicketDocument {
    val defaultService = if (takeout) ServiceType.TAKEOUT else ServiceType.DINE_IN
    return KitchenTicketDocument(
        orderNumber = orderNumber,
        orderType = if (takeout) OrderType.TAKE_OUT else OrderType.DINE_IN,
        orderCategory = orderCategory?.toPrinterOrderCategory(),
        orderDefaultServiceType = defaultService,
        tableMarker = tableMarker,
        customerName = customerName,
        items =
            lines.map { line ->
                KitchenTicketItem(
                    name = line.productName,
                    quantity = line.quantity,
                    notes = line.notes,
                    modifiers =
                        line.modifiers.map {
                            PrinterModifier(it.optionName, it.priceAdjustment)
                        },
                    serviceType = line.serviceType?.toPrinterServiceType() ?: defaultService,
                )
            },
        timestamp = timestamp,
    )
}

/**
 * The source checkout builds the preview's kitchen ticket from every active item, using the
 * checkout route rather than the order category for the header and item defaults.
 */
fun CompletedCheckout.toKitchenTicket(timestamp: LocalDateTime): KitchenTicketDocument =
    KitchenRequest(
            orderId = view.cart.id,
            orderNumber = view.cart.orderNumber,
            tableName = route.tableName,
            pax = view.cart.pax,
            lines = view.cart.lines.filterNot { it.isVoided },
            orderCategory = view.cart.orderCategory,
            tableMarker = view.cart.tableMarker,
            customerName = view.cart.customerName,
            takeout = route.orderType == "takeout",
        )
        .toTicket(timestamp)

private fun String.toPrinterOrderCategory(): OrderCategory? =
    when (this) {
        "dine_in" -> OrderCategory.DINE_IN
        "takeout" -> OrderCategory.TAKEOUT
        else -> null
    }

private fun String.toPrinterServiceType(): ServiceType? =
    when (this) {
        "dine_in" -> ServiceType.DINE_IN
        "takeout" -> ServiceType.TAKEOUT
        else -> null
    }
