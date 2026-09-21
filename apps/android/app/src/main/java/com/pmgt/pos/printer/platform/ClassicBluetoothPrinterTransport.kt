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
    /**
     * A cold thermal printer regularly needs longer than a few seconds to accept a first connect,
     * and a premature timeout is indistinguishable to the caller from a printer that is off.
     */
    private val connectTimeoutMillis: Long = 8_000,
) {
    private val operation = Mutex()

    /**
     * One socket per printer. A single shared socket meant connecting the kitchen printer closed
     * the receipt printer, every 60 second poll closed one to open the other, and our own close
     * raised ACL_DISCONNECTED, which drove an auto-reconnect that closed the other again.
     */
    private val sockets = LinkedHashMap<String, PrinterBluetoothSocket>()

    suspend fun connect(address: String): PrinterTransportResult =
        operation.withLock { connectLocked(address) }

    suspend fun connectedAddresses(): Set<String> = operation.withLock { sockets.keys.toSet() }

    /** A null address closes every printer; otherwise only the one named. */
    suspend fun disconnect(address: String? = null): Boolean = operation.withLock {
        if (address == null) {
            if (sockets.isEmpty()) return@withLock false
            closeAll()
            return@withLock true
        }
        val socket = sockets.remove(address) ?: return@withLock false
        closeSocket(socket)
        true
    }

    suspend fun writeDocument(
        address: String,
        calls: List<PrinterCall>,
    ): PrinterTransportResult = operation.withLock {
        val connection = connectLocked(address)
        if (connection !is PrinterTransportResult.Connected) return@withLock connection
        val socket = sockets[address]
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
            sockets.remove(address)
            closeSocket(socket)
            throw cancelled
        } catch (failure: Exception) {
            sockets.remove(address)
            closeSocket(socket)
            return@withLock failureResult(PrinterFailureStage.Write, failure)
        }
        PrinterTransportResult.LocalBytesAccepted(address, byteCount)
    }

    private suspend fun connectLocked(address: String): PrinterTransportResult {
        preflight()?.let { unavailable ->
            closeAll()
            return unavailable
        }
        if (sockets.containsKey(address)) return PrinterTransportResult.Connected(address)

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

        // The service record is tried first because it is the only path that discovers which RFCOMM
        // channel the printer actually listens on. A reflected createRfcommSocket(n) merely builds an
        // object — it never touches the radio and never returns null for a valid channel — so
        // sweeping channels by construction alone always stopped at 1 and left the service-record
        // path unreachable. Every attempt below is a real connect, and a failed one is closed before
        // the next is tried.
        val attempts = buildList<() -> PrinterBluetoothSocket?> {
            add { device.serviceRecordSocket(SPP_UUID) }
            for (channel in 1..3) add { device.reflectedRfcommSocket(channel) }
        }
        var lastFailure: PrinterTransportResult? = null
        for (construct in attempts) {
            val socket = try {
                construct()
            } catch (_: Exception) {
                null
            } ?: continue
            val attempt = connectSocket(socket, address)
            when (val outcome = attempt.result) {
                is PrinterTransportResult.Connected -> {
                    sockets[address] = socket
                    return outcome
                }
                is PrinterTransportResult.Failure -> {
                    lastFailure = outcome
                    // A printer that never answers will not answer on another channel either, so a
                    // timeout ends the sweep. Without this, an unplugged printer would burn the full
                    // timeout on all four paths and a 60s poll over two printers could outlast its
                    // own interval. An immediate failure is the opposite signal — that is what a
                    // wrong channel looks like — so the sweep continues.
                    if (attempt.timedOut) return outcome
                }
                // A denied permission or a disabled adapter is the same for every remaining path.
                else -> return outcome
            }
        }
        return lastFailure
            ?: PrinterTransportResult.Failure(
                PrinterFailureStage.SocketConstruction,
                "No Bluetooth socket was constructed",
            )
    }

    private class Attempt(val result: PrinterTransportResult, val timedOut: Boolean = false)

    private suspend fun connectSocket(
        socket: PrinterBluetoothSocket,
        address: String,
    ): Attempt {
        try {
            withTimeout(connectTimeoutMillis) {
                socketIo(socket) { socket.connect() }
            }
        } catch (timeout: TimeoutCancellationException) {
            closeSocket(socket)
            return Attempt(
                PrinterTransportResult.Failure(
                    PrinterFailureStage.Connect,
                    "Bluetooth connection timed out",
                ),
                timedOut = true,
            )
        } catch (cancelled: CancellationException) {
            closeSocket(socket)
            throw cancelled
        } catch (failure: Exception) {
            closeSocket(socket)
            return Attempt(failureResult(PrinterFailureStage.Connect, failure))
        }
        if (socket.remoteAddress != address) {
            closeSocket(socket)
            return Attempt(
                PrinterTransportResult.Failure(
                    PrinterFailureStage.Connect,
                    "Connected socket target did not match the requested printer",
                )
            )
        }
        return Attempt(PrinterTransportResult.Connected(address))
    }

    private suspend fun closeAll() {
        val open = sockets.values.toList()
        sockets.clear()
        open.forEach { closeSocket(it) }
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
