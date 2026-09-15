package com.pmgt.pos.browse

import org.junit.Assert.assertEquals
import org.junit.Test

class BrowseFormattingTest {
    @Test
    fun nodeOracleCurrencyFormattingPreservesTableAndIntlDifferences() {
        // node Number.toFixed(2) / Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}),
        // 2026-09-16.
        val cases =
            listOf(
                Triple(1000.0, "₱1000.00", "₱1,000.00"),
                Triple(1.005, "₱1.00", "₱1.01"),
                Triple(-0.0, "₱0.00", "-₱0.00"),
                Triple(-1.005, "₱-1.00", "-₱1.01"),
                Triple(2.675, "₱2.67", "₱2.68"),
                Triple(0.125, "₱0.13", "₱0.13"),
            )
        cases.forEach { (number, table, intl) ->
            assertEquals("table $number", table, tableMoney(number))
            assertEquals("Intl $number", intl, money(number))
        }
    }
}
