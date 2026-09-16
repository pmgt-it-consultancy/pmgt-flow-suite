package com.pmgt.pos.printer.settings

import com.pmgt.pos.printer.PrinterCall
import com.pmgt.pos.printer.platform.ClassicBluetoothPrinterTransport
import com.pmgt.pos.printer.platform.PrinterTransportResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Settings-level operations that are intentionally outside the RFCOMM document transport.
 * Android integration supplies these user-mediated discovery and device-management actions.
 */
interface PrinterSettingsDeviceAccess {
    suspend fun enableBluetooth()

    suspend fun pairedDevices(): List<PrinterDevice>

    suspend fun scanDevices(): List<PrinterDevice>

    suspend fun unpair(address: String)
}

/** Typed adapter from settings semantics to the serialized classic-Bluetooth transport. */
class ClassicBluetoothPrinterSettingsTransport(
    private val transport: ClassicBluetoothPrinterTransport,
    private val deviceAccess: PrinterSettingsDeviceAccess,
    private val pause: suspend (Long) -> Unit = { delay(it) },
) : PrinterSettingsTransport {
    override suspend fun enableBluetooth() = deviceAccess.enableBluetooth()

    override suspend fun pairedDevices(): List<PrinterDevice> = deviceAccess.pairedDevices()

    override suspend fun scanDevices(): List<PrinterDevice> = deviceAccess.scanDevices()

    /**
     * Source `connectToDevice`. A first connect issued while the OS is still bonding a new printer
     * fails, so when the device turns out to be paired the source waits and tries once more. Losing
     * that retry is what makes a freshly paired printer report Disconnected until the user presses
     * Reconnect.
     */
    override suspend fun connect(address: String): Boolean {
        if (attemptConnect(address)) return true
        val paired =
            try {
                deviceAccess.pairedDevices()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                return false
            }
        if (paired.none { it.address == address }) return false
        pause(CONNECT_RETRY_DELAY_MILLIS)
        return attemptConnect(address)
    }

    private suspend fun attemptConnect(address: String): Boolean =
        transport.connect(address) is PrinterTransportResult.Connected

    override suspend fun disconnect(address: String) {
        transport.disconnect(address)
    }

    override suspend fun unpair(address: String) = deviceAccess.unpair(address)

    /**
     * RN's openCashDrawer() writes the ESC p pulse over the printer's own connection, so it is a
     * document write on the shared serialized transport rather than a device-management action.
     */
    override suspend fun openCashDrawer(address: String) {
        val result = transport.writeDocument(address, listOf(PrinterCall.OpenDrawer))
        if (result !is PrinterTransportResult.LocalBytesAccepted) {
            throw PrinterOperationFailed("Failed to open cash drawer")
        }
    }

    override suspend fun writeDocument(address: String, calls: List<PrinterCall>): Boolean =
        transport.writeDocument(address, calls) is PrinterTransportResult.LocalBytesAccepted
}

private const val CONNECT_RETRY_DELAY_MILLIS = 800L
