package com.pmgt.pos.settings

import com.pmgt.pos.auth.AuthRepository
import com.pmgt.pos.auth.LockState
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.checkout.CheckoutRepository
import com.pmgt.pos.printer.settings.PrinterSettingsController
import com.pmgt.pos.sync.ResyncResult
import com.pmgt.pos.sync.SyncManager
import com.pmgt.pos.sync.SyncStatus
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

interface SettingsServer {
    suspend fun autoLockMinutes(storeId: String): Int?

    suspend fun setAutoLockMinutes(storeId: String, minutes: Int)
}

class ConvexSettingsServer(private val http: ConvexHttp) : SettingsServer {
    override suspend fun autoLockMinutes(storeId: String): Int? =
        http
            .query("screenLock:getAutoLockTimeout", buildJsonObject { put("storeId", storeId) })
            .jsonPrimitive
            .doubleOrNull
            ?.toInt()

    override suspend fun setAutoLockMinutes(storeId: String, minutes: Int) {
        http.mutation(
            "screenLock:setAutoLockTimeout",
            buildJsonObject {
                put("storeId", storeId)
                put("minutes", minutes)
            },
        )
    }
}

class SettingsController(
    private val auth: AuthRepository,
    private val lock: LockState,
    private val sync: SyncManager,
    private val checkout: CheckoutRepository,
    private val printer: PrinterSettingsController,
    private val server: SettingsServer,
    adoptedDeviceId: String,
    displayVersion: String,
    scope: CoroutineScope,
) {
    private data class LocalState(
        val autoLockMinutes: Int? = null,
        val autoLockUpdating: Boolean = false,
        val autoLockDialogVisible: Boolean = false,
    )

    private data class Owner(val user: SignedInUser, val storeId: String, val epoch: Long)

    private data class Inputs(
        val local: LocalState,
        val user: SignedInUser?,
        val sync: com.pmgt.pos.sync.SyncState,
        val deviceCode: String,
    )

    private val local = MutableStateFlow(LocalState())
    private val redactedDeviceId = redactedDeviceInfo(adoptedDeviceId)

    val state: StateFlow<SettingsUiState> =
        combine(local, auth.state, auth.sessionEpoch, sync.state, sync.deviceCode) {
            localState,
            authState,
            _,
            syncState,
            deviceCode,
            -> Inputs(localState, authState.user, syncState, deviceCode)
        }
            .combine(printer.state) { inputs, printerState ->
                val progress = inputs.sync.settingsProgress()
                SettingsUiState(
                    printerCount = printerState.printers.size,
                    syncTitle = progress.first,
                    syncSubtitle = progress.second,
                    syncBreakdown = progress.third,
                    isSyncing = inputs.sync.status == SyncStatus.Syncing,
                    canManageSettings = auth.hasPermission(SETTINGS_PERMISSION),
                    autoLockMinutes = inputs.local.autoLockMinutes,
                    autoLockUpdating = inputs.local.autoLockUpdating,
                    autoLockDialogVisible = inputs.local.autoLockDialogVisible,
                    displayVersion = displayVersion,
                    deviceCode = inputs.deviceCode,
                    storeDisplayName = inputs.user?.name ?: "—",
                    redactedDeviceId = redactedDeviceId,
                    systemStatus = SystemStatusProjection.from(inputs.sync, printerState),
                )
            }
            .stateIn(
                scope,
                SharingStarted.WhileSubscribed(5_000),
                SettingsUiState(displayVersion = displayVersion, redactedDeviceId = redactedDeviceId),
            )

    suspend fun load() {
        val owner = owner() ?: return
        val minutes = server.autoLockMinutes(owner.storeId)
        if (isCurrent(owner)) local.update { it.copy(autoLockMinutes = minutes) }
    }

    fun openAutoLock(): Boolean {
        if (!auth.hasPermission(SETTINGS_PERMISSION)) return false
        local.update { it.copy(autoLockDialogVisible = true) }
        return true
    }

    fun closeAutoLock() {
        if (!local.value.autoLockUpdating) local.update { it.copy(autoLockDialogVisible = false) }
    }

    suspend fun updateAutoLock(minutes: Int): AutoLockUpdateResult {
        require(minutes in AutoLockChoices)
        if (!auth.hasPermission(SETTINGS_PERMISSION)) return AutoLockUpdateResult.PermissionDenied
        val owner = owner() ?: return AutoLockUpdateResult.MissingStore
        local.update { it.copy(autoLockUpdating = true) }
        return try {
            server.setAutoLockMinutes(owner.storeId, minutes)
            if (!isCurrent(owner)) return AutoLockUpdateResult.StaleSession
            lock.configure(owner.user)
            if (!isCurrent(owner)) return AutoLockUpdateResult.StaleSession
            local.update {
                it.copy(
                    autoLockMinutes = minutes,
                    autoLockUpdating = false,
                    autoLockDialogVisible = false,
                )
            }
            AutoLockUpdateResult.Updated
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            local.update { it.copy(autoLockUpdating = false, autoLockDialogVisible = true) }
            AutoLockUpdateResult.Failed(failure.message ?: "Failed to update auto-lock timeout.")
        } finally {
            if (local.value.autoLockUpdating) local.update { it.copy(autoLockUpdating = false) }
        }
    }

    suspend fun refresh(): SettingsRefreshResult {
        if (!auth.hasPermission(SETTINGS_PERMISSION)) return SettingsRefreshResult.PermissionDenied
        val owner = owner() ?: return SettingsRefreshResult.StaleSession
        val before = checkout.pendingActions(owner.storeId).first()
        if (before.isNotEmpty()) {
            return SettingsRefreshResult.Unavailable(
                SettingsRefreshResult.Reason.PENDING,
                pendingActions = before.size,
            )
        }
        val result = sync.forceFullResync()
        if (!isCurrent(owner)) return SettingsRefreshResult.StaleSession
        val after = checkout.pendingActions(owner.storeId).first()
        if (after.isNotEmpty()) {
            return SettingsRefreshResult.Unavailable(
                SettingsRefreshResult.Reason.PENDING,
                pendingActions = after.size,
            )
        }
        return when (result) {
            ResyncResult.Ready -> SettingsRefreshResult.Ready
            is ResyncResult.Unavailable ->
                SettingsRefreshResult.Unavailable(
                    when (result.reason) {
                        ResyncResult.Reason.Offline -> SettingsRefreshResult.Reason.OFFLINE
                        ResyncResult.Reason.Syncing -> SettingsRefreshResult.Reason.SYNCING
                        ResyncResult.Reason.Pending -> SettingsRefreshResult.Reason.PENDING
                        ResyncResult.Reason.Failed -> SettingsRefreshResult.Reason.FAILED
                    }
                )
        }
    }

    private fun owner(): Owner? {
        val user = auth.state.value.user ?: return null
        val storeId = user.storeId ?: return null
        return Owner(user, storeId, auth.sessionEpoch.value)
    }

    private fun isCurrent(owner: Owner): Boolean {
        val current = auth.state.value.user
        return auth.sessionEpoch.value == owner.epoch &&
            current?.id == owner.user.id &&
            current.storeId == owner.storeId
    }

    private companion object {
        const val SETTINGS_PERMISSION = "system.settings"
    }
}
