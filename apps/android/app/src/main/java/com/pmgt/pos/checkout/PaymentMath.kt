package com.pmgt.pos.checkout

import kotlinx.serialization.Serializable

@Serializable
data class PaymentLine(
    val id: String = "1",
    val paymentMethod: String = "cash",
    val amount: String = "",
    val cashReceived: String = "",
    val cardPaymentType: String = "",
    val cardReferenceNumber: String = "",
    val customPaymentType: String = "",
)

@Serializable
data class BuiltPayment(
    val paymentMethod: String,
    val amount: Double,
    val cashReceived: Double? = null,
    val changeGiven: Double? = null,
    val cardPaymentType: String? = null,
    val cardReferenceNumber: String? = null,
)

data class PaymentCoverage(
    val totalPayments: Double,
    val remaining: Double,
    val totalChange: Double,
) {
    val enabled
        get() = !(remaining > 0.005)

    val fullyCovered
        get() = remaining <= 0.0
}

object PaymentMath {
    internal fun validIdentities(lines: List<PaymentLine>) =
        lines.isNotEmpty() &&
            lines.all { it.id.isNotEmpty() && it.paymentMethod in setOf("cash", "card_ewallet") } &&
            lines.map { it.id }.distinct().size == lines.size

    val types = listOf("Credit/Debit Card", "GCash", "Maya", "Bank Transfer", "Other")

    /** parseFloat(text) || 0, including numeric prefixes and incomplete exponents. */
    fun number(text: String): Double =
        Regex("^[+-]?(?:Infinity|(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")
            .find(text.trimStart { it.isWhitespace() || it == '\uFEFF' })
            ?.value
            ?.toDoubleOrNull()
            ?.takeUnless { it.isNaN() || it == 0.0 } ?: 0.0

    fun build(lines: List<PaymentLine>, netSales: Double): List<BuiltPayment> {
        var cardRemaining = netSales
        val cardApplied = mutableMapOf<String, Double>()
        for (line in lines) if (line.paymentMethod == "card_ewallet") {
            val applied = minOf(number(line.amount), maxOf(0.0, cardRemaining))
            cardApplied[line.id] = applied
            cardRemaining -= applied
        }
        val totalCard = netSales - cardRemaining
        var cashRemaining = maxOf(0.0, netSales - totalCard)
        return lines.map { line ->
            if (line.paymentMethod == "cash") {
                val received = number(line.cashReceived)
                val amount = minOf(received, cashRemaining)
                cashRemaining -= amount
                BuiltPayment(
                    "cash",
                    amount,
                    received,
                    if (received > amount) received - amount else null,
                )
            } else
                BuiltPayment(
                    "card_ewallet",
                    cardApplied[line.id] ?: 0.0,
                    cardPaymentType =
                        (if (line.cardPaymentType == "Other") line.customPaymentType
                            else line.cardPaymentType)
                            .takeIf { it.isNotEmpty() },
                    cardReferenceNumber = line.cardReferenceNumber.takeIf { it.isNotEmpty() },
                )
        }
    }

    fun coverage(lines: List<PaymentLine>, netSales: Double): PaymentCoverage {
        val total =
            lines.fold(0.0) { sum, line ->
                sum + number(if (line.paymentMethod == "cash") line.cashReceived else line.amount)
            }
        val cash =
            lines
                .filter { it.paymentMethod == "cash" }
                .fold(0.0) { sum, line -> sum + number(line.cashReceived) }
        val card =
            lines
                .filter { it.paymentMethod == "card_ewallet" }
                .fold(0.0) { sum, line -> sum + number(line.amount) }
        return PaymentCoverage(
            total,
            maxOf(0.0, netSales - total),
            if (total < netSales) 0.0 else maxOf(0.0, cash - (netSales - card)),
        )
    }

    fun exact(line: PaymentLine, remaining: Double): String =
        prefill(remaining + number(line.cashReceived))

    fun prefill(value: Double): String =
        if (value > 0.0) {
            if (!value.isFinite()) "Infinity"
            else com.pmgt.pos.browse.tableMoney(value).removePrefix("₱").removeSuffix(".00")
        } else ""

    fun quick(line: PaymentLine, value: Double): String =
        com.pmgt.pos.orders.numberText(number(line.cashReceived) + value)

    fun validation(lines: List<PaymentLine>, netSales: Double): String? {
        for (line in lines) {
            if (line.paymentMethod == "cash" && number(line.cashReceived) <= 0)
                return "Please enter cash received amount"
            if (line.paymentMethod == "card_ewallet") {
                if (number(line.amount) <= 0)
                    return "Please enter the amount for card/e-wallet payment"
                if (line.cardPaymentType.isEmpty() || line.cardPaymentType == "Other")
                    return "Please select a payment type for card/e-wallet"
                if (line.cardReferenceNumber.trim().isEmpty())
                    return "Please enter a reference number for card/e-wallet"
            }
        }
        val remaining = coverage(lines, netSales).remaining
        return if (remaining > 0.005)
            "Payment is short by ${com.pmgt.pos.browse.money(remaining)}. Please add more payment."
        else null
    }
}
