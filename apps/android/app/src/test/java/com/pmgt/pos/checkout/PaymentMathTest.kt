package com.pmgt.pos.checkout

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class PaymentMathTest {
    @Test
    fun unchangedInlineRnAllocationCoverageAndExactText() {
        val reference =
            Json.parseToJsonElement(javaClass.getResource("/checkout-reference.json")!!.readText())
                .jsonObject
        for ((index, value) in reference.getValue("cases").jsonArray.withIndex()) {
            val case = value.jsonObject
            val lines = Json.decodeFromJsonElement<List<PaymentLine>>(case.getValue("lines"))
            val due = case.getValue("netSales").jsonPrimitive.double
            val expected = case.getValue("expected").jsonObject
            val actual = PaymentMath.build(lines, due)
            val want = expected.getValue("payments").jsonArray
            assertEquals("case $index rows", want.size, actual.size)
            fun bits(name: String, value: Double, expected: JsonElement) =
                assertEquals(
                    "case $index $name",
                    expected.jsonObject.getValue("bits").jsonPrimitive.content,
                    java.lang.Long.toHexString(value.toRawBits()).padStart(16, '0'),
                )
            actual.zip(want).forEach { (p, raw) ->
                val row = raw.jsonObject
                assertEquals(row.getValue("paymentMethod").jsonPrimitive.content, p.paymentMethod)
                bits("amount", p.amount, row.getValue("amount"))
                for ((key, number) in
                    listOf("cashReceived" to p.cashReceived, "changeGiven" to p.changeGiven)) if (
                    row[key] == null
                )
                    assertNull(number)
                else bits(key, number!!, row.getValue(key))
                assertEquals(row["cardPaymentType"]?.jsonPrimitive?.content, p.cardPaymentType)
                assertEquals(
                    row["cardReferenceNumber"]?.jsonPrimitive?.content,
                    p.cardReferenceNumber,
                )
            }
            val coverage = PaymentMath.coverage(lines, due)
            bits("totalPayments", coverage.totalPayments, expected.getValue("totalPayments"))
            bits("remaining", coverage.remaining, expected.getValue("remaining"))
            bits("totalChange", coverage.totalChange, expected.getValue("totalChange"))
            assertEquals(expected.getValue("enabled").jsonPrimitive.boolean, coverage.enabled)
            assertEquals(
                expected.getValue("fullyCovered").jsonPrimitive.boolean,
                coverage.fullyCovered,
            )
            assertEquals(
                expected.getValue("exact").jsonArray.map { it.jsonPrimitive.content },
                lines.map { PaymentMath.exact(it, coverage.remaining) },
            )
        }
    }
}
