package com.pmgt.pos.printer

/** Source-matched four text writes followed by the approved feed-and-cut bridge repair. */
object TestPrintFormatter {
    fun format(printerName: String, displayDateTime: String): List<PrinterCall> =
        listOf(
            PrinterCall.Align(PrinterAlignment.CENTER),
            PrinterCall.Text(
                "=== TEST PRINT ===\n",
                PrinterTextStyle(heightTimes = 1),
            ),
            PrinterCall.Text("$printerName\n"),
            PrinterCall.Text("$displayDateTime\n"),
            PrinterCall.Text("Printer is working correctly\n\n\n\n"),
            PrinterCall.FeedAndCut,
        )
}
