package com.pmgt.pos.printer.settings

import com.pmgt.pos.printer.platform.BluetoothEnableResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Device-management operations behind the raw Android adapter. Bond, discovery and enable policy
 * stay in [AndroidPrinterSettingsDeviceAccess] so they are exercised without a real radio.
 */
interface PrinterDeviceManager {
    fun hasAdapter(): Boolean

    fun isEnabled(): Boolean

    fun bondedDevices(): List<PrinterDevice>

    fun cancelDiscovery()

    /** Runs one discovery pass and returns the devices Android reported as found. */
    suspend fun discover(): List<PrinterDevice>

    fun removeBond(address: String)
}

/**
 * Ports RN `bluetoothPrinter.ts` device management. Permission refusal keeps the source's quiet
 * outcomes (no devices, no unpair) rather than surfacing an error the RN user never saw.
 */
class AndroidPrinterSettingsDeviceAccess(
    private val manager: PrinterDeviceManager,
    private val requestEnable: suspend () -> BluetoothEnableResult,
    private val requestPermissions: suspend () -> Boolean,
    private val pause: suspend (Long) -> Unit = { delay(it) },
    private val now: () -> Long = System::currentTimeMillis,
) : PrinterSettingsDeviceAccess {

    /** Source: reject when unsupported, otherwise request enable and leave the adapter usable. */
    override suspend fun enableBluetooth() {
        if (!manager.hasAdapter()) {
            throw PrinterSettingsUnavailable("Bluetooth is not supported on this device")
        }
        if (manager.isEnabled()) return
        if (requestEnable() != BluetoothEnableResult.Accepted) {
            throw PrinterSettingsUnavailable("Bluetooth was not enabled")
        }
    }

    override suspend fun pairedDevices(): List<PrinterDevice> {
        if (!manager.hasAdapter() || !manager.isEnabled()) return emptyList()
        if (!requestPermissions()) return emptyList()
        return manager.bondedDevices()
    }

    override suspend fun scanDevices(): List<PrinterDevice> {
        if (!manager.hasAdapter() || !manager.isEnabled()) return emptyList()
        if (!requestPermissions()) return emptyList()
        // Source cancels any in-flight discovery before starting its own pass.
        manager.cancelDiscovery()
        return try {
            manager.discover()
        } catch (cancelled: CancellationException) {
            manager.cancelDiscovery()
            throw cancelled
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** Source removes the bond, then polls the paired list until it clears or the timeout ends. */
    override suspend fun unpair(address: String) {
        if (!manager.hasAdapter() || !manager.isEnabled()) return
        if (!requestPermissions()) return
        manager.removeBond(address)
        val startedAt = now()
        while (now() - startedAt < UNPAIR_TIMEOUT_MILLIS) {
            if (manager.bondedDevices().none { it.address == address }) return
            pause(UNPAIR_POLL_INTERVAL_MILLIS)
        }
    }

    private companion object {
        const val UNPAIR_TIMEOUT_MILLIS = 5_000L
        const val UNPAIR_POLL_INTERVAL_MILLIS = 300L
    }
}
