package com.pmgt.pos.printer.settings

import com.pmgt.pos.printer.PrinterCall
import kotlinx.coroutines.flow.StateFlow

enum class PrinterRole(val storedValue: String) { RECEIPT("receipt"), KITCHEN("kitchen") }

enum class PrinterPaperWidth(val millimeters: Int, val charsPerLine: Int) {
    MM58(58, 32),
    MM80(80, 48),
}

data class PrinterConfig(
    val id: String,
    val name: String,
    val deviceName: String,
    val role: PrinterRole,
    val paperWidth: PrinterPaperWidth,
    val isDefault: Boolean,
)

data class PrinterSettings(
    val printers: List<PrinterConfig> = emptyList(),
    val kitchenPrintingEnabled: Boolean = false,
    val cashDrawerEnabled: Boolean = false,
    val useReceiptPrinterForKitchen: Boolean = false,
    val minimalReceiptEnabled: Boolean = false,
)

data class PrinterDevice(val name: String, val address: String)

enum class PrinterConnectionStatus { CONNECTED, DISCONNECTED, RECONNECTING, FAILED }

enum class PrinterAddStage { SAVING, CONNECTING, SUCCESS, SAVED_CONNECTION_FAILED, NOT_SAVED }

data class PrinterAddFeedback(
    val device: PrinterDevice,
    val role: PrinterRole,
    val paperWidth: PrinterPaperWidth,
    val stage: PrinterAddStage,
)

data class PrinterSettingsState(
    val printers: List<PrinterConfig> = emptyList(),
    val connectionStatus: Map<String, PrinterConnectionStatus> = emptyMap(),
    val reconnectAttempts: Map<String, Int> = emptyMap(),
    val discoveredDevices: List<PrinterDevice> = emptyList(),
    val isScanning: Boolean = false,
    val kitchenPrintingEnabled: Boolean = false,
    val cashDrawerEnabled: Boolean = false,
    val useReceiptPrinterForKitchen: Boolean = false,
    val minimalReceiptEnabled: Boolean = false,
    val isInitialized: Boolean = false,
    val isLoading: Boolean = true,
    val storageError: String? = null,
    val addFeedback: PrinterAddFeedback? = null,
) {
    /** Exact Zustand selection rule: first persisted default for the requested role wins. */
    val receiptPrinter: PrinterConfig?
        get() = printers.firstOrNull { it.role == PrinterRole.RECEIPT && it.isDefault }

    /** Kitchen default, or the default receipt target only when the explicit fallback is enabled. */
    val kitchenPrinter: PrinterConfig?
        get() =
            printers.firstOrNull { it.role == PrinterRole.KITCHEN && it.isDefault }
                ?: receiptPrinter?.takeIf {
                    kitchenPrintingEnabled && useReceiptPrinterForKitchen
                }

    /**
     * Receipt-preview target. The source's preview deliberately ignores `kitchenPrintingEnabled`,
     * so this selection differs from [kitchenPrinter] and must not be merged with it.
     */
    val previewKitchenPrinter: PrinterConfig?
        get() =
            printers.firstOrNull { it.role == PrinterRole.KITCHEN && it.isDefault }
                ?: receiptPrinter?.takeIf { useReceiptPrinterForKitchen }
}

sealed interface PrinterInitializationResult {
    data class Ready(val failedPrinters: List<String>) : PrinterInitializationResult
    data object StorageUnavailable : PrinterInitializationResult
}

sealed interface PrinterAddResult {
    data object Connected : PrinterAddResult
    data object SavedConnectionFailed : PrinterAddResult
    data object NotSaved : PrinterAddResult
}

interface PrinterSettingsPersistence {
    suspend fun read(): PrinterSettings
    suspend fun write(settings: PrinterSettings)
}

/** Settings-owned adapter seam; Android Bluetooth mechanics stay in printer.platform. */
interface PrinterSettingsTransport {
    suspend fun enableBluetooth()
    suspend fun pairedDevices(): List<PrinterDevice>
    suspend fun scanDevices(): List<PrinterDevice>
    suspend fun connect(address: String): Boolean
    suspend fun disconnect(address: String)
    suspend fun unpair(address: String)
    suspend fun openCashDrawer(address: String)
    suspend fun writeDocument(address: String, calls: List<PrinterCall>): Boolean
}

interface PrinterSettingsWorkflow {
    val state: StateFlow<PrinterSettingsState>
    suspend fun initialize(): PrinterInitializationResult
}

class PrinterSettingsUnavailable(message: String, cause: Throwable? = null) :
    Exception(message, cause)

class PrinterOperationFailed(message: String) : Exception(message)
