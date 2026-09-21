package com.pmgt.pos.printer.settings

import com.pmgt.pos.printer.PrinterCall
import com.pmgt.pos.printer.platform.PrinterBluetoothDevice
import com.pmgt.pos.printer.platform.PrinterBluetoothPermission
import com.pmgt.pos.printer.platform.PrinterBluetoothPlatform
import com.pmgt.pos.printer.platform.PrinterBluetoothSocket
import com.pmgt.pos.printer.platform.ClassicBluetoothPrinterTransport
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A first connect to a printer that is still being bonded fails while the OS pairing dialog is up.
 * The source re-checks the paired list, waits, and tries once more; without that a freshly paired
 * printer reports Disconnected and needs a manual Reconnect.
 */
class PrinterConnectRetryTest {
    @Test
    fun `a failed first connect retries once when the printer did pair`() = runTest {
        // Every path fails while the OS is still bonding, so the whole first connect fails.
        val platform = FlakyPlatform(failuresBeforeSuccess = PATHS_PER_CONNECT)
        val waits = mutableListOf<Long>()
        val transport =
            ClassicBluetoothPrinterSettingsTransport(
                ClassicBluetoothPrinterTransport(platform, Dispatchers.Unconfined),
                PairedAccess(listOf(PrinterDevice("XP58", "AA:BB"))),
                pause = { waits += it },
            )

        assertTrue(transport.connect("AA:BB"))
        assertEquals(PATHS_PER_CONNECT + 1, platform.connectAttempts)
        assertEquals(listOf(800L), waits)
    }

    @Test
    fun `an unpaired printer is not retried`() = runTest {
        val platform = FlakyPlatform(failuresBeforeSuccess = 5)
        val waits = mutableListOf<Long>()
        val transport =
            ClassicBluetoothPrinterSettingsTransport(
                ClassicBluetoothPrinterTransport(platform, Dispatchers.Unconfined),
                PairedAccess(emptyList()),
                pause = { waits += it },
            )

        assertFalse(transport.connect("AA:BB"))
        assertEquals(PATHS_PER_CONNECT, platform.connectAttempts)
        assertTrue(waits.isEmpty())
    }

    @Test
    fun `a first connect that succeeds never waits`() = runTest {
        val platform = FlakyPlatform(failuresBeforeSuccess = 0)
        val waits = mutableListOf<Long>()
        val transport =
            ClassicBluetoothPrinterSettingsTransport(
                ClassicBluetoothPrinterTransport(platform, Dispatchers.Unconfined),
                PairedAccess(listOf(PrinterDevice("XP58", "AA:BB"))),
                pause = { waits += it },
            )

        assertTrue(transport.connect("AA:BB"))
        assertEquals(1, platform.connectAttempts)
        assertTrue(waits.isEmpty())
    }
}

/**
 * This fake answers on both the service record and channel 1, so one settings-level connect makes
 * that many real connect attempts before reporting failure.
 */
private const val PATHS_PER_CONNECT = 2

private class PairedAccess(private val paired: List<PrinterDevice>) : PrinterSettingsDeviceAccess {
    override suspend fun enableBluetooth() = Unit
    override suspend fun pairedDevices(): List<PrinterDevice> = paired
    override suspend fun scanDevices(): List<PrinterDevice> = emptyList()
    override suspend fun unpair(address: String) = Unit
}

private class FlakyPlatform(private val failuresBeforeSuccess: Int) : PrinterBluetoothPlatform {
    var connectAttempts = 0
    override val apiLevel = 34
    override fun hasAdapter() = true
    override fun isEnabled() = true
    override fun deniedPermissions(required: List<PrinterBluetoothPermission>) =
        emptyList<PrinterBluetoothPermission>()
    override fun cancelDiscovery() = Unit
    override fun device(address: String): PrinterBluetoothDevice =
        object : PrinterBluetoothDevice {
            override fun reflectedRfcommSocket(channel: Int): PrinterBluetoothSocket? =
                if (channel == 1) socket(address) else null
            override fun serviceRecordSocket(uuid: UUID): PrinterBluetoothSocket = socket(address)
        }

    private fun socket(address: String) =
        object : PrinterBluetoothSocket {
            override val remoteAddress = address
            override fun connect() {
                connectAttempts++
                if (connectAttempts <= failuresBeforeSuccess) error("bonding in progress")
            }
            override fun write(bytes: ByteArray) = Unit
            override fun flush() = Unit
            override fun close() = Unit
        }

    @Suppress("unused") fun unusedCalls(): List<PrinterCall> = emptyList()
}
