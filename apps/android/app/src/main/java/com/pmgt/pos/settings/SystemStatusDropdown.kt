package com.pmgt.pos.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Source `formatLastSync`; a stale or absent sync is shown in red. */
internal fun formatLastSync(timestamp: Long?, now: Long): Pair<String, Boolean> {
    if (timestamp == null) return "Never" to true
    val seconds = (now - timestamp) / 1000
    return when {
        seconds < 10 -> "just now" to false
        seconds < 60 -> "${seconds}s ago" to false
        seconds < 300 -> "${seconds / 60}m ago" to false
        else -> "5+ min ago" to true
    }
}

private val SettingsConnectionStatus.dotColor: Color
    get() =
        when (this) {
            SettingsConnectionStatus.CONNECTED -> Color(0xFF22C55E)
            SettingsConnectionStatus.DISCONNECTED -> Color(0xFFEF4444)
            SettingsConnectionStatus.CHECKING -> Color(0xFFF59E0B)
            SettingsConnectionStatus.RECONNECTING -> Color(0xFFF59E0B)
            SettingsConnectionStatus.FAILED -> Color(0xFFEF4444)
            SettingsConnectionStatus.NOT_CONFIGURED -> Color(0xFF9CA3AF)
        }

private val SettingsConnectionStatus.label: String
    get() =
        when (this) {
            SettingsConnectionStatus.CONNECTED -> "Connected"
            SettingsConnectionStatus.DISCONNECTED -> "Offline"
            SettingsConnectionStatus.CHECKING -> "Checking..."
            SettingsConnectionStatus.RECONNECTING -> "Reconnecting..."
            SettingsConnectionStatus.FAILED -> "Connection Failed"
            SettingsConnectionStatus.NOT_CONFIGURED -> "Not configured"
        }

/**
 * Ports RN `StatusDropdown.tsx`. Anchored under the header indicator, dismissed by tapping outside.
 * Retry is offered only for a disconnected or failed line, exactly as the source does.
 */
@Composable
fun SystemStatusDropdown(
    status: SystemStatusEvidence,
    now: Long,
    onRetryServer: () -> Unit,
    onReconnectReceipt: () -> Unit,
    onReconnectKitchen: () -> Unit,
    onClose: () -> Unit,
) {
    val (lastSync, staleSync) = formatLastSync(status.lastSuccessfulSyncAt, now)
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().clickable(onClick = onClose)) {
            Column(
                Modifier.align(Alignment.TopEnd)
                    .padding(top = 8.dp, end = 16.dp)
                    .widthIn(min = 260.dp)
                    .background(Color.White, RoundedCornerShape(12.dp))
                    .padding(16.dp)
            ) {
                Text(
                    "System Status",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF111827),
                )
                Spacer(Modifier.height(8.dp))
                Column(Modifier.border(0.dp, Color(0xFFF3F4F6))) {
                    StatusRow("Server", status.server, "Retry", onRetryServer)
                    StatusRow("Receipt Printer", status.receiptPrinter, "Reconnect", onReconnectReceipt)
                    StatusRow(
                        status.kitchenPrinterLabel,
                        status.kitchenPrinter,
                        "Reconnect",
                        onReconnectKitchen,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFF3F4F6)))
                Spacer(Modifier.height(8.dp))
                Text(
                    "Last sync: $lastSync",
                    fontSize = 12.sp,
                    color = if (staleSync) Color(0xFFEF4444) else Color(0xFF9CA3AF),
                )
            }
        }
    }
}

@Composable
private fun StatusRow(
    label: String,
    status: SettingsConnectionStatus,
    retryLabel: String,
    onRetry: () -> Unit,
) {
    Column(Modifier.padding(vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(status.dotColor, CircleShape))
            Spacer(Modifier.width(8.dp))
            Text(label, Modifier.weight(1f), fontSize = 14.sp, color = Color(0xFF374151))
            Text(
                status.label,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = status.dotColor,
            )
        }
        when (status) {
            SettingsConnectionStatus.RECONNECTING ->
                RowAction("Reconnecting...", Color(0xFF9CA3AF), enabled = false) {}
            SettingsConnectionStatus.DISCONNECTED,
            SettingsConnectionStatus.FAILED ->
                RowAction(retryLabel, Color(0xFF0B6FBA), enabled = true, onClick = onRetry)
            else -> Unit
        }
    }
}

@Composable
private fun RowAction(label: String, color: Color, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.padding(start = 16.dp, top = 4.dp)
            .border(1.dp, Color(0xFFE5E7EB), RoundedCornerShape(8.dp))
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        Text(label, fontSize = 12.sp, color = color)
    }
}
