package com.pmgt.pos.browse

import com.pmgt.pos.checkout.CheckoutDiscount
import com.pmgt.pos.checkout.CheckoutStore
import com.pmgt.pos.checkout.CheckoutView
import com.pmgt.pos.checkout.CompletedCheckout
import com.pmgt.pos.checkout.PaymentLine
import com.pmgt.pos.checkout.PaymentMath
import com.pmgt.pos.money.OrderTotals
import com.pmgt.pos.orders.CheckoutRoute
import com.pmgt.pos.orders.OrderCart
import com.pmgt.pos.printer.DiscountType
import com.pmgt.pos.printer.OrderCategory
import com.pmgt.pos.printer.OrderType
import com.pmgt.pos.printer.PaymentMethod
import com.pmgt.pos.printer.ServiceType
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReceiptMappingTest {
    private val zone = ZoneId.of("Asia/Manila")

    @Test
    fun `voided lines are excluded and items default to the checkout route`() {
        val receipt =
            completed(
                orderType = "takeout",
                lines =
                    listOf(
                        line("Adobo"),
                        line("Cancelled", isVoided = true),
                        line("Halo", serviceType = "dine_in"),
                    ),
            )
                .toReceipt(zone)

        assertEquals(listOf("Adobo", "Halo"), receipt.items.map { it.name })
        assertEquals(ServiceType.TAKEOUT, receipt.items[0].serviceType)
        assertEquals(ServiceType.DINE_IN, receipt.items[1].serviceType)
    }

    @Test
    fun `the default service type prefers order category and falls back to order type`() {
        assertEquals(
            ServiceType.TAKEOUT,
            completed(orderCategory = "takeout", cartOrderType = "dine_in")
                .toReceipt(zone)
                .orderDefaultServiceType,
        )
        assertEquals(
            ServiceType.DINE_IN,
            completed(orderCategory = null, cartOrderType = "dine_in")
                .toReceipt(zone)
                .orderDefaultServiceType,
        )
        assertEquals(
            ServiceType.TAKEOUT,
            completed(orderCategory = null, cartOrderType = "take_out")
                .toReceipt(zone)
                .orderDefaultServiceType,
        )
        assertEquals(
            OrderCategory.DINE_IN,
            completed(orderCategory = "dine_in").toReceipt(zone).orderCategory,
        )
        assertNull(completed(orderCategory = "delivery").toReceipt(zone).orderCategory)
    }

    @Test
    fun `discount types map to the source codes and a missing item name becomes Order`() {
        val receipt =
            completed(
                discounts =
                    listOf(
                        discount("senior_citizen", itemName = null),
                        discount("pwd", itemName = "Adobo"),
                        discount("promo", itemName = "Adobo"),
                    )
            )
                .toReceipt(zone)

        assertEquals(
            listOf(DiscountType.SC, DiscountType.PWD, DiscountType.CUSTOM),
            receipt.discounts.map { it.type },
        )
        assertEquals("Order", receipt.discounts.first().itemName)
    }

    @Test
    fun `a single card line carries its raw reference and reports no cash tendered`() {
        val card =
            PaymentLine(
                id = "1",
                paymentMethod = "card_ewallet",
                amount = "500",
                cardPaymentType = "Other",
                customPaymentType = "Store credit",
                cardReferenceNumber = "REF-9",
            )
        val receipt = completed(paymentLines = listOf(card)).toReceipt(zone)

        assertEquals(PaymentMethod.CARD_EWALLET, receipt.paymentMethod)
        // The Other-to-custom substitution belongs to the payment record, not the receipt header.
        assertEquals("Other", receipt.cardPaymentType)
        assertEquals("REF-9", receipt.cardReferenceNumber)
        assertNull(receipt.amountTendered)
    }

    @Test
    fun `cash tendered sums the entered lines and change is the committed value`() {
        val receipt =
            completed(
                paymentLines =
                    listOf(
                        PaymentLine(id = "1", paymentMethod = "cash", cashReceived = "300"),
                        PaymentLine(id = "2", paymentMethod = "cash", cashReceived = "250.50"),
                    ),
                displayChange = 50.5,
            )
                .toReceipt(zone)

        assertEquals(PaymentMethod.CASH, receipt.paymentMethod)
        assertEquals(550.5, receipt.amountTendered!!, 0.0)
        assertEquals(50.5, receipt.change!!, 0.0)
        assertNull(receipt.cardPaymentType)
    }

    @Test
    fun `totals and the transaction time come from the committed snapshot`() {
        val receipt = completed(transactionAt = 1_789_000_000_000).toReceipt(zone)

        assertEquals(1000.0, receipt.subtotal, 0.0)
        assertEquals(800.0, receipt.vatableSales, 0.0)
        assertEquals(96.0, receipt.vatAmount, 0.0)
        assertEquals(100.0, receipt.vatExemptSales, 0.0)
        assertEquals(900.0, receipt.total, 0.0)
        assertEquals(OrderType.DINE_IN, receipt.orderType)
        assertEquals("D-001", receipt.receiptNumber)
        assertEquals(
            LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(1_789_000_000_000), zone),
            receipt.transactionDate,
        )
    }

    @Test
    fun `store address joins the present lines only`() {
        assertEquals(
            "12 Main St, Unit 4",
            completed().toReceipt(zone).storeAddress,
        )
        assertEquals(
            "12 Main St",
            completed(address2 = null).toReceipt(zone).storeAddress,
        )
        assertEquals("", completed(address1 = null, address2 = null).toReceipt(zone).storeAddress)
    }

    private fun completed(
        orderType: String = "dine_in",
        cartOrderType: String = "dine_in",
        orderCategory: String? = null,
        address1: String? = "12 Main St",
        address2: String? = "Unit 4",
        lines: List<OrderLine> = listOf(line("Adobo")),
        discounts: List<CheckoutDiscount> = emptyList(),
        paymentLines: List<PaymentLine> = listOf(PaymentLine(cashReceived = "1000")),
        displayChange: Double = 100.0,
        transactionAt: Long = 1_789_000_000_000,
    ) =
        CompletedCheckout(
            view =
                CheckoutView(
                    cart =
                        OrderCart(
                            id = "order-1",
                            storeId = "store-1",
                            orderType = cartOrderType,
                            status = "paid",
                            orderNumber = "D-001",
                            tableId = "t1",
                            tableName = "Table 1",
                            customerName = "Ana",
                            orderCategory = orderCategory,
                            tableMarker = "7",
                            pax = 2.0,
                            tabNumber = null,
                            tabName = null,
                            lines = lines,
                            discounts = emptyList(),
                            totals =
                                OrderTotals(
                                    grossSales = 1000.0,
                                    vatableSales = 800.0,
                                    vatAmount = 96.0,
                                    vatExemptSales = 100.0,
                                    nonVatSales = 0.0,
                                    discountAmount = 100.0,
                                    netSales = 900.0,
                                ),
                            vatRate = 0.12,
                        ),
                    discounts = discounts,
                    store =
                        CheckoutStore(
                            name = "Test Store",
                            address1 = address1,
                            address2 = address2,
                            tin = "000-111",
                            contactNumber = "0917",
                            telephone = "8888",
                            email = "a@b.c",
                            website = "b.c",
                            footer = "Thank you",
                        ),
                ),
            route = CheckoutRoute(orderId = "order-1", orderType = orderType, tableName = "Table 1"),
            cashierName = "Cashier One",
            lines = paymentLines,
            payments = PaymentMath.build(paymentLines, 900.0),
            transactionAt = transactionAt,
            displayChange = displayChange,
        )

    private fun discount(type: String, itemName: String?) =
        CheckoutDiscount(
            id = type,
            itemId = null,
            type = type,
            customerName = "Ana",
            customerId = "ID-1",
            itemName = itemName,
            amount = 50.0,
            approvedBy = null,
        )

    private fun line(
        name: String,
        serviceType: String? = null,
        isVoided: Boolean = false,
    ) =
        OrderLine(
            id = name,
            productId = "p-$name",
            productName = name,
            productPrice = 100.0,
            quantity = 1.0,
            notes = null,
            isVoided = isVoided,
            isSentToKitchen = true,
            serviceType = serviceType,
            isVatable = true,
            modifiers = emptyList(),
        )
}
