package com.pmgt.pos.browse

import com.pmgt.pos.orders.KitchenRequest
import com.pmgt.pos.printer.OrderCategory
import com.pmgt.pos.printer.OrderType
import com.pmgt.pos.printer.PrinterModifier
import com.pmgt.pos.printer.ServiceType
import java.time.LocalDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KitchenTicketMappingTest {
    private val printedAt = LocalDateTime.of(2026, 9, 16, 16, 4, 15)

    @Test
    fun `dine-in tickets fix the source header and default each item to dine in`() {
        val ticket =
            request(
                takeout = false,
                tableMarker = "Table 4",
                orderCategory = "dine_in",
                lines = listOf(line("Adobo", serviceType = null), line("Halo", "takeout")),
            )
                .toTicket(printedAt)

        assertEquals(OrderType.DINE_IN, ticket.orderType)
        assertEquals(ServiceType.DINE_IN, ticket.orderDefaultServiceType)
        assertEquals(OrderCategory.DINE_IN, ticket.orderCategory)
        assertEquals("Table 4", ticket.tableMarker)
        assertEquals("Ana", ticket.customerName)
        // An item without its own service type falls back to the route, not to orderCategory.
        assertEquals(ServiceType.DINE_IN, ticket.items[0].serviceType)
        assertEquals(ServiceType.TAKEOUT, ticket.items[1].serviceType)
        assertEquals(printedAt, ticket.timestamp)
    }

    @Test
    fun `takeout tickets fix the take out header and default each item to takeout`() {
        val ticket =
            request(
                takeout = true,
                tableMarker = "12",
                orderCategory = "takeout",
                lines = listOf(line("Adobo", serviceType = null)),
            )
                .toTicket(printedAt)

        assertEquals(OrderType.TAKE_OUT, ticket.orderType)
        assertEquals(ServiceType.TAKEOUT, ticket.orderDefaultServiceType)
        assertEquals(OrderCategory.TAKEOUT, ticket.orderCategory)
        assertEquals("12", ticket.tableMarker)
        assertEquals(ServiceType.TAKEOUT, ticket.items.single().serviceType)
    }

    @Test
    fun `line names quantities notes and modifier prices carry over unchanged`() {
        val ticket =
            request(
                takeout = false,
                lines =
                    listOf(
                        line("Sisig", quantity = 2.5, notes = "extra chili")
                            .copy(
                                modifiers =
                                    listOf(
                                        ItemModifier("Add-ons", "Extra rice", 15.0),
                                        ItemModifier("Add-ons", "No onion", -0.5),
                                    )
                            )
                    ),
            )
                .toTicket(printedAt)

        val item = ticket.items.single()
        assertEquals("Sisig", item.name)
        assertEquals(2.5, item.quantity, 0.0)
        assertEquals("extra chili", item.notes)
        assertEquals(
            listOf(PrinterModifier("Extra rice", 15.0), PrinterModifier("No onion", -0.5)),
            item.modifiers,
        )
    }

    @Test
    fun `an unknown order category is dropped rather than guessed`() {
        assertNull(request(takeout = false, orderCategory = "delivery").toTicket(printedAt).orderCategory)
        assertNull(request(takeout = false, orderCategory = null).toTicket(printedAt).orderCategory)
    }

    private fun request(
        takeout: Boolean,
        tableMarker: String? = "Table 1",
        orderCategory: String? = null,
        lines: List<OrderLine> = listOf(line("Adobo")),
    ) =
        KitchenRequest(
            orderId = "order-1",
            orderNumber = "D-001",
            tableName = "Table 1",
            pax = 2.0,
            lines = lines,
            orderCategory = orderCategory,
            tableMarker = tableMarker,
            customerName = "Ana",
            takeout = takeout,
        )

    private fun line(
        name: String,
        serviceType: String? = null,
        quantity: Double = 1.0,
        notes: String? = null,
    ) =
        OrderLine(
            id = name,
            productId = "p-$name",
            productName = name,
            productPrice = 100.0,
            quantity = quantity,
            notes = notes,
            isVoided = false,
            isSentToKitchen = true,
            serviceType = serviceType,
            isVatable = true,
            modifiers = emptyList(),
        )
}
