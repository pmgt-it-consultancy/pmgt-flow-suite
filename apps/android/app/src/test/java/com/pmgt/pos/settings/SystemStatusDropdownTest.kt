package com.pmgt.pos.settings

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test

class SystemStatusDropdownTest {
    private val now = 1_789_000_000_000L

    @Test
    fun `an absent sync reads Never and is flagged stale`() {
        assertEquals("Never" to true, formatLastSync(null, now))
    }

    @Test
    fun `recent syncs use the source thresholds without a warning`() {
        assertEquals("just now" to false, formatLastSync(now, now))
        assertEquals("just now" to false, formatLastSync(now - 9_999, now))
        assertEquals("10s ago" to false, formatLastSync(now - 10_000, now))
        assertEquals("59s ago" to false, formatLastSync(now - 59_999, now))
        assertEquals("1m ago" to false, formatLastSync(now - 60_000, now))
        assertEquals("4m ago" to false, formatLastSync(now - 299_999, now))
    }

    @Test
    fun `five minutes or older is collapsed and flagged stale`() {
        assertEquals("5+ min ago" to true, formatLastSync(now - 300_000, now))
        assertEquals("5+ min ago" to true, formatLastSync(now - 86_400_000, now))
    }

    @Test
    fun `header indicator colour follows the overall status like the source button`() {
        assertEquals(Color(0xFF22C55E), SettingsOverallStatus.OK.indicatorColor)
        assertEquals(Color(0xFFF59E0B), SettingsOverallStatus.DEGRADED.indicatorColor)
        assertEquals(Color(0xFFEF4444), SettingsOverallStatus.CRITICAL.indicatorColor)
    }
}
