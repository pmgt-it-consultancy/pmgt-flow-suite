package com.pmgt.pos.browse

import com.pmgt.pos.printer.OrderType
import com.pmgt.pos.printer.PaymentMethod
import com.pmgt.pos.printer.ServiceType
import com.pmgt.pos.telemetry.RecordingTelemetry
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ReceiptReprintTest {
    @get:Rule val telemetry = RecordingTelemetry()

    private val zone = ZoneId.of("Asia/Manila")

    @Test
    fun `only a reprint that reaches the printer is logged`() = runTest {
        val audit = FakeAudit(serverId = "srv-1")

        reprintReceipt(detail(), audit) { error("printer offline") }
        assertTrue(telemetry.events.isEmpty())
        reprintReceipt(detail(), audit) {}

        assertEquals(listOf("receipt_reprinted"), telemetry.eventNames())
    }

    @Test
    fun `the audit is written before the receipt reaches the printer`() = runTest {
        val audit = FakeAudit(serverId = "srv-1")
        val calls = mutableListOf<String>()
        audit.onLog = { calls += "audit" }

        val result = reprintReceipt(detail(), audit) { calls += "print" }

        assertSame(ReprintResult.Printed, result)
        assertEquals(listOf("audit", "print"), calls)
        assertEquals(listOf("srv-1"), audit.logged)
    }

    @Test
    fun `an order without a verified server id never audits or prints`() = runTest {
        val audit = FakeAudit(serverId = null)
        var printed = false

        val result = reprintReceipt(detail(), audit) { printed = true }

        assertSame(ReprintResult.NotSynced, result)
        assertTrue(audit.logged.isEmpty())
        assertTrue(!printed)
    }

    @Test
    fun `a failed audit prevents the print entirely`() = runTest {
        val audit = FakeAudit(serverId = "srv-1")
        audit.onLog = { error("offline") }
        var printed = false

        val result = reprintReceipt(detail(), audit) { printed = true }

        assertSame(ReprintResult.AuditFailed, result)
        assertTrue(!printed)
    }

    @Test
    fun `a failed print retains the audit and a retry audits again`() = runTest {
        val audit = FakeAudit(serverId = "srv-1")

        val first = reprintReceipt(detail(), audit) { error("printer offline") }
        assertSame(ReprintResult.PrintFailed, first)
        assertEquals(listOf("srv-1"), audit.logged)

        val second = reprintReceipt(detail(), audit) {}
        assertSame(ReprintResult.Printed, second)
        assertEquals(listOf("srv-1", "srv-1"), audit.logged)
    }

    @Test
    fun `the stored receipt carries only store name address and TIN`() {
        val receipt = detail().toReceipt(zone)

        assertEquals("Test Store", receipt.storeName)
        assertEquals("12 Main St, Unit 4", receipt.storeAddress)
        assertEquals("000-111", receipt.storeTin)
        // The source's history receipt omits the checkout contacts, socials and footer.
        assertEquals(null, receipt.storeContactNumber)
        assertEquals(null, receipt.storeWebsite)
        assertEquals(emptyList<Any>(), receipt.storeSocials)
        assertEquals(null, receipt.storeFooter)
    }

    @Test
    fun `the default service type comes from order type alone and voided lines are dropped`() {
        val dineIn =
            detail(
                    orderType = "dine_in",
                    orderCategory = "takeout",
                    lines = listOf(line("Adobo"), line("Cancelled", isVoided = true)),
                )
                .toReceipt(zone)

        // Order category is carried for the header but never drives the service default here.
        assertEquals(ServiceType.DINE_IN, dineIn.orderDefaultServiceType)
        assertEquals(listOf("Adobo"), dineIn.items.map { it.name })
        assertEquals(ServiceType.DINE_IN, dineIn.items.single().serviceType)

        val takeout = detail(orderType = "take_out", orderCategory = "dine_in").toReceipt(zone)
        assertEquals(ServiceType.TAKEOUT, takeout.orderDefaultServiceType)
        assertEquals(OrderType.TAKE_OUT, takeout.orderType)
    }

    @Test
    fun `stored money payments and the paid time are reproduced without recomputation`() {
        val receipt = detail(paidAt = 1_789_000_000_000).toReceipt(zone)

        assertEquals(1000.0, receipt.subtotal, 0.0)
        assertEquals(900.0, receipt.total, 0.0)
        assertEquals(1000.0, receipt.amountTendered!!, 0.0)
        assertEquals(100.0, receipt.change!!, 0.0)
        assertEquals(PaymentMethod.CASH, receipt.paymentMethod)
        assertEquals(1, receipt.payments!!.size)
        assertEquals(
            LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(1_789_000_000_000), zone),
            receipt.transactionDate,
        )
    }

    @Test
    fun `an unpaid order falls back to its creation time`() {
        val receipt = detail(paidAt = null).toReceipt(zone)

        assertEquals(
            LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(1_700_000_000_000), zone),
            receipt.transactionDate,
        )
    }

    private fun detail(
        orderType: String = "dine_in",
        orderCategory: String? = null,
        lines: List<OrderLine> = listOf(line("Adobo")),
        paidAt: Long? = 1_789_000_000_000,
    ) =
        OrderDetail(
            summary =
                OrderSummary(
                    id = "order-1",
                    orderNumber = "D-001",
                    orderType = orderType,
                    status = "paid",
                    tableId = "t1",
                    tableName = "Table 1",
                    customerName = "Ana",
                    draftLabel = null,
                    netSales = 900.0,
                    itemCount = 1.0,
                    createdAt = 1_700_000_000_000,
                    paymentMethod = "cash",
                    pax = 2.0,
                ),
            storeId = "store-1",
            store = ReceiptStore("Test Store", "12 Main St", "Unit 4", "000-111", "MIN-1", "Thanks"),
            grossSales = 1000.0,
            vatableSales = 800.0,
            vatAmount = 96.0,
            vatExemptSales = 100.0,
            nonVatSales = 0.0,
            discountAmount = 100.0,
            createdBy = "u1",
            createdByName = "Cashier One",
            paidAt = paidAt,
            paidBy = "u1",
            cashReceived = 1000.0,
            changeGiven = 100.0,
            cardType = null,
            cardReference = null,
            orderCategory = orderCategory,
            tableMarker = "7",
            items = lines,
            discounts = emptyList(),
            payments =
                listOf(OrderPayment("p1", "cash", 900.0, 1000.0, 100.0, null, null)),
            voids = emptyList(),
        )

    private fun line(name: String, isVoided: Boolean = false) =
        OrderLine(
            id = name,
            productId = "p-$name",
            productName = name,
            productPrice = 100.0,
            quantity = 1.0,
            notes = null,
            isVoided = isVoided,
            isSentToKitchen = true,
            serviceType = null,
            isVatable = true,
            modifiers = emptyList(),
        )
}

private class FakeAudit(private val serverId: String?) : ReprintAudit {
    val logged = mutableListOf<String>()
    var onLog: () -> Unit = {}

    override suspend fun serverOrderId(orderId: String): String? = serverId

    override suspend fun logReceiptReprint(serverOrderId: String) {
        onLog()
        logged += serverOrderId
    }
}
