package com.pmgt.pos.printer.platform

enum class PrinterBluetoothPermission {
    Scan,
    Connect,
    FineLocation,
}

/** Preserves the invoked RN all-grants request instead of silently narrowing Android 12+. */
object PrinterBluetoothPermissionPolicy {
    fun requiredForPrinterAccess(apiLevel: Int): List<PrinterBluetoothPermission> =
        if (apiLevel >= 31) {
            listOf(
                PrinterBluetoothPermission.Scan,
                PrinterBluetoothPermission.Connect,
                PrinterBluetoothPermission.FineLocation,
            )
        } else {
            listOf(PrinterBluetoothPermission.FineLocation)
        }
}
