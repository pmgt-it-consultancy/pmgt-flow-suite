package com.pmgt.pos.printer.settings

import com.pmgt.pos.printer.BillDocument
import com.pmgt.pos.printer.BillFormatter
import com.pmgt.pos.printer.KitchenTicketDocument
import com.pmgt.pos.printer.KitchenTicketFormatter
import com.pmgt.pos.printer.PrinterCall
import com.pmgt.pos.printer.ReceiptDocument
import com.pmgt.pos.printer.ReceiptFormatter
import com.pmgt.pos.printer.TestPrintFormatter
import com.pmgt.pos.telemetry.Telemetry
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class PrinterSettingsController(
    private val persistence: PrinterSettingsPersistence,
    private val transport: PrinterSettingsTransport,
    private val pause: suspend (Long) -> Unit = { delay(it) },
) : PrinterSettingsWorkflow {
    private val mutableState = MutableStateFlow(PrinterSettingsState())
    override val state = mutableState.asStateFlow()
    private val settingsMutation = Mutex()
    private val connectionSequence = AtomicLong(0)
    private val connectionOperations = ConcurrentHashMap<String, Long>()
    private val latestConnectOperations = ConcurrentHashMap<String, Long>()

    override suspend fun initialize(): PrinterInitializationResult {
        val settings =
            try {
                persistence.read()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                mutableState.update {
                    it.copy(
                        isLoading = false,
                        isInitialized = false,
                        storageError = STORAGE_ERROR,
                    )
                }
                return PrinterInitializationResult.StorageUnavailable
            }
        mutableState.update {
            it.copy(
                printers = settings.printers,
                kitchenPrintingEnabled = settings.kitchenPrintingEnabled,
                cashDrawerEnabled = settings.cashDrawerEnabled,
                useReceiptPrinterForKitchen = settings.useReceiptPrinterForKitchen,
                minimalReceiptEnabled = settings.minimalReceiptEnabled,
                isLoading = false,
                storageError = null,
            )
        }

        ignoreFailure { transport.enableBluetooth() }
        pause(INITIALIZATION_DELAY_MILLIS)
        val pending = LinkedHashMap(settings.printers.associateBy { it.id })
        val status = linkedMapOf<String, PrinterConnectionStatus>()
        for (attempt in 0 until MAX_INITIAL_CONNECT_ATTEMPTS) {
            if (attempt > 0) pause(RETRY_DELAY_MILLIS)
            pending.entries.toList().forEach { (id, printer) ->
                val connected = falseOnFailure { transport.connect(id) }
                status[id] =
                    if (connected) PrinterConnectionStatus.CONNECTED
                    else PrinterConnectionStatus.DISCONNECTED
                if (connected) pending.remove(id)
            }
            if (pending.isEmpty()) break
        }
        pending.keys.forEach {
            reported("connect", it, PrinterOperationFailed("Failed to connect to printer at startup"))
        }
        mutableState.update {
            it.copy(connectionStatus = status, isInitialized = true)
        }
        return PrinterInitializationResult.Ready(pending.values.map { it.name })
    }

    suspend fun startScan() {
        val saved = mutableState.value.printers.mapTo(mutableSetOf()) { it.id }
        mutableState.update {
            it.copy(discoveredDevices = emptyList(), isScanning = true, addFeedback = null)
        }
        try {
            val paired = emptyOnFailure { transport.pairedDevices() }
            mutableState.update {
                it.copy(discoveredDevices = mergeDevices(it.discoveredDevices, paired, saved))
            }
            val found = emptyOnFailure { transport.scanDevices() }
            mutableState.update {
                it.copy(discoveredDevices = mergeDevices(it.discoveredDevices, found, saved))
            }
        } finally {
            mutableState.update { it.copy(isScanning = false) }
        }
    }

    suspend fun addPrinter(
        device: PrinterDevice,
        role: PrinterRole,
        paperWidth: PrinterPaperWidth,
    ): PrinterAddResult {
        mutableState.update {
            it.copy(addFeedback = PrinterAddFeedback(device, role, paperWidth, PrinterAddStage.SAVING))
        }
        val saved =
            settingsMutation.withLock {
                val before = mutableState.value
                val existing = before.printers.firstOrNull { it.id == device.address }
                val hasDefault = before.printers.any { it.role == role && it.isDefault }
                val config =
                    PrinterConfig(
                        id = device.address,
                        name = device.name,
                        deviceName = device.name,
                        role = role,
                        paperWidth = paperWidth,
                        isDefault = existing?.isDefault ?: !hasDefault,
                    )
                val printers =
                    if (existing == null) before.printers + config
                    else before.printers.map { if (it.id == device.address) config else it }
                try {
                    persistence.write(before.settings(printers))
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    mutableState.update {
                        it.copy(
                            addFeedback =
                                PrinterAddFeedback(
                                    device,
                                    role,
                                    paperWidth,
                                    PrinterAddStage.NOT_SAVED,
                                )
                        )
                    }
                    return@withLock false
                }
                mutableState.update {
                    it.copy(
                        printers = printers,
                        connectionStatus =
                            it.connectionStatus +
                                (device.address to PrinterConnectionStatus.RECONNECTING),
                        addFeedback =
                            PrinterAddFeedback(
                                device,
                                role,
                                paperWidth,
                                PrinterAddStage.CONNECTING,
                            ),
                    )
                }
                true
            }
        if (!saved) return PrinterAddResult.NotSaved
        val connectionToken = beginConnection(device.address)
        val connected = falseOnFailure { transport.connect(device.address) }
        var published = false
        mutableState.update {
            if (!isCurrentConnection(device.address, connectionToken) ||
                it.printers.none { printer -> printer.id == device.address }
            ) {
                it
            } else {
                published = true
                it.copy(
                    connectionStatus =
                        it.connectionStatus +
                            (device.address to
                                if (connected) PrinterConnectionStatus.CONNECTED
                                else PrinterConnectionStatus.DISCONNECTED),
                    discoveredDevices =
                        it.discoveredDevices.filterNot { found ->
                            found.address == device.address
                        },
                    addFeedback =
                        PrinterAddFeedback(
                            device,
                            role,
                            paperWidth,
                            if (connected) PrinterAddStage.SUCCESS
                            else PrinterAddStage.SAVED_CONNECTION_FAILED,
                        ),
                )
            }
        }
        if (connected && !published) retireUnpublishedConnection(device.address, connectionToken)
        if (!connected && published) {
            reported("connect", device.address, PrinterOperationFailed("Failed to connect to new printer"))
        }
        return if (connected && published) PrinterAddResult.Connected
        else PrinterAddResult.SavedConnectionFailed
    }

    fun dismissAddFeedback() {
        mutableState.update { it.copy(addFeedback = null) }
    }

    suspend fun updatePrinter(
        id: String,
        name: String,
        role: PrinterRole,
        paperWidth: PrinterPaperWidth,
    ) {
        settingsMutation.withLock {
            val before = mutableState.value
            val printers =
                before.printers.map {
                    if (it.id == id) it.copy(name = name, role = role, paperWidth = paperWidth)
                    else it
                }
            persistence.write(before.settings(printers))
            mutableState.update { it.copy(printers = printers) }
        }
    }

    suspend fun removePrinter(id: String) {
        settingsMutation.withLock {
            invalidateConnection(id)
            val wasConnected =
                mutableState.value.connectionStatus[id] == PrinterConnectionStatus.CONNECTED
            mutableState.update { current ->
                current.copy(
                    printers = current.printers.filterNot { it.id == id },
                    connectionStatus = current.connectionStatus - id,
                    reconnectAttempts = current.reconnectAttempts - id,
                )
            }
            if (wasConnected) ignoreFailure { transport.disconnect(id) }
            ignoreFailure { transport.unpair(id) }
            persistence.write(mutableState.value.settings())
        }
    }

    suspend fun reconnect(id: String): Boolean {
        if (mutableState.value.printers.none { it.id == id }) return false
        val connectionToken = beginConnection(id)
        var started = false
        mutableState.update {
            if (!isCurrentConnection(id, connectionToken) ||
                it.printers.none { printer -> printer.id == id }
            ) {
                it
            } else {
                started = true
                it.copy(
                    connectionStatus =
                        it.connectionStatus + (id to PrinterConnectionStatus.RECONNECTING),
                    reconnectAttempts = it.reconnectAttempts + (id to 0),
                )
            }
        }
        if (!started) return false
        val connected = falseOnFailure { transport.connect(id) }
        var published = false
        mutableState.update {
            if (!isCurrentConnection(id, connectionToken) ||
                it.printers.none { printer -> printer.id == id }
            ) {
                it
            } else {
                published = true
                it.copy(
                    connectionStatus =
                        it.connectionStatus +
                            (id to
                                if (connected) PrinterConnectionStatus.CONNECTED
                                else PrinterConnectionStatus.FAILED),
                )
            }
        }
        if (connected && !published) retireUnpublishedConnection(id, connectionToken)
        if (!connected && published) reported("reconnect", id, PrinterOperationFailed("Failed to reconnect printer"))
        return connected && published
    }

    /**
     * Source polling pass. A printer already reconnecting is skipped, a successful connect is
     * published, and a printer that *was* connected and now is not is returned for auto-reconnect.
     * The source starts those without awaiting them, so the caller owns that concurrency. A failed
     * connect for an already disconnected or failed printer deliberately changes nothing.
     */
    suspend fun pollConnections(): List<String> {
        val lost = mutableListOf<String>()
        for (printer in mutableState.value.printers) {
            val before = mutableState.value.connectionStatus[printer.id]
            if (before == PrinterConnectionStatus.RECONNECTING) continue
            if (attemptConnection(printer.id)) {
                publishStatus(printer.id, PrinterConnectionStatus.CONNECTED, resetAttempts = true)
            } else if (before == PrinterConnectionStatus.CONNECTED) {
                lost += printer.id
            }
        }
        return lost
    }

    /** Source auto-reconnect: five attempts with 1/2/4/8/16s backoff, then FAILED. */
    suspend fun autoReconnect(id: String) {
        if (mutableState.value.connectionStatus[id] == PrinterConnectionStatus.RECONNECTING) return
        if (mutableState.value.printers.none { it.id == id }) return
        publishStatus(id, PrinterConnectionStatus.RECONNECTING, resetAttempts = false)
        for (attempt in 0 until MAX_RECONNECT_ATTEMPTS) {
            val current = mutableState.value
            // A native connect event may have landed, or the printer may have been removed.
            if (current.connectionStatus[id] == PrinterConnectionStatus.CONNECTED) return
            if (current.printers.none { it.id == id }) return
            incrementReconnectAttempts(id)
            if (attemptConnection(id)) {
                publishStatus(id, PrinterConnectionStatus.CONNECTED, resetAttempts = true)
                return
            }
            if (attempt < MAX_RECONNECT_ATTEMPTS - 1) pause(BACKOFF_MILLIS[attempt])
        }
        publishStatus(id, PrinterConnectionStatus.FAILED, resetAttempts = false)
        reported("reconnect", id, PrinterOperationFailed("Failed to reconnect printer"))
    }

    /** Native ACL connect for a tracked printer. */
    fun deviceConnected(id: String) {
        publishStatus(id, PrinterConnectionStatus.CONNECTED, resetAttempts = true)
    }

    /** Native ACL disconnect; the source reconnects only a printer that was connected. */
    suspend fun deviceDisconnected(id: String) {
        val current = mutableState.value
        if (current.printers.none { it.id == id }) return
        if (current.connectionStatus[id] == PrinterConnectionStatus.CONNECTED) autoReconnect(id)
    }

    /** One connect attempt; the caller publishes, so an untouched status stays untouched. */
    private suspend fun attemptConnection(id: String): Boolean {
        if (mutableState.value.printers.none { it.id == id }) return false
        val connectionToken = beginConnection(id)
        val connected = falseOnFailure { transport.connect(id) }
        val stillOurs =
            isCurrentConnection(id, connectionToken) &&
                mutableState.value.printers.any { it.id == id }
        if (connected && !stillOurs) {
            retireUnpublishedConnection(id, connectionToken)
            return false
        }
        return connected
    }

    /** A removed printer is never resurrected, so publication always re-checks the list. */
    private fun publishStatus(
        id: String,
        status: PrinterConnectionStatus,
        resetAttempts: Boolean,
    ) {
        mutableState.update {
            if (it.printers.none { printer -> printer.id == id }) {
                it
            } else {
                it.copy(
                    connectionStatus = it.connectionStatus + (id to status),
                    reconnectAttempts =
                        if (resetAttempts) it.reconnectAttempts - id else it.reconnectAttempts,
                )
            }
        }
    }

    fun incrementReconnectAttempts(id: String): Int {
        var next = 0
        mutableState.update {
            if (it.printers.none { printer -> printer.id == id }) {
                it
            } else {
                next = (it.reconnectAttempts[id] ?: 0) + 1
                it.copy(reconnectAttempts = it.reconnectAttempts + (id to next))
            }
        }
        return next
    }

    suspend fun setKitchenPrintingEnabled(enabled: Boolean) =
        persistFlag { it.copy(kitchenPrintingEnabled = enabled) }

    suspend fun setCashDrawerEnabled(enabled: Boolean) =
        persistFlag { it.copy(cashDrawerEnabled = enabled) }

    suspend fun setUseReceiptPrinterForKitchen(enabled: Boolean) =
        persistFlag { it.copy(useReceiptPrinterForKitchen = enabled) }

    suspend fun setMinimalReceiptEnabled(enabled: Boolean) =
        persistFlag { it.copy(minimalReceiptEnabled = enabled) }

    /** Source store printReceipt: default receipt printer, connect, then one document write. */
    suspend fun printReceipt(document: ReceiptDocument) {
        val printer =
            mutableState.value.receiptPrinter
                ?: throw PrinterOperationFailed("No receipt printer configured")
        if (!connectPrinter(printer.id)) {
            throw reported("connect", printer.id, PrinterOperationFailed("Failed to connect to receipt printer"))
        }
        val calls =
            ReceiptFormatter.format(
                document,
                printer.paperWidth.charsPerLine,
                mutableState.value.minimalReceiptEnabled,
            )
        if (!transport.writeDocument(printer.id, calls)) {
            throw reported("write", printer.id, PrinterOperationFailed("Failed to send receipt"))
        }
    }

    /** Prints a pre-settlement bill through the configured receipt printer. */
    suspend fun printBill(document: BillDocument) {
        val printer =
            mutableState.value.receiptPrinter
                ?: throw PrinterOperationFailed("No receipt printer configured")
        if (!connectPrinter(printer.id)) {
            throw reported(
                "connect",
                printer.id,
                PrinterOperationFailed("Failed to connect to receipt printer"),
            )
        }
        if (
            !transport.writeDocument(
                printer.id,
                BillFormatter.format(document, printer.paperWidth.charsPerLine),
            )
        ) {
            throw reported("write", printer.id, PrinterOperationFailed("Failed to send bill"))
        }
    }

    /**
     * Source store printKitchenTicket: silent when kitchen printing is off, no printer is selected,
     * or the connection fails. A kitchen ticket never surfaces an error the RN user did not see.
     */
    suspend fun printKitchenTicket(document: KitchenTicketDocument) {
        if (!mutableState.value.kitchenPrintingEnabled) return
        val printer = mutableState.value.kitchenPrinter ?: return
        if (!connectPrinter(printer.id)) {
            reported("connect", printer.id, PrinterOperationFailed("Failed to connect to kitchen printer"))
            return
        }
        val accepted =
            transport.writeDocument(
                printer.id,
                KitchenTicketFormatter.format(document, printer.paperWidth.charsPerLine),
            )
        if (!accepted) reported("write", printer.id, PrinterOperationFailed("Failed to send kitchen ticket"))
    }

    /**
     * Receipt-preview kitchen print. The source connects the chosen target directly and does not
     * consult `kitchenPrintingEnabled`; failures surface to the preview instead of being silent.
     */
    suspend fun printPreviewKitchenTicket(document: KitchenTicketDocument) {
        val printer =
            mutableState.value.previewKitchenPrinter
                ?: throw PrinterOperationFailed("No kitchen printer configured")
        if (!connectPrinter(printer.id)) {
            throw reported("connect", printer.id, PrinterOperationFailed("Failed to connect to printer"))
        }
        val accepted =
            transport.writeDocument(
                printer.id,
                KitchenTicketFormatter.format(document, printer.paperWidth.charsPerLine),
            )
        if (!accepted) reported("write", printer.id, PrinterOperationFailed("Failed to send kitchen ticket"))
    }

    /** Already-formatted document (Z report) for the selected receipt printer. */
    suspend fun printReceiptCalls(calls: List<PrinterCall>) {
        val printer =
            mutableState.value.receiptPrinter
                ?: throw PrinterOperationFailed("No receipt printer configured")
        if (!connectPrinter(printer.id)) {
            throw reported("connect", printer.id, PrinterOperationFailed("Failed to connect to receipt printer"))
        }
        if (!transport.writeDocument(printer.id, calls)) {
            throw reported("write", printer.id, PrinterOperationFailed("Failed to send document"))
        }
    }

    /**
     * Day-closing width. The source picks the first printer with the receipt role **regardless of
     * its default flag** and treats anything other than 80mm — including no printer at all — as 32
     * columns, so this deliberately does not reuse [PrinterSettingsState.receiptPrinter].
     */
    fun receiptCharsPerLine(): Int {
        val receipt = mutableState.value.printers.firstOrNull { it.role == PrinterRole.RECEIPT }
        return if (receipt?.paperWidth == PrinterPaperWidth.MM80) 48 else 32
    }

    suspend fun openCashDrawer() {
        val printer =
            mutableState.value.receiptPrinter
                ?: throw PrinterOperationFailed("No receipt printer configured")
        if (!connectPrinter(printer.id)) {
            throw reported("connect", printer.id, PrinterOperationFailed("Failed to connect to receipt printer"))
        }
        try {
            transport.openCashDrawer(printer.id)
        } catch (failure: PrinterOperationFailed) {
            throw reported("drawer", printer.id, failure)
        }
    }

    suspend fun testPrint(id: String, displayDateTime: String) {
        if (mutableState.value.connectionStatus[id] != PrinterConnectionStatus.CONNECTED) {
            if (!connectPrinter(id)) {
                throw reported("connect", id, PrinterOperationFailed("Failed to connect to printer"))
            }
        }
        val name = mutableState.value.printers.firstOrNull { it.id == id }?.name ?: "Unknown Printer"
        val accepted = transport.writeDocument(id, TestPrintFormatter.format(name, displayDateTime))
        if (!accepted) throw reported("write", id, PrinterOperationFailed("Failed to send test print"))
    }

    private suspend fun connectPrinter(id: String): Boolean {
        if (mutableState.value.printers.none { it.id == id }) return false
        val connectionToken = beginConnection(id)
        val connected = falseOnFailure { transport.connect(id) }
        var published = false
        mutableState.update {
            if (!isCurrentConnection(id, connectionToken) ||
                it.printers.none { printer -> printer.id == id }
            ) {
                it
            } else {
                published = true
                it.copy(
                    connectionStatus =
                        it.connectionStatus +
                            (id to
                                if (connected) PrinterConnectionStatus.CONNECTED
                                else PrinterConnectionStatus.DISCONNECTED),
                )
            }
        }
        if (connected && !published) retireUnpublishedConnection(id, connectionToken)
        return connected && published
    }

    /**
     * A print, drawer or reconnect that failed after the transport's own bonding retry. Only the
     * printer's role is attached; its Bluetooth address never leaves the tablet.
     */
    private fun reported(operation: String, id: String, failure: PrinterOperationFailed): PrinterOperationFailed {
        val role = mutableState.value.printers.firstOrNull { it.id == id }?.role?.name?.lowercase() ?: "unknown"
        Telemetry.nonFatal("printer.$operation", failure, "printer_role" to role)
        return failure
    }

    private suspend fun persistFlag(update: (PrinterSettings) -> PrinterSettings) {
        settingsMutation.withLock {
            val next = update(mutableState.value.settings())
            persistence.write(next)
            mutableState.update {
                it.copy(
                    kitchenPrintingEnabled = next.kitchenPrintingEnabled,
                    cashDrawerEnabled = next.cashDrawerEnabled,
                    useReceiptPrinterForKitchen = next.useReceiptPrinterForKitchen,
                    minimalReceiptEnabled = next.minimalReceiptEnabled,
                )
            }
        }
    }

    private fun beginConnection(id: String): Long =
        connectionSequence.incrementAndGet().also {
            connectionOperations[id] = it
            latestConnectOperations[id] = it
        }

    /**
     * A connection that succeeded but whose result was never published (the printer was removed, or
     * the operation was superseded) leaves an untracked socket open. Retire that exact connection,
     * but never close a newer connect operation that now owns the same address.
     */
    private suspend fun retireUnpublishedConnection(id: String, token: Long) {
        if (latestConnectOperations[id] != token) return
        ignoreFailure { transport.disconnect(id) }
    }

    private fun invalidateConnection(id: String) {
        connectionOperations[id] = connectionSequence.incrementAndGet()
    }

    private fun isCurrentConnection(id: String, token: Long): Boolean =
        connectionOperations[id] == token

    private suspend fun falseOnFailure(operation: suspend () -> Boolean): Boolean =
        try {
            operation()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            false
        }

    private suspend fun <T> emptyOnFailure(operation: suspend () -> List<T>): List<T> =
        try {
            operation()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            emptyList()
        }

    private suspend fun ignoreFailure(operation: suspend () -> Unit) {
        try {
            operation()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Source behavior deliberately treats adapter cleanup and enable failures as best effort.
        }
    }

    private fun mergeDevices(
        existing: List<PrinterDevice>,
        incoming: List<PrinterDevice>,
        saved: Set<String>,
    ): List<PrinterDevice> {
        val merged = LinkedHashMap(existing.associateBy { it.address })
        incoming.forEach { device ->
            if (device.address !in saved) {
                val previous = merged[device.address]
                if (previous == null || (previous.name == "Unknown" && device.name != "Unknown")) {
                    merged[device.address] = device
                }
            }
        }
        return merged.values.toList()
    }

    private fun PrinterSettingsState.settings(printers: List<PrinterConfig> = this.printers) =
        PrinterSettings(
            printers = printers,
            kitchenPrintingEnabled = kitchenPrintingEnabled,
            cashDrawerEnabled = cashDrawerEnabled,
            useReceiptPrinterForKitchen = useReceiptPrinterForKitchen,
            minimalReceiptEnabled = minimalReceiptEnabled,
        )

    private companion object {
        const val MAX_INITIAL_CONNECT_ATTEMPTS = 3
        const val MAX_RECONNECT_ATTEMPTS = 5
        val BACKOFF_MILLIS = longArrayOf(1_000, 2_000, 4_000, 8_000, 16_000)
        const val INITIALIZATION_DELAY_MILLIS = 1_000L
        const val RETRY_DELAY_MILLIS = 1_000L
        const val STORAGE_ERROR =
            "Saved printer settings are unavailable. Keep the original tablet data and repair secure storage access before continuing."
    }
}
