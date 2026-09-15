package com.pmgt.pos.money

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlinx.serialization.json.*

class MoneyFixtureTest {
    @Test fun `public money outputs match TypeScript bit for bit`() {
        val fixture = Json.parseToJsonElement(javaClass.getResource("/money-reference.json")!!.readText()).jsonObject
        for (case in fixture.getValue("cases").jsonArray) {
            val row = case.jsonObject
            val args = row.getValue("args").jsonArray
            fun number(i: Int) = args[i].jsonPrimitive.double
            fun flag(i: Int) = args[i].jsonPrimitive.boolean
            val result: Map<String, Double> = when (row.getValue("operation").jsonPrimitive.content) {
                "calculateVatBreakdown" -> Money.vatBreakdown(number(0), flag(1), number(2)).let { mapOf("vatExclusive" to it.vatExclusive, "vatAmount" to it.vatAmount) }
                "calculateScPwdDiscount" -> Money.scPwdDiscount(number(0), number(1)).let { mapOf("discountedPrice" to it.discountedPrice, "discountAmount" to it.discountAmount, "vatExemptAmount" to it.vatExemptAmount) }
                "calculateItemTotals" -> Money.itemTotals(number(0), number(1), flag(2), number(3), number(4)).let { item ->
                    mapOf("grossAmount" to item.grossAmount, "vatableAmount" to item.vatableAmount, "vatAmount" to item.vatAmount,
                        "vatExemptAmount" to item.vatExemptAmount, "nonVatAmount" to item.nonVatAmount, "discountAmount" to item.discountAmount, "netAmount" to item.netAmount)
                }
                "aggregateOrderTotals" -> Money.aggregate(args[0].jsonArray.map { raw ->
                    val item = raw.jsonObject
                    fun n(key: String) = item.getValue(key).jsonPrimitive.double
                    ItemTotals(n("grossAmount"), n("vatableAmount"), n("vatAmount"), n("vatExemptAmount"), n("nonVatAmount"), n("discountAmount"), n("netAmount"))
                }).let { t -> mapOf("grossSales" to t.grossSales, "vatableSales" to t.vatableSales, "vatAmount" to t.vatAmount,
                    "vatExemptSales" to t.vatExemptSales, "nonVatSales" to t.nonVatSales, "discountAmount" to t.discountAmount, "netSales" to t.netSales) }
                "calculateChange" -> mapOf("value" to Money.change(number(0), number(1)))
                else -> error("Unrecognized money fixture operation")
            }
            val expected = row.getValue("expected").let { if (it is JsonObject) it else buildJsonObject { put("value", it) } }
            for ((field, value) in result) assertEquals("${row["operation"]} ${row["args"]} $field", expected.getValue(field).jsonPrimitive.content, java.lang.Long.toHexString(value.toRawBits()).padStart(16, '0'))
        }
    }
    @Test fun `checkout retains VAT normalization and senior centavos`() {
        val item = Money.itemTotals(112.0, 2.0, true, 1.0, 12.0)
        assertEquals(ItemTotals(224.0, 100.0, 12.0, 100.0, 0.0, 20.0, 192.0), item)
        assertEquals(item, Money.itemTotals(112.0, 2.0, true, 1.0, 0.12))
    }
}
