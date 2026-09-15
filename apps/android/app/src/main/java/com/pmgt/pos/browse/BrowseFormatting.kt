package com.pmgt.pos.browse

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs

/** Display only. Intl formats the shortest decimal with half-expand; it preserves negative zero. */
internal fun money(value: Double): String {
    val formatter = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("en-PH"))
    formatter.roundingMode = RoundingMode.HALF_UP
    return if (value == 0.0) formatter.format(value)
    else formatter.format(BigDecimal.valueOf(value))
}

/** JS toFixed rounds the exact binary64 value, unlike Intl and Java Formatter. */
internal fun tableMoney(value: Double): String {
    val fixed = BigDecimal(abs(value)).setScale(2, RoundingMode.HALF_UP).toPlainString()
    return "₱" + (if (value < 0.0) "-" else "") + fixed
}
