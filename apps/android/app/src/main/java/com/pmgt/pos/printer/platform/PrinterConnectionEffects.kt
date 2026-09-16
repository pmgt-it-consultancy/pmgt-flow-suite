package com.pmgt.pos.printer.platform

import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.printer.settings.PrinterSettingsController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val POLL_INTERVAL_MILLIS = 60_000L

/**
 * Ports the source's `usePrinterConnectionPolling` and `useBluetoothConnectionEvents`: a 60 second
 * poll, an immediate poll when the app returns to the foreground, and the native ACL connect and
 * disconnect events. Like the source, nothing runs until the printer store is initialized and at
 * least one printer is configured.
 */
@Composable
fun PrinterConnectionEffects(controller: PrinterSettingsController, scope: CoroutineScope) {
    val state by controller.state.collectAsStateWithLifecycle()
    val active = state.isInitialized && state.printers.isNotEmpty()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // The source starts auto-reconnect without awaiting it, so one slow printer never stalls the
    // rest of the pass.
    suspend fun poll() {
        controller.pollConnections().forEach { address ->
            scope.launch { controller.autoReconnect(address) }
        }
    }

    LaunchedEffect(active) {
        if (!active) return@LaunchedEffect
        while (true) {
            delay(POLL_INTERVAL_MILLIS)
            poll()
        }
    }

    DisposableEffect(active, lifecycleOwner) {
        if (!active) return@DisposableEffect onDispose {}
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) scope.launch { poll() }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    DisposableEffect(active, context) {
        if (!active) return@DisposableEffect onDispose {}
        val app = context.applicationContext
        val receiver =
            object : BroadcastReceiver() {
                override fun onReceive(received: Context?, intent: Intent?) {
                    val address = intent?.bluetoothDevice()?.address ?: return
                    when (intent.action) {
                        BluetoothDevice.ACTION_ACL_CONNECTED -> controller.deviceConnected(address)
                        BluetoothDevice.ACTION_ACL_DISCONNECTED ->
                            scope.launch { controller.deviceDisconnected(address) }
                    }
                }
            }
        val filter =
            IntentFilter().apply {
                addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
                addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
            }
        if (Build.VERSION.SDK_INT >= 33) {
            app.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            app.registerReceiver(receiver, filter)
        }
        onDispose { runCatching { app.unregisterReceiver(receiver) } }
    }
}

@Suppress("DEPRECATION")
private fun Intent.bluetoothDevice(): BluetoothDevice? =
    if (Build.VERSION.SDK_INT >= 33) {
        getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
    } else {
        getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
    }
