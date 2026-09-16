package com.pmgt.pos.printer.settings

import com.pmgt.pos.printer.PrinterCall
import com.pmgt.pos.printer.TestPrintFormatter
import java.util.concurrent.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PrinterSettingsControllerTest {
    @Test
    fun `add persists before connect and a failed connection retains the saved printer`() = runTest {
        val persistence = FakePersistence()
        val transport = FakeTransport(connectResults = ArrayDeque(listOf(false)))
        transport.onConnect = { address ->
            assertEquals(listOf(address), persistence.current.printers.map { it.id })
        }
        val controller = controller(persistence, transport)
        controller.initialize()

        val result =
            controller.addPrinter(
                PrinterDevice("Kitchen", "AA:01"),
                PrinterRole.KITCHEN,
                PrinterPaperWidth.MM58,
            )

        assertSame(PrinterAddResult.SavedConnectionFailed, result)
        assertEquals(listOf("AA:01"), controller.state.value.printers.map { it.id })
        assertEquals(PrinterAddStage.SAVED_CONNECTION_FAILED, controller.state.value.addFeedback?.stage)
        assertEquals(PrinterConnectionStatus.DISCONNECTED, controller.state.value.connectionStatus["AA:01"])
        assertEquals(controller.state.value.printers, persistence.current.printers)
    }

    @Test
    fun `retrying the same address updates in place and preserves original default`() = runTest {
        val original = printer("AA", "Old", PrinterRole.RECEIPT, isDefault = true)
        val later = printer("BB", "Later", PrinterRole.RECEIPT, isDefault = true)
        val persistence = FakePersistence(PrinterSettings(printers = listOf(original, later)))
        val controller = controller(persistence, FakeTransport())
        controller.initialize()

        controller.addPrinter(
            PrinterDevice("Renamed", "AA"),
            PrinterRole.KITCHEN,
            PrinterPaperWidth.MM80,
        )

        assertEquals(listOf("AA", "BB"), controller.state.value.printers.map { it.id })
        assertEquals("Renamed", controller.state.value.printers.first().name)
        assertEquals(PrinterRole.KITCHEN, controller.state.value.printers.first().role)
        assertTrue(controller.state.value.printers.first().isDefault)
    }

    @Test
    fun `selection uses first persisted defaults and explicit kitchen fallback only`() = runTest {
        val firstReceipt = printer("R1", "Receipt one", PrinterRole.RECEIPT, true)
        val secondReceipt = printer("R2", "Receipt two", PrinterRole.RECEIPT, true)
        val kitchen = printer("K1", "Kitchen", PrinterRole.KITCHEN, true)
        val direct =
            PrinterSettingsState(printers = listOf(firstReceipt, secondReceipt, kitchen))
        val fallback =
            PrinterSettingsState(
                printers = listOf(firstReceipt, secondReceipt),
                kitchenPrintingEnabled = true,
                useReceiptPrinterForKitchen = true,
            )

        assertEquals("R1", direct.receiptPrinter?.id)
        assertEquals("K1", direct.kitchenPrinter?.id)
        assertEquals("R1", fallback.kitchenPrinter?.id)
        assertNull(fallback.copy(kitchenPrintingEnabled = false).kitchenPrinter)
    }

    @Test
    fun `edit keeps default remove does not promote and all four flags persist`() = runTest {
        val first = printer("R1", "First", PrinterRole.RECEIPT, true)
        val second = printer("R2", "Second", PrinterRole.RECEIPT, false)
        val persistence = FakePersistence(PrinterSettings(printers = listOf(first, second)))
        val controller = controller(persistence, FakeTransport())
        controller.initialize()

        controller.updatePrinter("R1", "Edited", PrinterRole.KITCHEN, PrinterPaperWidth.MM58)
        assertTrue(controller.state.value.printers.first().isDefault)
        controller.setKitchenPrintingEnabled(true)
        controller.setCashDrawerEnabled(true)
        controller.setUseReceiptPrinterForKitchen(true)
        controller.setMinimalReceiptEnabled(true)
        controller.removePrinter("R1")

        assertEquals(listOf("R2"), controller.state.value.printers.map { it.id })
        assertFalse(controller.state.value.printers.single().isDefault)
        assertTrue(persistence.current.kitchenPrintingEnabled)
        assertTrue(persistence.current.cashDrawerEnabled)
        assertTrue(persistence.current.useReceiptPrinterForKitchen)
        assertTrue(persistence.current.minimalReceiptEnabled)
    }

    @Test
    fun `scan lists paired first deduplicates excludes saved and improves unknown name`() = runTest {
        val persistence = FakePersistence(PrinterSettings(printers = listOf(printer("SAVED"))))
        val transport =
            FakeTransport(
                paired =
                    listOf(
                        PrinterDevice("Unknown", "A"),
                        PrinterDevice("Saved", "SAVED"),
                        PrinterDevice("Second", "B"),
                    ),
                scanned =
                    listOf(
                        PrinterDevice("Improved", "A"),
                        PrinterDevice("Second duplicate", "B"),
                        PrinterDevice("Third", "C"),
                    ),
            )
        val controller = controller(persistence, transport)
        controller.initialize()

        controller.startScan()

        assertEquals(listOf("A", "B", "C"), controller.state.value.discoveredDevices.map { it.address })
        assertEquals(listOf("Improved", "Second", "Third"), controller.state.value.discoveredDevices.map { it.name })
    }

    @Test
    fun `unreadable storage fails retained instead of publishing empty defaults`() = runTest {
        val persistence = FakePersistence().apply { readFailure = IllegalStateException("secret") }
        val transport = FakeTransport()
        val controller = controller(persistence, transport)

        assertSame(PrinterInitializationResult.StorageUnavailable, controller.initialize())

        assertFalse(controller.state.value.isInitialized)
        assertFalse(controller.state.value.isLoading)
        assertTrue(controller.state.value.storageError?.contains("repair secure storage") == true)
        assertEquals(0, transport.enableCalls)
    }

    @Test
    fun `test print uses the six approved calls and refuses to write after connect failure`() = runTest {
        val configured = printer("AA", "Counter")
        val persistence = FakePersistence(PrinterSettings(printers = listOf(configured)))
        val transport = FakeTransport(connectResults = ArrayDeque(listOf(true)))
        val controller = controller(persistence, transport)
        controller.initialize()

        controller.testPrint("AA", "9/16/26, 3:45 PM")

        assertEquals(TestPrintFormatter.format("Counter", "9/16/26, 3:45 PM"), transport.documents.single().second)
        assertEquals(PrinterCall.FeedAndCut, transport.documents.single().second.last())

        val failing = FakeTransport(connectResults = ArrayDeque(listOf(false, false, false, false)))
        val disconnected = controller(persistence, failing)
        disconnected.initialize()
        val failure = runCatching { disconnected.testPrint("AA", "now") }.exceptionOrNull()
        assertTrue(failure is PrinterOperationFailed)
        assertTrue(failing.documents.isEmpty())
    }

    @Test
    fun `cancellation is never converted into transport or persistence failure`() = runTest {
        val persistence = FakePersistence().apply { readFailure = CancellationException("stop") }
        val controller = controller(persistence, FakeTransport())

        val failure = runCatching { controller.initialize() }.exceptionOrNull()

        assertTrue(failure is CancellationException)
        assertTrue(controller.state.value.isLoading)
    }

    @Test
    fun `concurrent settings mutations serialize complete snapshots without losing flags`() = runTest {
        val persistence = FakePersistence()
        val controller = controller(persistence, FakeTransport())
        controller.initialize()
        val firstWriteEntered = CompletableDeferred<Unit>()
        val releaseFirstWrite = CompletableDeferred<Unit>()
        persistence.beforeWrite = { settings ->
            if (settings.kitchenPrintingEnabled && !settings.cashDrawerEnabled) {
                firstWriteEntered.complete(Unit)
                releaseFirstWrite.await()
            }
        }

        val kitchen = async { controller.setKitchenPrintingEnabled(true) }
        firstWriteEntered.await()
        val drawer = async { controller.setCashDrawerEnabled(true) }
        assertFalse(drawer.isCompleted)
        releaseFirstWrite.complete(Unit)
        kitchen.await()
        drawer.await()

        assertTrue(persistence.current.kitchenPrintingEnabled)
        assertTrue(persistence.current.cashDrawerEnabled)
        assertTrue(controller.state.value.kitchenPrintingEnabled)
        assertTrue(controller.state.value.cashDrawerEnabled)
    }

    @Test
    fun `removed printer cannot be resurrected by a late reconnect result`() = runTest {
        val persistence = FakePersistence(PrinterSettings(printers = listOf(printer("AA"))))
        val transport = FakeTransport()
        val controller = controller(persistence, transport)
        controller.initialize()
        val reconnectEntered = CompletableDeferred<Unit>()
        val releaseReconnect = CompletableDeferred<Unit>()
        transport.onConnect = {
            reconnectEntered.complete(Unit)
            releaseReconnect.await()
        }

        val reconnect = async { controller.reconnect("AA") }
        reconnectEntered.await()
        controller.removePrinter("AA")
        releaseReconnect.complete(Unit)

        assertFalse(reconnect.await())
        assertTrue(controller.state.value.printers.isEmpty())
        assertFalse(controller.state.value.connectionStatus.containsKey("AA"))
        assertEquals(emptyList<PrinterConfig>(), persistence.current.printers)
    }

    @Test
    fun `a reconnect that succeeds after removal retires its own socket`() = runTest {
        val persistence = FakePersistence(PrinterSettings(printers = listOf(printer("AA"))))
        val transport = FakeTransport()
        val controller = controller(persistence, transport)
        controller.initialize()
        val reconnectEntered = CompletableDeferred<Unit>()
        val releaseReconnect = CompletableDeferred<Unit>()
        transport.onConnect = {
            reconnectEntered.complete(Unit)
            releaseReconnect.await()
        }

        val reconnect = async { controller.reconnect("AA") }
        reconnectEntered.await()
        controller.removePrinter("AA")
        transport.disconnects.clear()
        releaseReconnect.complete(Unit)

        assertFalse(reconnect.await())
        assertEquals(listOf("AA"), transport.disconnects)
    }

    @Test
    fun `a superseded connection never closes a newer connection to the same address`() = runTest {
        val persistence = FakePersistence(PrinterSettings(printers = listOf(printer("AA"))))
        val transport = FakeTransport()
        val controller = controller(persistence, transport)
        controller.initialize()
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        transport.onConnect = {
            firstEntered.complete(Unit)
            releaseFirst.await()
        }

        val first = async { controller.reconnect("AA") }
        firstEntered.await()
        transport.onConnect = {}
        assertTrue(controller.reconnect("AA"))
        transport.disconnects.clear()
        releaseFirst.complete(Unit)

        assertFalse(first.await())
        assertEquals(emptyList<String>(), transport.disconnects)
        assertEquals(PrinterConnectionStatus.CONNECTED, controller.state.value.connectionStatus["AA"])
    }

    @Test
    fun `day closing width uses the first receipt printer regardless of its default flag`() =
        runTest {
            val nonDefault58 = printer("A", "58mm", PrinterRole.RECEIPT, isDefault = false)
                .copy(paperWidth = PrinterPaperWidth.MM58)
            val default80 = printer("B", "80mm", PrinterRole.RECEIPT, isDefault = true)

            // Source reads printers.find(role == "receipt") and ignores isDefault entirely.
            val listOrder =
                controller(
                    FakePersistence(PrinterSettings(printers = listOf(nonDefault58, default80))),
                    FakeTransport(),
                )
            listOrder.initialize()
            assertEquals(32, listOrder.receiptCharsPerLine())

            val eighty =
                controller(
                    FakePersistence(PrinterSettings(printers = listOf(default80))),
                    FakeTransport(),
                )
            eighty.initialize()
            assertEquals(48, eighty.receiptCharsPerLine())

            // No receipt printer configured falls back to 32, not 48.
            val none = controller(FakePersistence(), FakeTransport())
            none.initialize()
            assertEquals(32, none.receiptCharsPerLine())
        }

    @Test
    fun `polling reconnects a lost printer and leaves an already failed one alone`() = runTest {
        val persistence =
            FakePersistence(PrinterSettings(printers = listOf(printer("AA"), printer("BB"))))
        val transport =
            FakeTransport(
                connectResults = ArrayDeque(listOf(true)),
                defaultConnect = false,
            )
        val controller = controller(persistence, transport)
        controller.initialize()
        assertEquals(PrinterConnectionStatus.CONNECTED, controller.state.value.connectionStatus["AA"])
        assertEquals(
            PrinterConnectionStatus.DISCONNECTED,
            controller.state.value.connectionStatus["BB"],
        )

        // AA drops, BB is still unreachable and was never connected.
        val lost = controller.pollConnections()

        assertEquals(listOf("AA"), lost)
        // The already disconnected printer's status is deliberately untouched by a failed poll.
        assertEquals(
            PrinterConnectionStatus.DISCONNECTED,
            controller.state.value.connectionStatus["BB"],
        )
    }

    @Test
    fun `polling skips a printer that is already reconnecting`() = runTest {
        val persistence = FakePersistence(PrinterSettings(printers = listOf(printer("AA"))))
        val transport = FakeTransport()
        val controller = controller(persistence, transport)
        controller.initialize()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        transport.connectResults.addAll(listOf(false, false, false, false, false))
        transport.onConnect = {
            entered.complete(Unit)
            release.await()
        }

        val reconnecting = async { controller.autoReconnect("AA") }
        entered.await()
        val before = transport.connects
        assertEquals(emptyList<String>(), controller.pollConnections())
        assertEquals(before, transport.connects)

        release.complete(Unit)
        transport.onConnect = {}
        reconnecting.await()
    }

    @Test
    fun `auto reconnect uses the source backoff then fails`() = runTest {
        val persistence = FakePersistence(PrinterSettings(printers = listOf(printer("AA"))))
        val transport = FakeTransport(connectResults = ArrayDeque(listOf(true)))
        val waits = mutableListOf<Long>()
        val controller =
            PrinterSettingsController(persistence, transport, pause = { waits += it })
        controller.initialize()
        waits.clear()
        transport.connectResults.addAll(List(5) { false })

        controller.autoReconnect("AA")

        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L), waits)
        assertEquals(5, transport.connects - 1)
        assertEquals(PrinterConnectionStatus.FAILED, controller.state.value.connectionStatus["AA"])
        assertEquals(5, controller.state.value.reconnectAttempts["AA"])
    }

    @Test
    fun `a native connect during auto reconnect stops it and clears the attempt count`() = runTest {
        val persistence = FakePersistence(PrinterSettings(printers = listOf(printer("AA"))))
        val transport = FakeTransport(connectResults = ArrayDeque(listOf(true)))
        var reconnecting: PrinterSettingsController? = null
        val controller =
            PrinterSettingsController(
                persistence,
                transport,
                pause = { reconnecting?.deviceConnected("AA") },
            )
        reconnecting = controller
        controller.initialize()
        transport.connectResults.addAll(List(5) { false })

        controller.autoReconnect("AA")

        assertEquals(PrinterConnectionStatus.CONNECTED, controller.state.value.connectionStatus["AA"])
        assertNull(controller.state.value.reconnectAttempts["AA"])
        // Only the first attempt ran; the native event ended the loop.
        assertEquals(1, controller.state.value.connectionStatus.size)
    }

    @Test
    fun `a native disconnect only reconnects a printer that was connected`() = runTest {
        val persistence = FakePersistence(PrinterSettings(printers = listOf(printer("AA"))))
        val transport = FakeTransport(defaultConnect = false)
        val controller = controller(persistence, transport)
        controller.initialize()
        assertEquals(
            PrinterConnectionStatus.DISCONNECTED,
            controller.state.value.connectionStatus["AA"],
        )
        val before = transport.connects

        controller.deviceDisconnected("AA")
        assertEquals(before, transport.connects)

        // Untracked addresses are ignored entirely.
        controller.deviceConnected("ZZ")
        assertNull(controller.state.value.connectionStatus["ZZ"])
    }

    private fun controller(
        persistence: FakePersistence,
        transport: FakeTransport,
    ) = PrinterSettingsController(persistence, transport, pause = {})

    private fun printer(
        id: String,
        name: String = id,
        role: PrinterRole = PrinterRole.RECEIPT,
        isDefault: Boolean = true,
    ) = PrinterConfig(id, name, name, role, PrinterPaperWidth.MM80, isDefault)
}

private class FakePersistence(initial: PrinterSettings = PrinterSettings()) : PrinterSettingsPersistence {
    var current = initial
    var readFailure: Exception? = null
    var beforeWrite: suspend (PrinterSettings) -> Unit = {}
    val writes = mutableListOf<PrinterSettings>()

    override suspend fun read(): PrinterSettings {
        readFailure?.let { throw it }
        return current
    }

    override suspend fun write(settings: PrinterSettings) {
        beforeWrite(settings)
        current = settings
        writes += settings
    }
}

private class FakeTransport(
    val connectResults: ArrayDeque<Boolean> = ArrayDeque(),
    private val paired: List<PrinterDevice> = emptyList(),
    private val scanned: List<PrinterDevice> = emptyList(),
    private val defaultConnect: Boolean = true,
) : PrinterSettingsTransport {
    var enableCalls = 0
    var onConnect: suspend (String) -> Unit = {}
    val documents = mutableListOf<Pair<String, List<PrinterCall>>>()
    val disconnects = mutableListOf<String>()
    var connects = 0

    override suspend fun enableBluetooth() { enableCalls++ }
    override suspend fun pairedDevices() = paired
    override suspend fun scanDevices() = scanned
    override suspend fun connect(address: String): Boolean {
        connects++
        onConnect(address)
        return connectResults.removeFirstOrNull() ?: defaultConnect
    }
    override suspend fun disconnect(address: String) { disconnects += address }
    override suspend fun unpair(address: String) = Unit
    override suspend fun openCashDrawer(address: String) = Unit
    override suspend fun writeDocument(address: String, calls: List<PrinterCall>): Boolean {
        documents += address to calls
        return true
    }
}
