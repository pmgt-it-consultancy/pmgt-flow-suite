package com.pmgt.pos.settings

import com.pmgt.pos.printer.settings.PrinterConnectionStatus
import com.pmgt.pos.printer.settings.PrinterRole
import com.pmgt.pos.printer.settings.PrinterSettingsState
import com.pmgt.pos.sync.SyncPhase
import com.pmgt.pos.sync.SyncState
import com.pmgt.pos.sync.SyncStatus

enum class SettingsConnectionStatus {
    CONNECTED,
    DISCONNECTED,
    CHECKING,
    RECONNECTING,
    FAILED,
    NOT_CONFIGURED,
}

enum class SettingsOverallStatus { OK, DEGRADED, CRITICAL }

data class SystemStatusEvidence(
    val server: SettingsConnectionStatus,
    val receiptPrinter: SettingsConnectionStatus,
    val kitchenPrinter: SettingsConnectionStatus,
    val kitchenPrinterLabel: String,
    val lastSuccessfulSyncAt: Long?,
    val overall: SettingsOverallStatus,
)

data class SettingsUiState(
    val printerCount: Int = 0,
    val syncTitle: String = "Refresh POS Data",
    val syncSubtitle: String = "Verify and reload downloaded POS data",
    val syncBreakdown: String? = null,
    val isSyncing: Boolean = false,
    val canManageSettings: Boolean = false,
    val autoLockMinutes: Int? = null,
    val autoLockUpdating: Boolean = false,
    val autoLockDialogVisible: Boolean = false,
    val displayVersion: String,
    val deviceCode: String = "",
    val storeDisplayName: String = "—",
    val redactedDeviceId: String = "—",
    val systemStatus: SystemStatusEvidence = SystemStatusProjection.empty,
)

sealed interface SettingsRefreshResult {
    data object Ready : SettingsRefreshResult
    data object PermissionDenied : SettingsRefreshResult
    data object StaleSession : SettingsRefreshResult
    data class Unavailable(val reason: Reason, val pendingActions: Int = 0) : SettingsRefreshResult

    enum class Reason { OFFLINE, SYNCING, PENDING, FAILED }
}

sealed interface AutoLockUpdateResult {
    data object Updated : AutoLockUpdateResult
    data object PermissionDenied : AutoLockUpdateResult
    data object MissingStore : AutoLockUpdateResult
    data object StaleSession : AutoLockUpdateResult
    data class Failed(val message: String) : AutoLockUpdateResult
}

object SystemStatusProjection {
    val empty =
        SystemStatusEvidence(
            server = SettingsConnectionStatus.CHECKING,
            receiptPrinter = SettingsConnectionStatus.NOT_CONFIGURED,
            kitchenPrinter = SettingsConnectionStatus.NOT_CONFIGURED,
            kitchenPrinterLabel = "Kitchen Printer",
            lastSuccessfulSyncAt = null,
            overall = SettingsOverallStatus.DEGRADED,
        )

    fun from(sync: SyncState, printers: PrinterSettingsState): SystemStatusEvidence {
        val server =
            when (sync.status) {
                SyncStatus.Offline -> SettingsConnectionStatus.DISCONNECTED
                SyncStatus.Error -> SettingsConnectionStatus.FAILED
                SyncStatus.Syncing -> SettingsConnectionStatus.CONNECTED
                SyncStatus.Idle ->
                    if (sync.lastPulledAt != null || sync.lastPushedAt != null) {
                        SettingsConnectionStatus.CONNECTED
                    } else {
                        SettingsConnectionStatus.CHECKING
                    }
            }
        val receipt = printers.statusFor(PrinterRole.RECEIPT)
        val dedicatedKitchen = printers.printers.any { it.role == PrinterRole.KITCHEN && it.isDefault }
        val kitchen =
            when {
                !printers.kitchenPrintingEnabled -> SettingsConnectionStatus.NOT_CONFIGURED
                dedicatedKitchen -> printers.statusFor(PrinterRole.KITCHEN)
                printers.useReceiptPrinterForKitchen -> receipt
                else -> SettingsConnectionStatus.NOT_CONFIGURED
            }
        val kitchenLabel =
            if (printers.kitchenPrintingEnabled && !dedicatedKitchen && printers.useReceiptPrinterForKitchen) {
                "Kitchen (via Receipt)"
            } else {
                "Kitchen Printer"
            }
        val configured = listOf(receipt, kitchen).filterNot { it == SettingsConnectionStatus.NOT_CONFIGURED }
        val overall =
            when {
                server == SettingsConnectionStatus.DISCONNECTED ||
                    server == SettingsConnectionStatus.FAILED ||
                    configured.any { it == SettingsConnectionStatus.FAILED } -> SettingsOverallStatus.CRITICAL
                server == SettingsConnectionStatus.CHECKING ||
                    configured.any {
                        it == SettingsConnectionStatus.DISCONNECTED ||
                            it == SettingsConnectionStatus.RECONNECTING
                    } -> SettingsOverallStatus.DEGRADED
                else -> SettingsOverallStatus.OK
            }
        return SystemStatusEvidence(
            server = server,
            receiptPrinter = receipt,
            kitchenPrinter = kitchen,
            kitchenPrinterLabel = kitchenLabel,
            lastSuccessfulSyncAt = listOfNotNull(sync.lastPulledAt, sync.lastPushedAt).maxOrNull(),
            overall = overall,
        )
    }

    private fun PrinterSettingsState.statusFor(role: PrinterRole): SettingsConnectionStatus {
        val selected = printers.firstOrNull { it.role == role && it.isDefault }
            ?: return SettingsConnectionStatus.NOT_CONFIGURED
        return when (connectionStatus[selected.id]) {
            PrinterConnectionStatus.CONNECTED -> SettingsConnectionStatus.CONNECTED
            PrinterConnectionStatus.DISCONNECTED -> SettingsConnectionStatus.DISCONNECTED
            PrinterConnectionStatus.RECONNECTING -> SettingsConnectionStatus.RECONNECTING
            PrinterConnectionStatus.FAILED -> SettingsConnectionStatus.FAILED
            null -> SettingsConnectionStatus.CHECKING
        }
    }
}

internal fun SyncState.settingsProgress(): Triple<String, String, String?> {
    if (status != SyncStatus.Syncing) {
        return Triple("Refresh POS Data", "Verify and reload downloaded POS data", null)
    }
    val value = progress
    val title =
        if (value?.phase == SyncPhase.Push) "Pushing changes…"
        else "Syncing… page ${value?.pageIndex ?: 1}"
    val subtitle =
        when {
            value == null -> "Starting…"
            value.phase == SyncPhase.Push -> "Sending pending mutations to the server"
            value.rowsApplied == 0 && value.currentTable != null ->
                "Fetching ${humanizeTable(value.currentTable)}…"
            value.rowsApplied == 0 -> "Fetching first page…"
            else -> {
                val table = value.currentTable?.let { "${humanizeTable(it)} · " }.orEmpty()
                "$table${"%,d".format(value.rowsApplied)} rows applied"
            }
        }
    val breakdown =
        value
            ?.tablesApplied
            ?.filterValues { it > 0 }
            ?.entries
            ?.sortedByDescending { it.value }
            ?.take(4)
            ?.joinToString(" · ") { "${humanizeTable(it.key)} ${"%,d".format(it.value)}" }
            ?.takeIf { it.isNotEmpty() }
    return Triple(title, subtitle, breakdown)
}

internal fun humanizeTable(value: String): String =
    value.split('_').joinToString(" ") { word ->
        word.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    }

fun redactedDeviceInfo(deviceId: String): String =
    if (deviceId.length >= 12) "${deviceId.take(8)}...${deviceId.takeLast(4)}" else "—"

val AutoLockChoices = listOf(0, 1, 2, 5, 10, 15, 30)

fun autoLockLabel(minutes: Int?): String =
    when (minutes) {
        0 -> "Disabled"
        1 -> "1 minute"
        2 -> "2 minutes"
        5, null -> "5 minutes"
        else -> "$minutes minutes"
    }
