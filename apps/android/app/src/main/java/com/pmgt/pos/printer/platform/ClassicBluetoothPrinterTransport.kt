package com.pmgt.pos.printer.platform

import com.pmgt.pos.printer.EscPosEncoder
import com.pmgt.pos.printer.PrinterCall
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class BluetoothEnableRequest(val action: String)

enum class PrinterFailureStage { AdapterState, DiscoveryCancellation, SocketConstruction, Connect, Write }

sealed interface PrinterTransportResult {
    data class Connected(val address: String) : PrinterTransportResult

    /** The local RFCOMM stream accepted these bytes; this is not paper-delivery evidence. */
    data class LocalBytesAccepted(val address: String, val byteCount: Int) : PrinterTransportResult

    data object NoAdapter : PrinterTransportResult

    data class BluetoothOff(val enableRequest: BluetoothEnableRequest) : PrinterTransportResult

    data class PermissionDenied(val missing: List<PrinterBluetoothPermission>) : PrinterTransportResult

    data class Failure(val stage: PrinterFailureStage, val message: String) : PrinterTransportResult
}

interface PrinterBluetoothPlatform {
    val apiLevel: Int

    fun hasAdapter(): Boolean

    fun isEnabled(): Boolean

    fun deniedPermissions(required: List<PrinterBluetoothPermission>): List<PrinterBluetoothPermission>

    fun cancelDiscovery()

    fun device(address: String): PrinterBluetoothDevice
}

interface PrinterBluetoothDevice {
    fun reflectedRfcommSocket(channel: Int): PrinterBluetoothSocket?

    fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket?
}

interface PrinterBluetoothSocket {
    val remoteAddress: String

    fun connect()

    fun write(bytes: ByteArray)

    fun flush()

    fun close()
}

class ClassicBluetoothPrinterTransport(
    private val platform: PrinterBluetoothPlatform,
    private val io: CoroutineDispatcher,
    private val connectTimeoutMillis: Long = 3_500,
) {
    private val operation = Mutex()
    private var activeSocket: PrinterBluetoothSocket? = null

    suspend fun connect(address: String): PrinterTransportResult =
        operation.withLock { connectLocked(address) }

    suspend fun connectedAddress(): String? = operation.withLock { activeSocket?.remoteAddress }

    suspend fun disconnect(address: String? = null): Boolean = operation.withLock {
        val socket = activeSocket ?: return@withLock false
        if (address != null && socket.remoteAddress != address) return@withLock false
        activeSocket = null
        closeSocket(socket)
        true
    }

    suspend fun writeDocument(
        address: String,
        calls: List<PrinterCall>,
    ): PrinterTransportResult = operation.withLock {
        val connection = connectLocked(address)
        if (connection !is PrinterTransportResult.Connected) return@withLock connection
        val socket = activeSocket
            ?: return@withLock PrinterTransportResult.Failure(
                PrinterFailureStage.Connect,
                "Connected printer socket was unavailable",
            )
        var byteCount = 0
        try {
            for (call in calls) {
                val bytes = EscPosEncoder.encode(call)
                socketIo(socket) {
                    socket.write(bytes)
                    socket.flush()
                }
                byteCount += bytes.size
            }
        } catch (cancelled: CancellationException) {
            activeSocket = null
            closeSocket(socket)
            throw cancelled
        } catch (failure: Exception) {
            activeSocket = null
            closeSocket(socket)
            return@withLock failureResult(PrinterFailureStage.Write, failure)
        }
        PrinterTransportResult.LocalBytesAccepted(address, byteCount)
    }

    private suspend fun connectLocked(address: String): PrinterTransportResult {
        preflight()?.let { unavailable ->
            activeSocket?.let { closeSocket(it) }
            activeSocket = null
            return unavailable
        }
        activeSocket?.takeIf { it.remoteAddress == address }?.let {
            return PrinterTransportResult.Connected(address)
        }
        activeSocket?.let { old -> withContext(io) { runCatching { old.close() } } }
        activeSocket = null

        try {
            platform.cancelDiscovery()
        } catch (failure: Exception) {
            return failureResult(PrinterFailureStage.DiscoveryCancellation, failure)
        }

        val device = try {
            platform.device(address)
        } catch (failure: Exception) {
            return failureResult(PrinterFailureStage.SocketConstruction, failure)
        }
        var socket: PrinterBluetoothSocket? = null
        for (channel in 1..3) {
            socket = try {
                device.reflectedRfcommSocket(channel)
            } catch (_: Exception) {
                null
            }
            if (socket != null) break
        }
        if (socket == null) {
            socket = try {
                device.serviceRecordSocket(SPP_UUID)
            } catch (failure: Exception) {
                return failureResult(PrinterFailureStage.SocketConstruction, failure)
            }
        }
        if (socket == null) {
            return PrinterTransportResult.Failure(
                PrinterFailureStage.SocketConstruction,
                "No Bluetooth socket was constructed",
            )
        }

        try {
            withTimeout(connectTimeoutMillis) {
                socketIo(socket) { socket.connect() }
            }
        } catch (timeout: TimeoutCancellationException) {
            closeSocket(socket)
            return PrinterTransportResult.Failure(
                PrinterFailureStage.Connect,
                "Bluetooth connection timed out",
            )
        } catch (cancelled: CancellationException) {
            closeSocket(socket)
            throw cancelled
        } catch (failure: Exception) {
            closeSocket(socket)
            return failureResult(PrinterFailureStage.Connect, failure)
        }
        if (socket.remoteAddress != address) {
            withContext(io) { runCatching { socket.close() } }
            return PrinterTransportResult.Failure(
                PrinterFailureStage.Connect,
                "Connected socket target did not match the requested printer",
            )
        }
        activeSocket = socket
        return PrinterTransportResult.Connected(address)
    }

    private suspend fun <T> socketIo(socket: PrinterBluetoothSocket, block: () -> T): T =
        coroutineScope {
            val pending = async(io) { block() }
            try {
                pending.await()
            } catch (cancelled: CancellationException) {
                closeSocket(socket)
                throw cancelled
            }
        }

    private suspend fun closeSocket(socket: PrinterBluetoothSocket) {
        withContext(NonCancellable + io) { runCatching { socket.close() } }
    }

    private fun preflight(): PrinterTransportResult? {
        val hasAdapter = try {
            platform.hasAdapter()
        } catch (failure: Exception) {
            return failureResult(PrinterFailureStage.AdapterState, failure)
        }
        if (!hasAdapter) return PrinterTransportResult.NoAdapter
        val required = PrinterBluetoothPermissionPolicy.requiredForPrinterAccess(platform.apiLevel)
        val denied = try {
            platform.deniedPermissions(required)
        } catch (failure: Exception) {
            return failureResult(PrinterFailureStage.AdapterState, failure)
        }
        if (denied.isNotEmpty()) return PrinterTransportResult.PermissionDenied(denied)
        val enabled = try {
            platform.isEnabled()
        } catch (failure: Exception) {
            return failureResult(PrinterFailureStage.AdapterState, failure)
        }
        if (!enabled) {
            return PrinterTransportResult.BluetoothOff(
                BluetoothEnableRequest(ACTION_REQUEST_ENABLE)
            )
        }
        return null
    }

    private fun failureResult(
        stage: PrinterFailureStage,
        failure: Exception,
    ): PrinterTransportResult {
        if (failure is SecurityException) {
            val required = PrinterBluetoothPermissionPolicy.requiredForPrinterAccess(platform.apiLevel)
            val denied = runCatching { platform.deniedPermissions(required) }.getOrDefault(emptyList())
            if (denied.isNotEmpty()) return PrinterTransportResult.PermissionDenied(denied)
        }
        return PrinterTransportResult.Failure(
            stage,
            failure.message ?: "Bluetooth operation failed",
        )
    }

    private companion object {
        const val ACTION_REQUEST_ENABLE = "android.bluetooth.adapter.action.REQUEST_ENABLE"
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}
