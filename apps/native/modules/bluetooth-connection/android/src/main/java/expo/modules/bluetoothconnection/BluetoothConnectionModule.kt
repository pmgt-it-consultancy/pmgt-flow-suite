package expo.modules.bluetoothconnection

import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BluetoothConnectionModule : Module() {
    private var receiver: BroadcastReceiver? = null

    override fun definition() = ModuleDefinition {
        Name("BluetoothConnection")

        Events("onDeviceConnected", "onDeviceDisconnected")

        OnStartObserving {
            registerReceiver()
        }

        OnStopObserving {
            unregisterReceiver()
        }
    }

    private fun registerReceiver() {
        if (receiver != null) return

        val context = appContext.reactContext?.applicationContext ?: return

        receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent?.getParcelableExtra(
                        BluetoothDevice.EXTRA_DEVICE,
                        BluetoothDevice::class.java
                    )
                } else {
                    @Suppress("DEPRECATION")
                    intent?.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                }

                val address = device?.address ?: return

                when (intent?.action) {
                    BluetoothDevice.ACTION_ACL_CONNECTED -> {
                        sendEvent("onDeviceConnected", bundleOf("address" to address))
                    }
                    BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                        sendEvent("onDeviceDisconnected", bundleOf("address" to address))
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
            addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
    }

    private fun unregisterReceiver() {
        val context = appContext.reactContext?.applicationContext ?: return
        receiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (_: IllegalArgumentException) {
                // Receiver was already unregistered
            }
        }
        receiver = null
    }
}
