package com.pmgt.pos.closing

import com.pmgt.pos.printer.*
import java.time.LocalDateTime
import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Test

class ZReportOracleTest {
    private val fixture =
        Json.parseToJsonElement(javaClass.getResource("/z-report-reference.json")!!.readText()).jsonObject

    @Test
    fun `formatter matches ordered calls from unchanged React Native Z report oracle`() {
        for (case in fixture.getValue("cases").jsonArray) {
            val row = case.jsonObject
            val expected = row.getValue("calls").jsonArray.map { it.jsonObject.toCall() }
            val actual = ZReportFormatter.format(row.toDocument(), row.getValue("width").jsonPrimitive.int)
            assertEquals(row.getValue("name").jsonPrimitive.content, expected, actual)
        }
    }

    @Test
    fun `Z report calls encode to the exact native oracle bytes`() {
        for (case in fixture.getValue("cases").jsonArray) {
            val row = case.jsonObject
            val calls = ZReportFormatter.format(row.toDocument(), row.getValue("width").jsonPrimitive.int)
            row.getValue("calls").jsonArray.zip(calls).forEachIndexed { index, (expected, call) ->
                assertEquals(
                    "${row.getValue("name").jsonPrimitive.content} call $index",
                    expected.jsonObject.getValue("hex").jsonPrimitive.content,
                    EscPosEncoder.encode(call).toHex(),
                )
            }
            assertEquals(
                row.getValue("name").jsonPrimitive.content,
                row.getValue("concatenatedHex").jsonPrimitive.content,
                EscPosEncoder.encode(calls).toHex(),
            )
        }
    }

    private fun JsonObject.toDocument(): ZReportDocument {
        val input = getValue("input").jsonObject
        val report = input.getValue("report").jsonObject
        return ZReportDocument(
            storeName = input.text("storeName")!!,
            storeAddress = input.text("storeAddress"),
            storeTin = input.text("storeTin"),
            report = report.toReport(),
            productSales = input.array("productSales").map { it.jsonObject.toProduct() },
            paymentTransactions = input.array("paymentTransactions").map { it.jsonObject.toPaymentGroup() },
            printedAt = LocalDateTime.parse(input.text("printedAt")),
        )
    }

    private fun JsonObject.toReport() =
        DailyClosingReport(
            id = "fixture",
            reportDate = text("reportDate")!!,
            startTime = text("startTime"),
            endTime = text("endTime"),
            grossSales = number("grossSales"), netSales = number("netSales"),
            vatableSales = number("vatableSales"), vatAmount = number("vatAmount"),
            vatExemptSales = number("vatExemptSales"), nonVatSales = number("nonVatSales"),
            seniorDiscounts = number("seniorDiscounts"), pwdDiscounts = number("pwdDiscounts"),
            promoDiscounts = number("promoDiscounts"), manualDiscounts = number("manualDiscounts"),
            totalDiscounts = number("totalDiscounts"), voidCount = number("voidCount").toInt(),
            voidAmount = number("voidAmount"), cashTotal = number("cashTotal"),
            cardEwalletTotal = number("cardEwalletTotal"), transactionCount = number("transactionCount").toInt(),
            averageTicket = number("averageTicket"), generatedAt = 0,
            generatedByName = text("generatedByName")!!, isPrinted = false, printedAt = null,
        )

    private fun JsonObject.toProduct() =
        ProductSale(
            productId = text("productId") ?: text("productName")!!,
            productName = text("productName")!!,
            categoryId = text("categoryId") ?: text("categoryName")!!,
            categoryName = text("categoryName")!!,
            parentCategoryName = text("parentCategoryName") ?: "",
            quantitySold = number("quantitySold"), grossAmount = number("grossAmount"),
            voidedQuantity = numberOrNull("voidedQuantity") ?: 0.0,
            voidedAmount = numberOrNull("voidedAmount") ?: 0.0,
        )

    private fun JsonObject.toPaymentGroup() =
        PaymentTransactionGroup(
            paymentType = text("paymentType")!!,
            transactions = array("transactions").map {
                val tx = it.jsonObject
                PaymentTransaction(
                    orderId = tx.text("orderId") ?: tx.text("orderNumber")!!,
                    orderNumber = tx.text("orderNumber")!!,
                    referenceNumber = tx.text("referenceNumber")!!,
                    amount = tx.number("amount"), paidAt = 0,
                )
            },
            subtotal = number("subtotal"),
        )

    private fun JsonObject.toCall(): PrinterCall =
        when (text("operation")) {
            "align" -> PrinterCall.Align(PrinterAlignment.fromNative(getValue("align").jsonPrimitive.int))
            "printText" -> {
                val options = getValue("options").jsonObject
                PrinterCall.Text(
                    text = text("text")!!,
                    style = PrinterTextStyle(
                        encoding = options.text("encoding") ?: "GBK",
                        codePage = options.numberOrNull("codepage")?.toInt() ?: 0,
                        widthTimes = options.numberOrNull("widthtimes")?.toInt() ?: 0,
                        heightTimes = options.numberOrNull("heigthtimes")?.toInt() ?: 0,
                        fontType = options.numberOrNull("fonttype")?.toInt() ?: 0,
                    ),
                    cut = options["cut"]?.jsonPrimitive?.boolean ?: false,
                )
            }
            else -> error("Unknown call")
        }

    private fun JsonObject.text(key: String): String? = get(key)?.let { if (it is JsonNull) null else it.jsonPrimitive.content }
    private fun JsonObject.number(key: String) = getValue(key).jsonPrimitive.double
    private fun JsonObject.numberOrNull(key: String) = get(key)?.jsonPrimitive?.doubleOrNull
    private fun JsonObject.array(key: String) = get(key)?.jsonArray ?: JsonArray(emptyList())
    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
