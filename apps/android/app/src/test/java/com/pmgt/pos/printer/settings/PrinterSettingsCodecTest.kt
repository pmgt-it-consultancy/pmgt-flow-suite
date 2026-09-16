package com.pmgt.pos.printer.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PrinterSettingsCodecTest {
    @Test
    fun `missing optional fields preserve source defaults`() {
        val settings = PrinterSettingsCodec.decode("""{"printers":[]}""")

        assertEquals(emptyList<PrinterConfig>(), settings.printers)
        assertFalse(settings.kitchenPrintingEnabled)
        assertFalse(settings.cashDrawerEnabled)
        assertFalse(settings.useReceiptPrinterForKitchen)
        assertFalse(settings.minimalReceiptEnabled)
    }

    @Test
    fun `current payload round trips order defaults widths and all flags`() {
        val expected =
            PrinterSettings(
                printers =
                    listOf(
                        PrinterConfig("B", "Second", "Raw B", PrinterRole.KITCHEN, PrinterPaperWidth.MM58, false),
                        PrinterConfig("A", "First", "Raw A", PrinterRole.RECEIPT, PrinterPaperWidth.MM80, true),
                    ),
                kitchenPrintingEnabled = true,
                cashDrawerEnabled = true,
                useReceiptPrinterForKitchen = true,
                minimalReceiptEnabled = true,
            )

        val decoded = PrinterSettingsCodec.decode(PrinterSettingsCodec.encode(expected))

        assertEquals(expected, decoded)
        assertTrue(PrinterSettingsCodec.encode(expected).indexOf("\"B\"") < PrinterSettingsCodec.encode(expected).indexOf("\"A\""))
    }

    @Test
    fun `malformed or unsupported retained payload fails closed`() {
        assertThrows(Exception::class.java) { PrinterSettingsCodec.decode("not-json") }
        assertThrows(Exception::class.java) {
            PrinterSettingsCodec.decode(
                """{"printers":[{"id":"A","name":"A","deviceName":"A","role":"receipt","paperWidth":76,"isDefault":true}]}"""
            )
        }
    }
}
