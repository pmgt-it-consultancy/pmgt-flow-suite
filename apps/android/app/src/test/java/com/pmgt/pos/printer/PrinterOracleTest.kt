package com.pmgt.pos.printer

import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class PrinterOracleTest {
    private val fixture =
        Json.parseToJsonElement(javaClass.getResource("/printer-reference.json")!!.readText())
            .jsonObject
    private val zone = ZoneId.of(fixture.getValue("timezone").jsonPrimitive.content)

    @Test
    fun `formatters match ordered bridge calls from unchanged React Native oracle`() {
        for (case in fixture.getValue("cases").jsonArray.filter {
            it.jsonObject.getValue("kind").jsonPrimitive.content !in
                setOf("test_print_repair", "cash_drawer")
        }) {
            val row = case.jsonObject
            val width = row.getValue("width").jsonPrimitive.int
            val actual =
                when (row.getValue("kind").jsonPrimitive.content) {
                    "receipt" ->
                        ReceiptFormatter.format(
                            row.getValue("input").jsonObject.toReceipt(),
                            width,
                            row.getValue("minimal").jsonPrimitive.boolean,
                        )
                    "kitchen" ->
                        KitchenTicketFormatter.format(
                            row.getValue("input").jsonObject.toKitchenTicket(),
                            width,
                        )
                    else -> error("Unknown printer fixture kind")
                }
            val expected =
                row.getValue("calls").jsonArray.map { call -> call.jsonObject.toPrinterCall() }
            assertEquals(row.getValue("name").jsonPrimitive.content, expected, actual)
        }
    }

    @Test
    fun `test print preserves source calls then uses approved native feed and cut repair`() {
        val row =
            fixture.getValue("cases").jsonArray
                .map { it.jsonObject }
                .single { it.getValue("kind").jsonPrimitive.content == "test_print_repair" }
        val input = row.getValue("input").jsonObject
        val actual =
            TestPrintFormatter.format(
                printerName = input.text("printerName")!!,
                displayDateTime = input.text("displayDateTime")!!,
            )
        val expected = row.getValue("calls").jsonArray.map { it.jsonObject.toPrinterCall() }

        assertEquals(expected, actual)
        assertEquals(
            row.getValue("concatenatedHex").jsonPrimitive.content,
            EscPosEncoder.encode(actual).toHex(),
        )
    }

    @Test
    fun `encoder matches every native bridge write and concatenated document bytes`() {
        for (case in fixture.getValue("cases").jsonArray) {
            val row = case.jsonObject
            val calls = row.getValue("calls").jsonArray.map { it.jsonObject }
            val encodedCalls = calls.map { EscPosEncoder.encode(it.toPrinterCall()) }

            calls.zip(encodedCalls).forEachIndexed { index, (expectedCall, actualBytes) ->
                assertEquals(
                    "${row.getValue("name").jsonPrimitive.content} call $index",
                    expectedCall.getValue("hex").jsonPrimitive.content,
                    actualBytes.toHex(),
                )
            }
            assertEquals(
                row.getValue("name").jsonPrimitive.content,
                row.getValue("concatenatedHex").jsonPrimitive.content,
                EscPosEncoder.encode(calls.map { it.toPrinterCall() }).toHex(),
            )
        }
    }

    private fun JsonObject.toReceipt() =
        ReceiptDocument(
            storeName = text("storeName")!!,
            storeAddress = text("storeAddress"),
            storeTin = text("storeTin"),
            storeContactNumber = text("storeContactNumber"),
            storeTelephone = text("storeTelephone"),
            storeEmail = text("storeEmail"),
            storeWebsite = text("storeWebsite"),
            storeSocials =
                array("storeSocials").map {
                    val social = it.jsonObject
                    StoreSocial(social.text("platform")!!, social.text("url")!!)
                },
            storeFooter = text("storeFooter"),
            orderNumber = text("orderNumber")!!,
            tableName = text("tableName"),
            tableMarker = text("tableMarker"),
            orderCategory = text("orderCategory")?.toOrderCategory(),
            pax = number("pax"),
            orderType = text("orderType")!!.toOrderType(),
            cashierName = text("cashierName")!!,
            items =
                array("items").map {
                    val item = it.jsonObject
                    ReceiptItem(
                        name = item.text("name")!!,
                        quantity = item.number("quantity")!!,
                        price = item.number("price")!!,
                        total = item.number("total")!!,
                        modifiers = item.modifiers(),
                        serviceType = item.text("serviceType")?.toServiceType(),
                    )
                },
            subtotal = number("subtotal")!!,
            discounts =
                array("discounts").map {
                    val discount = it.jsonObject
                    ReceiptDiscount(
                        type = discount.text("type")!!.toDiscountType(),
                        customerName = discount.text("customerName")!!,
                        customerId = discount.text("customerId")!!,
                        itemName = discount.text("itemName")!!,
                        amount = discount.number("amount")!!,
                    )
                },
            vatableSales = number("vatableSales")!!,
            vatAmount = number("vatAmount")!!,
            vatExemptSales = number("vatExemptSales")!!,
            total = number("total")!!,
            paymentMethod = text("paymentMethod")!!.toPaymentMethod(),
            amountTendered = number("amountTendered"),
            change = number("change"),
            cardLastFour = text("cardLastFour"),
            cardPaymentType = text("cardPaymentType"),
            cardReferenceNumber = text("cardReferenceNumber"),
            payments =
                if (containsKey("payments"))
                    array("payments").map {
                        val payment = it.jsonObject
                        ReceiptPayment(
                            paymentMethod = payment.text("paymentMethod")!!.toPaymentMethod(),
                            amount = payment.number("amount")!!,
                            cashReceived = payment.number("cashReceived"),
                            changeGiven = payment.number("changeGiven"),
                            cardPaymentType = payment.text("cardPaymentType"),
                            cardReferenceNumber = payment.text("cardReferenceNumber"),
                        )
                    }
                else null,
            orderDefaultServiceType = text("orderDefaultServiceType")?.toServiceType(),
            transactionDate = localDateTime("transactionDate"),
            receiptNumber = text("receiptNumber"),
            customerName = text("customerName"),
            customerId = text("customerId"),
            customerAddress = text("customerAddress"),
            customerTin = text("customerTin"),
        )

    private fun JsonObject.toKitchenTicket() =
        KitchenTicketDocument(
            orderNumber = text("orderNumber")!!,
            orderType = text("orderType")!!.toOrderType(),
            orderCategory = text("orderCategory")?.toOrderCategory(),
            orderDefaultServiceType = text("orderDefaultServiceType")?.toServiceType(),
            tableMarker = text("tableMarker"),
            customerName = text("customerName"),
            items =
                array("items").map {
                    val item = it.jsonObject
                    KitchenTicketItem(
                        name = item.text("name")!!,
                        quantity = item.number("quantity")!!,
                        notes = item.text("notes"),
                        modifiers = item.modifiers(),
                        serviceType = item.text("serviceType")?.toServiceType(),
                    )
                },
            timestamp = localDateTime("timestamp"),
        )

    private fun JsonObject.toPrinterCall(): PrinterCall =
        when (text("operation")) {
            "align" -> PrinterCall.Align(PrinterAlignment.fromNative(getValue("align").jsonPrimitive.int))
            "printText" -> {
                val options = getValue("options").jsonObject
                PrinterCall.Text(
                    text = text("text")!!,
                    style =
                        PrinterTextStyle(
                            encoding = options.text("encoding") ?: "GBK",
                            codePage = options.number("codepage")?.toInt() ?: 0,
                            widthTimes = options.number("widthtimes")?.toInt() ?: 0,
                            heightTimes = options.number("heigthtimes")?.toInt() ?: 0,
                            fontType = options.number("fonttype")?.toInt() ?: 0,
                        ),
                    cut = options["cut"]?.jsonPrimitive?.boolean ?: false,
                )
            }
            "feedAndCut" -> PrinterCall.FeedAndCut
            "openDrawer" -> PrinterCall.OpenDrawer
            else -> error("Unknown printer call")
        }

    private fun JsonObject.modifiers(): List<PrinterModifier> =
        array("modifiers").map {
            val modifier = it.jsonObject
            PrinterModifier(
                optionName = modifier.text("optionName")!!,
                priceAdjustment = modifier.number("priceAdjustment")!!,
            )
        }

    private fun JsonObject.localDateTime(key: String) =
        Instant.parse(text(key)!!).atZone(zone).toLocalDateTime()

    private fun JsonObject.text(key: String): String? =
        get(key)?.jsonPrimitive?.takeUnless { it.isString.not() && it.content == "null" }?.content

    private fun JsonObject.number(key: String): Double? = get(key)?.jsonPrimitive?.double

    private fun JsonObject.array(key: String): JsonArray = get(key)?.jsonArray ?: JsonArray(emptyList())

    private fun String.toOrderCategory() =
        when (this) {
            "dine_in" -> OrderCategory.DINE_IN
            "takeout" -> OrderCategory.TAKEOUT
            else -> error("Unknown order category $this")
        }

    private fun String.toOrderType() =
        when (this) {
            "dine_in" -> OrderType.DINE_IN
            "take_out" -> OrderType.TAKE_OUT
            "delivery" -> OrderType.DELIVERY
            else -> error("Unknown order type $this")
        }

    private fun String.toServiceType() =
        when (this) {
            "dine_in" -> ServiceType.DINE_IN
            "takeout" -> ServiceType.TAKEOUT
            else -> error("Unknown service type $this")
        }

    private fun String.toDiscountType() =
        when (this) {
            "sc" -> DiscountType.SC
            "pwd" -> DiscountType.PWD
            "custom" -> DiscountType.CUSTOM
            else -> error("Unknown discount type $this")
        }

    private fun String.toPaymentMethod() =
        when (this) {
            "cash" -> PaymentMethod.CASH
            "card" -> PaymentMethod.CARD
            "card_ewallet" -> PaymentMethod.CARD_EWALLET
            else -> error("Unknown payment method $this")
        }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
