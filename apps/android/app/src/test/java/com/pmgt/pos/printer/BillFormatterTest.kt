package com.pmgt.pos.printer

import java.time.LocalDateTime
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BillFormatterTest {
    @Test
    fun `bill prints order totals without receipt or payment fields`() {
        val document =
            BillDocument(
                storeName = "PMGT Grill",
                storeAddress = "12 Main St, Manila",
                storeTin = "123-456-789",
                storeContactNumber = "09171234567",
                storeFooter = "Please pay at the counter",
                orderNumber = "T-0042",
                tableName = "Takeout",
                tableMarker = "15",
                orderCategory = OrderCategory.TAKEOUT,
                pax = 2.0,
                orderType = OrderType.TAKE_OUT,
                cashierName = "Ana",
                items =
                    listOf(
                        ReceiptItem(
                            name = "Pampano Ihaw",
                            quantity = 1.0,
                            price = 350.0,
                            total = 375.0,
                            modifiers = listOf(PrinterModifier("Extra rice", 25.0)),
                            serviceType = ServiceType.TAKEOUT,
                        )
                    ),
                subtotal = 375.0,
                discounts =
                    listOf(
                        ReceiptDiscount(
                            type = DiscountType.CUSTOM,
                            customerName = "Ana",
                            customerId = "PROMO",
                            itemName = "Order",
                            amount = 25.0,
                        )
                    ),
                vatableSales = 312.5,
                vatAmount = 37.5,
                vatExemptSales = 0.0,
                nonVatSales = 0.0,
                total = 350.0,
                orderDefaultServiceType = ServiceType.TAKEOUT,
                printedAt = LocalDateTime.of(2026, 9, 16, 10, 12, 0),
            )

        val calls = BillFormatter.format(document, charsPerLine = 48)
        val output =
            calls.filterIsInstance<PrinterCall.Text>().joinToString(separator = "") { it.text }

        assertTrue(output.contains("PMGT Grill"))
        assertTrue(output.contains("BILL"))
        assertTrue(output.contains("Order #: T-0042"))
        assertTrue(output.contains("Pampano Ihaw"))
        assertTrue(output.contains("Extra rice"))
        assertTrue(output.contains("VAT 12%"))
        assertTrue(output.contains("Non-VAT Sales"))
        assertTrue(output.contains("TOTAL"))
        assertTrue(output.contains("P 350.00"))
        assertFalse(output.contains("Receipt #:"))
        assertFalse(output.contains("Payment Method"))
        assertFalse(output.contains("Amount Tendered"))
        assertFalse(output.contains("Change"))
        assertFalse(output.contains("Card"))
        assertFalse(output.contains("Ref #"))
        assertTrue((calls.last() as PrinterCall.Text).cut)
    }
}
