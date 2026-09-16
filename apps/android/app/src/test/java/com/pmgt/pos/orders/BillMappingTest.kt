package com.pmgt.pos.orders

import com.pmgt.pos.browse.ItemModifier
import com.pmgt.pos.browse.OrderLine
import com.pmgt.pos.checkout.CheckoutDiscount
import com.pmgt.pos.checkout.CheckoutStore
import com.pmgt.pos.checkout.CheckoutView
import com.pmgt.pos.money.OrderTotals
import com.pmgt.pos.printer.DiscountType
import com.pmgt.pos.printer.OrderCategory
import com.pmgt.pos.printer.OrderType
import com.pmgt.pos.printer.ServiceType
import java.time.LocalDateTime
import org.junit.Assert.assertEquals
import org.junit.Test

class BillMappingTest {
    @Test
    fun `open checkout view maps to an immutable unpaid bill`() {
        val printedAt = LocalDateTime.of(2026, 9, 16, 10, 12, 0)
        val view = checkoutView()

        val bill = view.toBill(cashierName = "Cashier Ana", printedAt = printedAt)

        assertEquals("PMGT Grill", bill.storeName)
        assertEquals("12 Main St, Unit 4", bill.storeAddress)
        assertEquals("T-0042", bill.orderNumber)
        assertEquals("Takeout", bill.tableName)
        assertEquals("15", bill.tableMarker)
        assertEquals(OrderCategory.TAKEOUT, bill.orderCategory)
        assertEquals(OrderType.TAKE_OUT, bill.orderType)
        assertEquals(ServiceType.TAKEOUT, bill.orderDefaultServiceType)
        assertEquals("Cashier Ana", bill.cashierName)
        assertEquals(printedAt, bill.printedAt)
        assertEquals(1, bill.items.size)
        assertEquals("Pampano Ihaw", bill.items.single().name)
        assertEquals("Extra rice", bill.items.single().modifiers.single().optionName)
        assertEquals(1, bill.discounts.size)
        assertEquals(DiscountType.CUSTOM, bill.discounts.single().type)
        assertEquals(0.0, bill.nonVatSales, 0.0)
        assertEquals(350.0, bill.total, 0.0)
    }

    @Test
    fun `voided items are excluded and dine in service defaults are preserved`() {
        val source = checkoutView()
        val dineIn =
            source.copy(
                cart =
                    source.cart.copy(
                        orderType = "dine_in",
                        orderCategory = "dine_in",
                        lines = source.cart.lines + source.cart.lines.single().copy(id = "void", isVoided = true),
                    )
            )

        val bill = dineIn.toBill("Cashier Ana", LocalDateTime.of(2026, 9, 16, 10, 12))

        assertEquals(1, bill.items.size)
        assertEquals(OrderType.DINE_IN, bill.orderType)
        assertEquals(OrderCategory.DINE_IN, bill.orderCategory)
        assertEquals(ServiceType.DINE_IN, bill.orderDefaultServiceType)
    }

    private fun checkoutView(): CheckoutView {
        val line =
            OrderLine(
                id = "item-1",
                productId = "product-1",
                productName = "Pampano Ihaw",
                productPrice = 350.0,
                quantity = 1.0,
                notes = null,
                isVoided = false,
                isSentToKitchen = true,
                serviceType = "takeout",
                isVatable = true,
                modifiers = listOf(ItemModifier("Add-ons", "Extra rice", 25.0)),
            )
        val cart =
            OrderCart(
                id = "order-1",
                storeId = "store-1",
                orderType = "takeout",
                status = "draft",
                orderNumber = "T-0042",
                tableId = null,
                tableName = "Takeout",
                customerName = "Mia",
                orderCategory = "takeout",
                tableMarker = "15",
                pax = 1.0,
                tabNumber = null,
                tabName = null,
                lines = listOf(line),
                discounts = emptyList(),
                totals =
                    OrderTotals(
                        grossSales = 375.0,
                        vatableSales = 312.5,
                        vatAmount = 37.5,
                        vatExemptSales = 0.0,
                        nonVatSales = 0.0,
                        discountAmount = 25.0,
                        netSales = 350.0,
                    ),
                vatRate = 0.12,
            )
        return CheckoutView(
            cart = cart,
            discounts =
                listOf(
                    CheckoutDiscount(
                        id = "discount-1",
                        itemId = null,
                        type = "promo",
                        customerName = "Mia",
                        customerId = "PROMO",
                        itemName = "Order",
                        amount = 25.0,
                        approvedBy = null,
                    )
                ),
            store =
                CheckoutStore(
                    name = "PMGT Grill",
                    address1 = "12 Main St",
                    address2 = "Unit 4",
                    tin = "123-456-789",
                    contactNumber = "09171234567",
                    telephone = null,
                    email = "hello@example.com",
                    website = "example.com",
                    footer = "Please pay at the counter",
                ),
        )
    }
}
