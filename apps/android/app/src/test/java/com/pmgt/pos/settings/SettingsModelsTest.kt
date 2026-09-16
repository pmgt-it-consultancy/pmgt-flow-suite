package com.pmgt.pos.settings

import com.pmgt.pos.printer.settings.PrinterConfig
import com.pmgt.pos.printer.settings.PrinterConnectionStatus
import com.pmgt.pos.printer.settings.PrinterPaperWidth
import com.pmgt.pos.printer.settings.PrinterRole
import com.pmgt.pos.printer.settings.PrinterSettingsState
import com.pmgt.pos.sync.SyncState
import com.pmgt.pos.sync.SyncStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsModelsTest {
    @Test
    fun `configured printer without observed connection remains checking`() {
        val printers =
            PrinterSettingsState(
                printers = listOf(printer("receipt", PrinterRole.RECEIPT)),
                isLoading = false,
            )

        val evidence = SystemStatusProjection.from(SyncState(), printers)

        assertEquals(SettingsConnectionStatus.CHECKING, evidence.server)
        assertEquals(SettingsConnectionStatus.CHECKING, evidence.receiptPrinter)
        assertEquals(SettingsOverallStatus.DEGRADED, evidence.overall)
    }

    @Test
    fun `kitchen fallback uses receipt evidence and offline remains critical`() {
        val printers =
            PrinterSettingsState(
                printers = listOf(printer("receipt", PrinterRole.RECEIPT)),
                connectionStatus = mapOf("receipt" to PrinterConnectionStatus.CONNECTED),
                kitchenPrintingEnabled = true,
                useReceiptPrinterForKitchen = true,
                isLoading = false,
            )

        val evidence =
            SystemStatusProjection.from(
                SyncState(status = SyncStatus.Offline, lastPulledAt = 90),
                printers,
            )

        assertEquals(SettingsConnectionStatus.CONNECTED, evidence.kitchenPrinter)
        assertEquals("Kitchen (via Receipt)", evidence.kitchenPrinterLabel)
        assertEquals(SettingsOverallStatus.CRITICAL, evidence.overall)
        assertEquals(90L, evidence.lastSuccessfulSyncAt)
    }

    @Test
    fun `device identity is redacted and auto lock inventory stays exact`() {
        assertEquals("12345678...cdef", redactedDeviceInfo("1234567890abcdef"))
        assertEquals("—", redactedDeviceInfo("short"))
        assertEquals(listOf(0, 1, 2, 5, 10, 15, 30), AutoLockChoices)
        assertEquals("5 minutes", autoLockLabel(null))
    }

    private fun printer(id: String, role: PrinterRole) =
        PrinterConfig(id, id, id, role, PrinterPaperWidth.MM80, isDefault = true)
}
