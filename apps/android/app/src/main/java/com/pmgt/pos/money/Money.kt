package com.pmgt.pos.money

import kotlin.math.floor
import kotlin.math.max

data class ItemTotals(
    val grossAmount: Double,
    val vatableAmount: Double,
    val vatAmount: Double,
    val vatExemptAmount: Double,
    val nonVatAmount: Double,
    val discountAmount: Double,
    val netAmount: Double,
)

@kotlinx.serialization.Serializable
data class OrderTotals(
    val grossSales: Double = 0.0,
    val vatableSales: Double = 0.0,
    val vatAmount: Double = 0.0,
    val vatExemptSales: Double = 0.0,
    val nonVatSales: Double = 0.0,
    val discountAmount: Double = 0.0,
    val netSales: Double = 0.0,
)

data class VatBreakdown(val vatExclusive: Double, val vatAmount: Double)

data class ScPwdDiscount(
    val discountedPrice: Double,
    val discountAmount: Double,
    val vatExemptAmount: Double,
)

object Money {
    // ADR 0002: intentionally reproduce JavaScript binary64 + Number.EPSILON,
    // including ties toward +infinity. BigDecimal or Kotlin round() changes settled books.
    private const val EPSILON = 2.220446049250313e-16

    fun round(amount: Double): Double {
        val scaled = (amount + EPSILON) * 100.0
        if (!scaled.isFinite() || scaled == 0.0) return scaled / 100.0
        val lower = floor(scaled)
        val rounded = if (scaled - lower < 0.5) lower else lower + 1.0
        return (if (rounded == 0.0 && scaled < 0.0) -0.0 else rounded) / 100.0
    }

    fun normalizeVatRate(rate: Double): Double =
        if (rate <= 0.0) 0.0 else if (rate > 1.0) rate / 100.0 else rate

    fun vatBreakdown(price: Double, isVatable: Boolean, vatRate: Double = 0.12): VatBreakdown {
        val rate = normalizeVatRate(vatRate)
        if (!isVatable || rate == 0.0) return VatBreakdown(price, 0.0)
        val exclusive = round(price / (1.0 + rate))
        return VatBreakdown(exclusive, round(price - exclusive))
    }

    fun scPwdDiscount(price: Double, vatRate: Double = 0.12): ScPwdDiscount {
        val rate = normalizeVatRate(vatRate)
        if (rate == 0.0) {
            val discount = round(price * 0.2)
            return ScPwdDiscount(round(price - discount), discount, 0.0)
        }
        val exclusive = round(price / (1.0 + rate))
        val discount = round(exclusive * 0.2)
        return ScPwdDiscount(round(exclusive - discount), discount, exclusive)
    }

    fun itemTotals(
        unitPrice: Double,
        quantity: Double,
        isVatable: Boolean,
        scPwdQuantity: Double = 0.0,
        vatRate: Double = 0.12,
    ): ItemTotals {
        val rate = normalizeVatRate(vatRate)
        val gross = round(unitPrice * quantity)
        val regularGross = round(unitPrice * (quantity - scPwdQuantity))
        val vatable = isVatable && rate > 0.0
        val regular =
            if (vatable) vatBreakdown(regularGross, true, rate) else VatBreakdown(regularGross, 0.0)
        var discount = 0.0
        var exempt = 0.0
        var discountedNet = 0.0
        if (scPwdQuantity > 0.0) {
            val scPwd = scPwdDiscount(unitPrice, if (isVatable) rate else 0.0)
            discount = round(scPwd.discountAmount * scPwdQuantity)
            exempt = round(scPwd.vatExemptAmount * scPwdQuantity)
            discountedNet = round(scPwd.discountedPrice * scPwdQuantity)
        }
        return ItemTotals(
            gross,
            if (vatable) regular.vatExclusive else 0.0,
            if (vatable) regular.vatAmount else 0.0,
            exempt,
            if (!vatable) regularGross else 0.0,
            discount,
            round(round(regularGross) + discountedNet),
        )
    }

    fun aggregate(items: List<ItemTotals>): OrderTotals =
        items.fold(OrderTotals()) { total, item ->
            OrderTotals(
                round(total.grossSales + item.grossAmount),
                round(total.vatableSales + item.vatableAmount),
                round(total.vatAmount + item.vatAmount),
                round(total.vatExemptSales + item.vatExemptAmount),
                round(total.nonVatSales + item.nonVatAmount),
                round(total.discountAmount + item.discountAmount),
                round(total.netSales + item.netAmount),
            )
        }

    fun checkout(items: List<ItemTotals>, globalDiscount: Double = 0.0): OrderTotals {
        val totals = aggregate(items)
        return if (globalDiscount > 0.0)
            totals.copy(
                discountAmount = totals.discountAmount + globalDiscount,
                netSales = max(0.0, totals.netSales - globalDiscount),
            )
        else totals
    }

    /** RN recalculateOrderTotals: all global sums, no clamp or final rounding. */
    fun persisted(items: List<ItemTotals>, globalDiscount: Double = 0.0): OrderTotals {
        val totals = aggregate(items)
        return totals.copy(
            discountAmount = totals.discountAmount + globalDiscount,
            netSales = totals.netSales - globalDiscount,
        )
    }

    fun change(netSales: Double, received: Double): Double = round(received - netSales)
}
