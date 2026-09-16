package com.pmgt.pos.settings

import com.pmgt.pos.browse.HideSystemBarsInDialog
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.pmgt.pos.R

@Composable
fun SettingsScreen(
    state: SettingsUiState,
    onBack: () -> Unit,
    onPrinters: () -> Unit,
    onRefreshRequested: () -> Unit,
    onUpdates: () -> Unit,
    onAutoLockRequested: () -> Unit,
    onAutoLockSelected: (Int) -> Unit,
    onAutoLockDismissed: () -> Unit,
    onSystemStatus: () -> Unit,
) {
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(Background)) {
        SettingsHeader("Settings", onBack, state.systemStatus.overall, onSystemStatus)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            SettingsRow(
                icon = SettingsGlyph.Print,
                iconColor = Brand,
                iconBackground = Color(0xFFEFF6FF),
                title = "Printers",
                subtitle = "${state.printerCount} ${if (state.printerCount == 1) "printer" else "printers"} configured",
                onClick = onPrinters,
            )
            SettingsRow(
                icon = SettingsGlyph.Refresh,
                iconColor = Red,
                iconBackground = Color(0xFFFEF2F2),
                title = state.syncTitle,
                subtitle = state.syncSubtitle,
                detail = state.syncBreakdown,
                enabled = !state.isSyncing,
                trailingProgress = state.isSyncing,
                onClick = onRefreshRequested,
            )
            SettingsRow(
                icon = SettingsGlyph.Download,
                iconColor = Brand,
                iconBackground = Color(0xFFEFF6FF),
                title = "Check for Updates",
                subtitle = "Version ${state.displayVersion}",
                onClick = onUpdates,
            )
            SettingsRow(
                icon = SettingsGlyph.Timer,
                iconColor = Color(0xFFD97706),
                iconBackground = Color(0xFFFEF3C7),
                title = "Auto-Lock After",
                subtitle =
                    autoLockLabel(state.autoLockMinutes) +
                        if (state.canManageSettings) "" else " · Requires settings access",
                enabled = true,
                contentAlpha = if (state.canManageSettings) 1f else .7f,
                onClick = onAutoLockRequested,
            )
            DeviceInfoCard(state)
        }
    }
    if (state.autoLockDialogVisible) {
        AutoLockDialog(
            selected = state.autoLockMinutes,
            updating = state.autoLockUpdating,
            onDismiss = onAutoLockDismissed,
            onSelected = onAutoLockSelected,
        )
    }
}

@Composable
private fun SettingsHeader(
    title: String,
    onBack: () -> Unit,
    overall: SettingsOverallStatus,
    onSystemStatus: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(48.dp).clickable(onClick = onBack).semantics {
                contentDescription = "Back"
                role = Role.Button
            },
            contentAlignment = Alignment.Center,
        ) {
            SettingsIcon(SettingsGlyph.Back, 24, Muted)
        }
        Text(title, Modifier.weight(1f), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink)
        val statusColor =
            when (overall) {
                SettingsOverallStatus.OK -> Green
                SettingsOverallStatus.DEGRADED -> Amber
                SettingsOverallStatus.CRITICAL -> Red
            }
        Box(
            Modifier.size(44.dp).clickable(onClick = onSystemStatus).semantics {
                contentDescription = "System status"
                role = Role.Button
            },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(14.dp).background(statusColor, CircleShape))
        }
    }
    HorizontalDivider(color = Border)
}

@Composable
private fun SettingsRow(
    icon: Int,
    iconColor: Color,
    iconBackground: Color,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    detail: String? = null,
    enabled: Boolean = true,
    contentAlpha: Float = 1f,
    trailingProgress: Boolean = false,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).background(Color.White)
            .clickable(enabled = enabled, onClick = onClick)
            .alpha(if (!enabled) .7f else contentAlpha)
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(40.dp).background(iconBackground, CircleShape), contentAlignment = Alignment.Center) {
            SettingsIcon(icon, 20, iconColor)
        }
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Ink)
            Text(subtitle, fontSize = 14.sp, color = Muted)
            detail?.let { Text(it, Modifier.padding(top = 2.dp), fontSize = 12.sp, color = Color(0xFF9CA3AF)) }
        }
        if (trailingProgress) {
            CircularProgressIndicator(Modifier.size(20.dp), color = Color(0xFF9CA3AF), strokeWidth = 2.dp)
        } else {
            SettingsIcon(SettingsGlyph.Forward, 20, Color(0xFF9CA3AF))
        }
    }
    HorizontalDivider(color = Background)
}

@Composable
private fun DeviceInfoCard(state: SettingsUiState) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
        Text(
            "DEVICE INFO",
            Modifier.padding(bottom = 8.dp),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.sp,
            color = Muted,
        )
        Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).padding(16.dp)) {
            DeviceInfoRow("Device Code", state.deviceCode.ifBlank { "—" })
            DeviceInfoRow("Store", state.storeDisplayName)
            DeviceInfoRow("Device ID", state.redactedDeviceId)
        }
    }
}

@Composable
private fun DeviceInfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 14.sp, color = Muted)
        Text(value, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Ink)
    }
}

@Composable
private fun AutoLockDialog(
    selected: Int?,
    updating: Boolean,
    onDismiss: () -> Unit,
    onSelected: (Int) -> Unit,
) {
    Dialog(
        onDismissRequest = { if (!updating) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        HideSystemBarsInDialog()
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = .4f)).clickable(
                enabled = !updating,
                onClick = onDismiss,
            ),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier.width(132.dp).heightIn(max = 560.dp)
                    .background(Color.White, RoundedCornerShape(16.dp))
                    .clickable(enabled = false) {},
            ) {
                Text(
                    "Auto-Lock After",
                    Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = Ink,
                )
                HorizontalDivider(color = Border)
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    AutoLockChoices.forEach { minutes ->
                        val isSelected = selected == minutes
                        Row(
                            Modifier.fillMaxWidth()
                                .background(if (isSelected) Color(0xFFEFF6FF) else Color.White)
                                .clickable(enabled = !updating) { onSelected(minutes) }
                                .padding(horizontal = 20.dp, vertical = 16.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                autoLockLabel(minutes),
                                fontSize = 16.sp,
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (isSelected) Brand else Ink,
                            )
                            if (isSelected) SettingsIcon(SettingsGlyph.Check, 20, Brand)
                        }
                        HorizontalDivider(color = Background)
                    }
                }
            }
        }
    }
}

private val SettingsIcons = FontFamily(Font(R.font.ionicons))

@Composable
private fun SettingsIcon(code: Int, size: Int, color: Color) {
    Text(code.toChar().toString(), fontFamily = SettingsIcons, fontSize = size.sp, color = color)
}

private object SettingsGlyph {
    const val Back = 0xf127
    const val Print = 0xf4f1
    const val Refresh = 0xf518
    const val Download = 0xf258
    const val Timer = 0xf5e1
    const val Forward = 0xf23b
    const val Check = 0xf21d
}

private val Brand = Color(0xFF0D87E1)
private val Background = Color(0xFFF3F4F6)
private val Ink = Color(0xFF111827)
private val Muted = Color(0xFF6B7280)
private val Border = Color(0xFFE5E7EB)
private val Green = Color(0xFF22C55E)
private val Amber = Color(0xFFF59E0B)
private val Red = Color(0xFFEF4444)
