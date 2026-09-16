package com.pmgt.pos.updater

import kotlinx.coroutines.flow.Flow

data class UpdateInfo(
    val latestVersion: String,
    val assetUrl: String,
    val releaseNotes: String,
    val isForced: Boolean,
)

enum class DownloadStatus { IDLE, DOWNLOADING, COMPLETED, FAILED }

data class DownloadedUpdate(
    val generation: Long,
    val path: String,
    val byteCount: Long,
)

data class UpdateState(
    val updateInfo: UpdateInfo? = null,
    val dialogDismissed: Boolean = false,
    val downloadStatus: DownloadStatus = DownloadStatus.IDLE,
    val downloadProgress: Double = 0.0,
    val isChecking: Boolean = false,
    val lastCheckedAt: Long? = null,
    val error: String? = null,
    val downloaded: DownloadedUpdate? = null,
    val activeGeneration: Long? = null,
    val installState: InstallState = InstallState.IDLE,
)

enum class InstallState {
    IDLE,
    AUTHORIZATION_REQUIRED,
    INSTALLER_LAUNCHED,
    INCOMPATIBLE_PACKAGE,
    INCOMPATIBLE_SIGNATURE,
    FAILED,
}

sealed interface UpdateCheckResult {
    data object None : UpdateCheckResult
    data class Available(val info: UpdateInfo) : UpdateCheckResult
}

interface UpdateBackend {
    suspend fun check(currentVersion: String, variant: String): UpdateCheckResult

    suspend fun resolveDownloadUrl(assetUrl: String): String
}

data class UpdateTransferRequest(
    val generation: Long,
    val url: String,
    val version: String,
)

sealed interface UpdateTransferEvent {
    val generation: Long

    data class Began(override val generation: Long, val expectedBytes: Long?) : UpdateTransferEvent

    data class Progress(
        override val generation: Long,
        val bytesDownloaded: Long,
        val bytesTotal: Long?,
    ) : UpdateTransferEvent

    data class Completed(
        override val generation: Long,
        val path: String,
        val byteCount: Long,
    ) : UpdateTransferEvent

    data class Failed(override val generation: Long, val message: String) : UpdateTransferEvent
}

interface UpdateTransferPlatform {
    val events: Flow<UpdateTransferEvent>

    suspend fun start(request: UpdateTransferRequest)

    suspend fun stop(generation: Long)

    suspend fun restore(): UpdateTransferEvent?
}

sealed interface InstallAttempt {
    data object AuthorizationRequired : InstallAttempt
    data object InstallerLaunched : InstallAttempt
    data object IncompatiblePackage : InstallAttempt
    data object IncompatibleSignature : InstallAttempt
    data class Failed(val message: String) : InstallAttempt
}

interface UpdateInstaller {
    suspend fun install(update: DownloadedUpdate): InstallAttempt
}

enum class UpdateNotificationKind { AVAILABLE, PROGRESS, READY, FAILED }

interface UpdateNotifier {
    suspend fun show(kind: UpdateNotificationKind, version: String, progressPercent: Int? = null)

    suspend fun dismissProgress()
}

enum class ForcedPromptPolicy {
    /** Exact RN behavior: forced prompt remains above the Software Update route. */
    SOURCE_OVERLAY_ALWAYS,

    /** Reserved integration option; requires the outstanding explicit user ruling. */
    EXCLUDE_UPDATES_ROUTE,
}

fun shouldShowForcedPrompt(
    authenticated: Boolean,
    currentRoute: String?,
    updateInfo: UpdateInfo?,
    policy: ForcedPromptPolicy = ForcedPromptPolicy.EXCLUDE_UPDATES_ROUTE,
): Boolean {
    if (!authenticated || updateInfo?.isForced != true) return false
    return policy == ForcedPromptPolicy.SOURCE_OVERLAY_ALWAYS || currentRoute != SOFTWARE_UPDATE_ROUTE
}

const val SOFTWARE_UPDATE_ROUTE = "SoftwareUpdate"
