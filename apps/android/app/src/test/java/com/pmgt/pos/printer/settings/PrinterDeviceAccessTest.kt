package com.pmgt.pos.printer.settings

import com.pmgt.pos.printer.platform.BluetoothEnableResult
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrinterDeviceAccessTest {
    @Test
    fun `enable requests the adapter only when it is off and refusal is reported`() = runTest {
        val manager = FakeDeviceManager(enabled = false)
        var requests = 0
        val refused =
            access(manager, enable = {
                requests++
                BluetoothEnableResult.RefusedOrError
            })

        val failure = runCatching { refused.enableBluetooth() }.exceptionOrNull()
        assertTrue(failure is PrinterSettingsUnavailable)
        assertEquals(1, requests)

        manager.enabled = true
        access(manager, enable = {
            requests++
            BluetoothEnableResult.Accepted
        })
            .enableBluetooth()
        assertEquals(1, requests)
    }

    @Test
    fun `an unsupported adapter is reported instead of scanning or unpairing`() = runTest {
        val manager = FakeDeviceManager(hasAdapter = false)
        val access = access(manager)

        val failure = runCatching { access.enableBluetooth() }.exceptionOrNull()

        assertTrue(failure is PrinterSettingsUnavailable)
        assertEquals(emptyList<PrinterDevice>(), access.pairedDevices())
        assertEquals(emptyList<PrinterDevice>(), access.scanDevices())
        access.unpair("AA")
        assertTrue(manager.removedBonds.isEmpty())
    }

    @Test
    fun `refused permissions keep the source quiet outcomes`() = runTest {
        val manager = FakeDeviceManager(bonded = mutableListOf(PrinterDevice("Printer", "AA")))
        val access = access(manager, permissions = { false })

        assertEquals(emptyList<PrinterDevice>(), access.pairedDevices())
        assertEquals(emptyList<PrinterDevice>(), access.scanDevices())
        access.unpair("AA")

        assertTrue(manager.removedBonds.isEmpty())
        assertEquals(0, manager.discoveries)
    }

    @Test
    fun `scan cancels in-flight discovery and a discovery failure yields no devices`() = runTest {
        val manager =
            FakeDeviceManager(discovered = listOf(PrinterDevice("Found", "BB")))
        assertEquals(listOf(PrinterDevice("Found", "BB")), access(manager).scanDevices())
        assertEquals(1, manager.cancels)

        manager.discoveryFailure = IllegalStateException("radio busy")
        assertEquals(emptyList<PrinterDevice>(), access(manager).scanDevices())
    }

    @Test
    fun `unpair polls the paired list until the bond clears`() = runTest {
        val bonded = mutableListOf(PrinterDevice("Printer", "AA"), PrinterDevice("Other", "BB"))
        val manager = FakeDeviceManager(bonded = bonded)
        val waits = mutableListOf<Long>()
        // The bond survives the first poll, exactly as a slow Android unbond does.
        manager.onBondedRead = { if (manager.reads == 2) bonded.removeAll { it.address == "AA" } }

        access(manager, pause = { waits += it }).unpair("AA")

        assertEquals(listOf("AA"), manager.removedBonds)
        assertEquals(listOf(300L), waits)
    }

    @Test
    fun `unpair stops at the source timeout when the bond never clears`() = runTest {
        val manager = FakeDeviceManager(bonded = mutableListOf(PrinterDevice("Printer", "AA")))
        var clock = 0L
        val waits = mutableListOf<Long>()

        access(manager, pause = { waits += it; clock += it }, now = { clock }).unpair("AA")

        // Source checks the paired list, then waits, so the final poll carries past the deadline.
        assertEquals(17, waits.size)
        assertEquals(5_100L, clock)
        assertFalse(manager.bondedDevices().isEmpty())
    }

    private fun access(
        manager: FakeDeviceManager,
        enable: suspend () -> BluetoothEnableResult = { BluetoothEnableResult.Accepted },
        permissions: suspend () -> Boolean = { true },
        pause: suspend (Long) -> Unit = {},
        now: () -> Long = { 0L },
    ) = AndroidPrinterSettingsDeviceAccess(manager, enable, permissions, pause, now)
}

private class FakeDeviceManager(
    private val hasAdapter: Boolean = true,
    var enabled: Boolean = true,
    private val bonded: MutableList<PrinterDevice> = mutableListOf(),
    private val discovered: List<PrinterDevice> = emptyList(),
) : PrinterDeviceManager {
    var cancels = 0
    var discoveries = 0
    var reads = 0
    var discoveryFailure: Exception? = null
    var onBondedRead: () -> Unit = {}
    val removedBonds = mutableListOf<String>()

    override fun hasAdapter() = hasAdapter

    override fun isEnabled() = enabled

    override fun bondedDevices(): List<PrinterDevice> {
        reads++
        onBondedRead()
        return bonded.toList()
    }

    override fun cancelDiscovery() {
        cancels++
    }

    override suspend fun discover(): List<PrinterDevice> {
        discoveries++
        discoveryFailure?.let { throw it }
        return discovered
    }

    override fun removeBond(address: String) {
        removedBonds += address
    }
}
