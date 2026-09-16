package com.pmgt.pos.printer.platform

import com.pmgt.pos.printer.PrinterAlignment
import com.pmgt.pos.printer.PrinterCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PrinterPlatformTest {
    @Test fun permissionPolicyPreservesRnAllGrantsBranches() {
        assertEquals(
            listOf(PrinterBluetoothPermission.FineLocation),
            PrinterBluetoothPermissionPolicy.requiredForPrinterAccess(apiLevel = 30),
        )
        assertEquals(
            listOf(
                PrinterBluetoothPermission.Scan,
                PrinterBluetoothPermission.Connect,
                PrinterBluetoothPermission.FineLocation,
            ),
            PrinterBluetoothPermissionPolicy.requiredForPrinterAccess(apiLevel = 31),
        )
        assertEquals(
            PrinterBluetoothPermissionPolicy.requiredForPrinterAccess(apiLevel = 31),
            PrinterBluetoothPermissionPolicy.requiredForPrinterAccess(apiLevel = 36),
        )
    }

    @Test fun connectReportsTypedUnavailableStatesBeforeTouchingDeviceIo() = runBlocking {
        val noAdapter = FakeBluetoothPlatform(hasAdapter = false)
        assertEquals(
            PrinterTransportResult.NoAdapter,
            ClassicBluetoothPrinterTransport(noAdapter, Dispatchers.IO).connect("printer"),
        )
        assertEquals(0, noAdapter.deviceRequests)

        val bluetoothOff = FakeBluetoothPlatform(enabled = false)
        assertEquals(
            PrinterTransportResult.BluetoothOff(
                BluetoothEnableRequest("android.bluetooth.adapter.action.REQUEST_ENABLE")
            ),
            ClassicBluetoothPrinterTransport(bluetoothOff, Dispatchers.IO).connect("printer"),
        )
        assertEquals(0, bluetoothOff.deviceRequests)

        val denied = FakeBluetoothPlatform(
            denied = listOf(PrinterBluetoothPermission.Scan, PrinterBluetoothPermission.FineLocation)
        )
        assertEquals(
            PrinterTransportResult.PermissionDenied(denied.denied),
            ClassicBluetoothPrinterTransport(denied, Dispatchers.IO).connect("printer"),
        )
        assertEquals(0, denied.deviceRequests)
    }

    @Test fun connectCancelsDiscoveryAndUsesFirstConstructedReflectedChannel() = runBlocking {
        val events = mutableListOf<String>()
        val socket = FakeSocket("printer", events)
        val device = object : PrinterBluetoothDevice {
            override fun reflectedRfcommSocket(channel: Int): PrinterBluetoothSocket? {
                events += "construct:$channel"
                return if (channel == 3) socket else null
            }

            override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? {
                events += "construct:uuid:$uuid"
                return error("SPP UUID must be construction fallback only")
            }
        }
        val platform = FakeBluetoothPlatform(device = device, events = events)

        assertEquals(
            PrinterTransportResult.Connected("printer"),
            ClassicBluetoothPrinterTransport(platform, Dispatchers.IO).connect("printer"),
        )
        assertEquals(
            listOf("cancelDiscovery", "construct:1", "construct:2", "construct:3", "connect:printer"),
            events,
        )
    }

    @Test fun constructionFailuresReachExactPublicSppFallback() = runBlocking {
        val events = mutableListOf<String>()
        val socket = FakeSocket("printer", events)
        val device = object : PrinterBluetoothDevice {
            override fun reflectedRfcommSocket(channel: Int): PrinterBluetoothSocket? {
                events += "construct:$channel"
                throw ReflectiveOperationException("unsupported")
            }

            override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? {
                events += "construct:uuid:$uuid"
                return socket
            }
        }
        val result = ClassicBluetoothPrinterTransport(
            FakeBluetoothPlatform(device = device, events = events),
            Dispatchers.IO,
        ).connect("printer")

        assertEquals(PrinterTransportResult.Connected("printer"), result)
        assertEquals(
            listOf(
                "cancelDiscovery",
                "construct:1",
                "construct:2",
                "construct:3",
                "construct:uuid:00001101-0000-1000-8000-00805f9b34fb",
                "connect:printer",
            ),
            events,
        )
    }

    @Test fun connectFailureNeverAdvancesToAnotherChannelOrSpp() = runBlocking {
        val events = mutableListOf<String>()
        val socket = FakeSocket("printer", events, connectFailure = IOException("unreachable"))
        val device = object : PrinterBluetoothDevice {
            override fun reflectedRfcommSocket(channel: Int): PrinterBluetoothSocket? {
                events += "construct:$channel"
                return socket
            }

            override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? {
                events += "construct:uuid:$uuid"
                return error("Connect failure must not trigger another construction")
            }
        }
        val result = ClassicBluetoothPrinterTransport(
            FakeBluetoothPlatform(device = device, events = events),
            Dispatchers.IO,
        ).connect("printer")

        assertTrue(result is PrinterTransportResult.Failure)
        assertEquals(PrinterFailureStage.Connect, (result as PrinterTransportResult.Failure).stage)
        assertEquals(
            listOf("cancelDiscovery", "construct:1", "connect:printer", "close:printer"),
            events,
        )
    }

    @Test fun timeoutClosesExactInFlightSocketAndLateCompletionCannotBecomeActive() = runBlocking {
        val entered = CountDownLatch(1)
        val releaseLateCompletion = CountDownLatch(1)
        val firstClosed = CountDownLatch(1)
        val first = object : PrinterBluetoothSocket {
            override val remoteAddress = "printer"

            override fun connect() {
                entered.countDown()
                releaseLateCompletion.await(5, TimeUnit.SECONDS)
            }

            override fun write(bytes: ByteArray) = Unit

            override fun flush() = Unit

            override fun close() {
                firstClosed.countDown()
                // Deliberately emulate a late platform completion after close.
            }
        }
        val secondEvents = mutableListOf<String>()
        val second = FakeSocket("printer", secondEvents)
        val sockets = ArrayDeque(listOf(first, second))
        val device = object : PrinterBluetoothDevice {
            override fun reflectedRfcommSocket(channel: Int): PrinterBluetoothSocket? =
                if (channel == 1) sockets.removeFirst() else null

            override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? = null
        }
        val transport = ClassicBluetoothPrinterTransport(
            FakeBluetoothPlatform(device = device, events = mutableListOf()),
            Dispatchers.IO,
            connectTimeoutMillis = 40,
        )

        val pending = async { transport.connect("printer") }
        assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
        delay(100)
        val closedBeforeLateCompletion = firstClosed.count == 0L
        releaseLateCompletion.countDown()
        val firstResult = pending.await()
        val secondResult = transport.connect("printer")

        assertTrue("Timeout must close the exact in-flight socket", closedBeforeLateCompletion)
        assertTrue(firstResult is PrinterTransportResult.Failure)
        assertEquals(PrinterFailureStage.Connect, (firstResult as PrinterTransportResult.Failure).stage)
        assertEquals(PrinterTransportResult.Connected("printer"), secondResult)
        assertEquals(listOf("connect:printer"), secondEvents)
    }

    @Test fun targetSelectionAndEveryCompleteDocumentWriteAreSerialized() = runBlocking {
        val firstWriteEntered = CountDownLatch(1)
        val releaseFirstWrite = CountDownLatch(1)
        val selected = mutableListOf<String>()
        val socketA = RecordingSocket("A", firstWriteEntered, releaseFirstWrite)
        val socketB = RecordingSocket("B")
        val platform = object : PrinterBluetoothPlatform {
            override val apiLevel = 36

            override fun hasAdapter() = true

            override fun isEnabled() = true

            override fun deniedPermissions(required: List<PrinterBluetoothPermission>) = emptyList<PrinterBluetoothPermission>()

            override fun cancelDiscovery() = Unit

            override fun device(address: String): PrinterBluetoothDevice {
                selected += address
                val socket = if (address == "A") socketA else socketB
                return object : PrinterBluetoothDevice {
                    override fun reflectedRfcommSocket(channel: Int) = if (channel == 1) socket else null

                    override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? = null
                }
            }
        }
        val transport = ClassicBluetoothPrinterTransport(platform, Dispatchers.IO)
        val callsA = listOf(PrinterCall.Align(PrinterAlignment.LEFT), PrinterCall.Text("A"))
        val callsB = listOf(PrinterCall.Align(PrinterAlignment.RIGHT), PrinterCall.Text("B"))

        val first = async { transport.writeDocument("A", callsA) }
        assertTrue(withContext(Dispatchers.IO) { firstWriteEntered.await(5, TimeUnit.SECONDS) })
        val second = async { transport.writeDocument("B", callsB) }
        delay(50)
        val selectedWhileFirstDocumentBlocked = selected.toList()
        releaseFirstWrite.countDown()

        assertEquals(PrinterTransportResult.LocalBytesAccepted("A", 13), first.await())
        assertEquals(PrinterTransportResult.LocalBytesAccepted("B", 13), second.await())
        assertEquals(listOf("A"), selectedWhileFirstDocumentBlocked)
        assertEquals(listOf(3, 10), socketA.writes.map(ByteArray::size))
        assertEquals(listOf(3, 10), socketB.writes.map(ByteArray::size))
        assertEquals(2, socketA.flushes)
        assertEquals(2, socketB.flushes)
        assertEquals(1, socketA.closes)
    }

    @Test fun callerCancellationClosesTheExactBlockedSocketAndPropagates() = runBlocking {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val closed = CountDownLatch(1)
        val socket = object : PrinterBluetoothSocket {
            override val remoteAddress = "printer"

            override fun connect() {
                entered.countDown()
                release.await(5, TimeUnit.SECONDS)
            }

            override fun write(bytes: ByteArray) = Unit

            override fun flush() = Unit

            override fun close() {
                closed.countDown()
                release.countDown()
            }
        }
        val device = object : PrinterBluetoothDevice {
            override fun reflectedRfcommSocket(channel: Int) = if (channel == 1) socket else null

            override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? = null
        }
        val transport = ClassicBluetoothPrinterTransport(
            FakeBluetoothPlatform(device = device, events = mutableListOf()),
            Dispatchers.IO,
        )

        val pending = async { transport.connect("printer") }
        assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
        pending.cancel()
        assertTrue(withContext(Dispatchers.IO) { closed.await(5, TimeUnit.SECONDS) })
        try {
            pending.await()
            throw AssertionError("Caller cancellation must propagate")
        } catch (_: CancellationException) {
            // Expected: cancellation is never translated into a transport failure.
        }
    }

    @Test fun mismatchedConnectedTargetIsClosedAndNeverPublished() = runBlocking {
        val events = mutableListOf<String>()
        val wrongTarget = FakeSocket("other-printer", events)
        val device = object : PrinterBluetoothDevice {
            override fun reflectedRfcommSocket(channel: Int) = if (channel == 1) wrongTarget else null

            override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? = null
        }
        val result = ClassicBluetoothPrinterTransport(
            FakeBluetoothPlatform(device = device, events = events),
            Dispatchers.IO,
        ).connect("requested-printer")

        assertTrue(result is PrinterTransportResult.Failure)
        assertEquals(PrinterFailureStage.Connect, (result as PrinterTransportResult.Failure).stage)
        assertEquals(
            listOf("cancelDiscovery", "connect:other-printer", "close:other-printer"),
            events,
        )
    }

    @Test fun permissionRevocationAtDiscoveryCancellationStaysTypedAsDenied() = runBlocking {
        var revoked = false
        val platform = object : PrinterBluetoothPlatform {
            override val apiLevel = 36

            override fun hasAdapter() = true

            override fun isEnabled() = true

            override fun deniedPermissions(required: List<PrinterBluetoothPermission>) =
                if (revoked) listOf(PrinterBluetoothPermission.Scan) else emptyList()

            override fun cancelDiscovery() {
                revoked = true
                throw SecurityException("permission revoked")
            }

            override fun device(address: String): PrinterBluetoothDevice =
                error("Revoked discovery permission must prevent socket construction")
        }

        assertEquals(
            PrinterTransportResult.PermissionDenied(listOf(PrinterBluetoothPermission.Scan)),
            ClassicBluetoothPrinterTransport(platform, Dispatchers.IO).connect("printer"),
        )
    }

    @Test fun disconnectRetiresOnlyTheExactActiveTarget() = runBlocking {
        val events = mutableListOf<String>()
        val socket = FakeSocket("printer-A", events)
        val device = object : PrinterBluetoothDevice {
            override fun reflectedRfcommSocket(channel: Int) = if (channel == 1) socket else null

            override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? = null
        }
        val transport = ClassicBluetoothPrinterTransport(
            FakeBluetoothPlatform(device = device, events = events),
            Dispatchers.IO,
        )
        assertEquals(PrinterTransportResult.Connected("printer-A"), transport.connect("printer-A"))

        assertEquals(false, transport.disconnect("printer-B"))
        assertEquals("printer-A", transport.connectedAddress())
        assertEquals(true, transport.disconnect("printer-A"))
        assertEquals(null, transport.connectedAddress())
        assertEquals(1, events.count { it == "close:printer-A" })
    }

    @Test fun permissionLossRetiresAnAlreadyOwnedSocket() = runBlocking {
        val events = mutableListOf<String>()
        val socket = FakeSocket("printer", events)
        var denied = emptyList<PrinterBluetoothPermission>()
        val platform = object : PrinterBluetoothPlatform {
            override val apiLevel = 36

            override fun hasAdapter() = true

            override fun isEnabled() = true

            override fun deniedPermissions(required: List<PrinterBluetoothPermission>) = denied

            override fun cancelDiscovery() = Unit

            override fun device(address: String) = object : PrinterBluetoothDevice {
                override fun reflectedRfcommSocket(channel: Int) = if (channel == 1) socket else null

                override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket? = null
            }
        }
        val transport = ClassicBluetoothPrinterTransport(platform, Dispatchers.IO)
        assertEquals(PrinterTransportResult.Connected("printer"), transport.connect("printer"))

        denied = listOf(PrinterBluetoothPermission.Connect)
        assertEquals(
            PrinterTransportResult.PermissionDenied(denied),
            transport.connect("printer"),
        )
        assertEquals(null, transport.connectedAddress())
        assertEquals(1, events.count { it == "close:printer" })
    }

    private class FakeBluetoothPlatform(
        override val apiLevel: Int = 36,
        private val hasAdapter: Boolean = true,
        private val enabled: Boolean = true,
        val denied: List<PrinterBluetoothPermission> = emptyList(),
        private val device: PrinterBluetoothDevice? = null,
        private val events: MutableList<String>? = null,
    ) : PrinterBluetoothPlatform {
        var deviceRequests = 0

        override fun hasAdapter() = hasAdapter

        override fun isEnabled() = enabled

        override fun deniedPermissions(required: List<PrinterBluetoothPermission>) = denied

        override fun cancelDiscovery() {
            events?.add("cancelDiscovery")
                ?: error("Device I/O must not run for unavailable Bluetooth")
        }

        override fun device(address: String): PrinterBluetoothDevice {
            deviceRequests++
            return device ?: error("Device I/O must not run for unavailable Bluetooth")
        }
    }

    private class FakeSocket(
        override val remoteAddress: String,
        private val events: MutableList<String>,
        private val connectFailure: Exception? = null,
    ) : PrinterBluetoothSocket {
        override fun connect() {
            events += "connect:$remoteAddress"
            connectFailure?.let { throw it }
        }

        override fun write(bytes: ByteArray) {
            events += "write:${bytes.size}"
        }

        override fun flush() {
            events += "flush"
        }

        override fun close() {
            events += "close:$remoteAddress"
        }
    }

    private class RecordingSocket(
        override val remoteAddress: String,
        private val firstWriteEntered: CountDownLatch? = null,
        private val releaseFirstWrite: CountDownLatch? = null,
    ) : PrinterBluetoothSocket {
        val writes = mutableListOf<ByteArray>()
        var flushes = 0
        var closes = 0

        override fun connect() = Unit

        override fun write(bytes: ByteArray) {
            if (writes.isEmpty() && firstWriteEntered != null && releaseFirstWrite != null) {
                firstWriteEntered.countDown()
                releaseFirstWrite.await(5, TimeUnit.SECONDS)
            }
            writes += bytes.copyOf()
        }

        override fun flush() {
            flushes++
        }

        override fun close() {
            closes++
        }
    }
}
