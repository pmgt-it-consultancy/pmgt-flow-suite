package com.pmgt.pos.printer.platform

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import com.pmgt.pos.printer.settings.PrinterDevice
import com.pmgt.pos.printer.settings.PrinterDeviceManager
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Raw Android device management for printer settings. Mirrors the installed RN manager module:
 * bonded devices come from the adapter, and one discovery pass ends at DISCOVERY_FINISHED.
 */
class AndroidPrinterDeviceManager(private val context: Context) : PrinterDeviceManager {
    private val adapter: BluetoothAdapter?
        get() = context.getSystemService(BluetoothManager::class.java)?.adapter

    override fun hasAdapter(): Boolean = adapter != null

    override fun isEnabled(): Boolean = adapter?.isEnabled == true

    // A permission revoked while the till is open must not crash it; the settings policy already
    // treats missing Bluetooth access as no devices and no unpair, so a SecurityException lands in
    // the same place rather than taking the process down.
    override fun bondedDevices(): List<PrinterDevice> =
        try {
            adapter?.bondedDevices.orEmpty().map { it.toPrinterDevice() }
        } catch (_: SecurityException) {
            emptyList()
        }

    override fun cancelDiscovery() {
        try {
            adapter?.takeIf { it.isDiscovering }?.cancelDiscovery()
        } catch (_: SecurityException) {
            // Nothing to cancel without scan access.
        }
    }

    override suspend fun discover(): List<PrinterDevice> {
        val adapter = adapter ?: return emptyList()
        return suspendCancellableCoroutine { continuation ->
            val found = LinkedHashMap<String, PrinterDevice>()
            val receiver =
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        when (intent.action) {
                            BluetoothDevice.ACTION_FOUND -> {
                                val device =
                                    IntentCompat.bluetoothDevice(intent) ?: return
                                val entry = device.toPrinterDevice()
                                // Source keeps the first report for an address.
                                found.putIfAbsent(entry.address, entry)
                            }
                            BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                                runCatching { context.unregisterReceiver(this) }
                                if (continuation.isActive) continuation.resume(found.values.toList())
                            }
                        }
                    }
                }
            context.registerReceiver(
                receiver,
                IntentFilter().apply {
                    addAction(BluetoothDevice.ACTION_FOUND)
                    addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
                },
            )
            continuation.invokeOnCancellation {
                runCatching { context.unregisterReceiver(receiver) }
                try {
                    adapter.cancelDiscovery()
                } catch (_: SecurityException) {
                    // Scan access was revoked; there is nothing left to cancel.
                } catch (_: Exception) {
                    // Cancellation cleanup is best effort.
                }
            }
            val started =
                try {
                    adapter.startDiscovery()
                } catch (_: SecurityException) {
                    false
                }
            if (!started) {
                runCatching { context.unregisterReceiver(receiver) }
                if (continuation.isActive) continuation.resume(emptyList())
            }
        }
    }

    /** Source uses the hidden removeBond method; absence is reported, never silently ignored. */
    override fun removeBond(address: String) {
        val device =
            try {
                checkNotNull(adapter) { "Bluetooth adapter is unavailable" }.getRemoteDevice(address)
            } catch (denied: SecurityException) {
                throw IllegalStateException("Bluetooth access was denied", denied)
            }
        device.javaClass.getMethod("removeBond").invoke(device)
    }
}

private fun BluetoothDevice.toPrinterDevice(): PrinterDevice {
    // Source falls back to "Unknown" when the name is unavailable, which is also what a denied
    // BLUETOOTH_CONNECT read looks like.
    val label = try { name } catch (_: SecurityException) { null }
    return PrinterDevice(label ?: "Unknown", address)
}

private object IntentCompat {
    @Suppress("DEPRECATION")
    fun bluetoothDevice(intent: Intent): BluetoothDevice? =
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }
}
