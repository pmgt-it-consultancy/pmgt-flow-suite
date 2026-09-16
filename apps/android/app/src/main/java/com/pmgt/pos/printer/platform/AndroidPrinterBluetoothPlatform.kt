package com.pmgt.pos.printer.platform

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.util.UUID

enum class BluetoothEnableResult { Accepted, RefusedOrError }

/** Android-only adapter; policy, selection, timeout and serialization remain in the transport. */
class AndroidPrinterBluetoothPlatform(
    private val context: Context,
    override val apiLevel: Int = Build.VERSION.SDK_INT,
) : PrinterBluetoothPlatform {
    private val adapter: BluetoothAdapter?
        get() = context.getSystemService(BluetoothManager::class.java)?.adapter

    override fun hasAdapter(): Boolean = adapter != null

    override fun isEnabled(): Boolean = adapter?.isEnabled == true

    override fun deniedPermissions(
        required: List<PrinterBluetoothPermission>
    ): List<PrinterBluetoothPermission> = required.filter { permission ->
        context.checkSelfPermission(permission.androidName) != PackageManager.PERMISSION_GRANTED
    }

    override fun cancelDiscovery() {
        val adapter = checkNotNull(adapter) { "Bluetooth adapter is unavailable" }
        try {
            adapter.cancelDiscovery()
        } catch (denied: SecurityException) {
            // Transport reports this as a discovery-cancellation failure, not a crash.
            throw IllegalStateException("Bluetooth scan permission was denied", denied)
        }
    }

    override fun device(address: String): PrinterBluetoothDevice =
        AndroidPrinterBluetoothDevice(
            checkNotNull(adapter) { "Bluetooth adapter is unavailable" }.getRemoteDevice(address)
        )

    fun requiredPermissionNames(): Array<String> =
        PrinterBluetoothPermissionPolicy.requiredForPrinterAccess(apiLevel)
            .map(PrinterBluetoothPermission::androidName)
            .toTypedArray()

    companion object {
        fun requestEnableIntent(): Intent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)

        fun enableResult(resultCode: Int): BluetoothEnableResult =
            if (resultCode == Activity.RESULT_OK) BluetoothEnableResult.Accepted
            else BluetoothEnableResult.RefusedOrError
    }
}

private val PrinterBluetoothPermission.androidName: String
    get() = when (this) {
        PrinterBluetoothPermission.Scan -> Manifest.permission.BLUETOOTH_SCAN
        PrinterBluetoothPermission.Connect -> Manifest.permission.BLUETOOTH_CONNECT
        PrinterBluetoothPermission.FineLocation -> Manifest.permission.ACCESS_FINE_LOCATION
    }

private class AndroidPrinterBluetoothDevice(
    private val device: BluetoothDevice,
) : PrinterBluetoothDevice {
    override fun reflectedRfcommSocket(channel: Int): PrinterBluetoothSocket? {
        val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
        return (method.invoke(device, channel) as? BluetoothSocket)?.let(::AndroidPrinterBluetoothSocket)
    }

    override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? =
        device.createRfcommSocketToServiceRecord(uuid)?.let(::AndroidPrinterBluetoothSocket)
}

private class AndroidPrinterBluetoothSocket(
    private val socket: BluetoothSocket,
) : PrinterBluetoothSocket {
    override val remoteAddress: String
        get() = socket.remoteDevice.address

    override fun connect() = socket.connect()

    override fun write(bytes: ByteArray) = socket.outputStream.write(bytes)

    override fun flush() = socket.outputStream.flush()

    override fun close() = socket.close()
}
