package com.pmgt.pos.updater

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

class UpdateCoordinator(
    private val backend: UpdateBackend,
    private val transfer: UpdateTransferPlatform,
    private val installer: UpdateInstaller,
    private val notifier: UpdateNotifier,
    private val currentVersion: String,
    private val variant: String,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutableState = MutableStateFlow(UpdateState())
    val state: StateFlow<UpdateState> = mutableState.asStateFlow()
    private val checkMutex = Mutex()
    private val downloadMutex = Mutex()
    private val generations = AtomicLong(0)

    init {
        scope.launch {
            transfer.events.collect { event -> accept(event) }
        }
    }

    suspend fun restore() {
        val event = transfer.restore() ?: return
        generations.updateAndGet { current -> maxOf(current, event.generation) }
        mutableState.update {
            it.copy(
                activeGeneration = event.generation,
                downloadStatus = DownloadStatus.DOWNLOADING,
            )
        }
        accept(event)
    }

    suspend fun check() {
        if (!checkMutex.tryLock()) return
        mutableState.update { it.copy(isChecking = true, error = null) }
        try {
            when (val result = backend.check(currentVersion, variant)) {
                UpdateCheckResult.None -> {
                    mutableState.update {
                        it.copy(updateInfo = null, isChecking = false, lastCheckedAt = now())
                    }
                }
                is UpdateCheckResult.Available -> {
                    val previous = state.value.updateInfo
                    mutableState.update {
                        it.copy(
                            updateInfo = result.info,
                            dialogDismissed =
                                if (previous?.latestVersion == result.info.latestVersion) {
                                    it.dialogDismissed
                                } else {
                                    false
                                },
                            isChecking = false,
                            lastCheckedAt = now(),
                        )
                    }
                    if (!result.info.isForced) {
                        notifyQuietly {
                            notifier.show(UpdateNotificationKind.AVAILABLE, result.info.latestVersion)
                        }
                    }
                }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            mutableState.update {
                it.copy(isChecking = false, error = failure.message ?: "Update check failed")
            }
        } finally {
            checkMutex.unlock()
        }
    }

    suspend fun startDownload() {
        if (!downloadMutex.tryLock()) return
        try {
            val info = state.value.updateInfo ?: return
            state.value.activeGeneration?.let { transfer.stop(it) }
            val generation = generations.incrementAndGet()
            mutableState.update {
                it.copy(
                    downloadStatus = DownloadStatus.DOWNLOADING,
                    downloadProgress = 0.0,
                    error = null,
                    downloaded = null,
                    activeGeneration = generation,
                    installState = InstallState.IDLE,
                )
            }
            try {
                val url = backend.resolveDownloadUrl(info.assetUrl)
                if (state.value.activeGeneration != generation) return
                transfer.start(UpdateTransferRequest(generation, url, info.latestVersion))
                notifyQuietly { notifier.show(UpdateNotificationKind.PROGRESS, info.latestVersion, 0) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                if (state.value.activeGeneration == generation) {
                    mutableState.update {
                        it.copy(
                            downloadStatus = DownloadStatus.FAILED,
                            error = failure.message ?: "Download failed",
                            activeGeneration = null,
                        )
                    }
                }
            }
        } finally {
            downloadMutex.unlock()
        }
    }

    suspend fun install() {
        val downloaded = state.value.downloaded ?: return
        val attempt = installer.install(downloaded)
        mutableState.update {
            when (attempt) {
                InstallAttempt.AuthorizationRequired ->
                    it.copy(installState = InstallState.AUTHORIZATION_REQUIRED)
                InstallAttempt.InstallerLaunched ->
                    it.copy(installState = InstallState.INSTALLER_LAUNCHED, error = null)
                InstallAttempt.IncompatiblePackage ->
                    it.copy(
                        installState = InstallState.INCOMPATIBLE_PACKAGE,
                        error = "Downloaded update is for a different app package.",
                    )
                InstallAttempt.IncompatibleSignature ->
                    it.copy(
                        installState = InstallState.INCOMPATIBLE_SIGNATURE,
                        error = "Downloaded update is not signed for this installed app.",
                    )
                is InstallAttempt.Failed ->
                    it.copy(installState = InstallState.FAILED, error = attempt.message)
            }
        }
    }

    fun dismiss() {
        if (state.value.updateInfo?.isForced == true) return
        mutableState.update { it.copy(dialogDismissed = true) }
    }

    suspend fun reset() {
        val generation = state.value.activeGeneration
        generations.incrementAndGet()
        if (generation != null) transfer.stop(generation)
        val checkedAt = state.value.lastCheckedAt
        mutableState.value = UpdateState(lastCheckedAt = checkedAt)
        notifyQuietly { notifier.dismissProgress() }
    }

    private suspend fun accept(event: UpdateTransferEvent) {
        if (state.value.activeGeneration != event.generation) return
        val version = state.value.updateInfo?.latestVersion.orEmpty()
        when (event) {
            is UpdateTransferEvent.Began -> Unit
            is UpdateTransferEvent.Progress -> {
                val progress =
                    event.bytesTotal
                        ?.takeIf { it > 0 }
                        ?.let { (event.bytesDownloaded.toDouble() / it).coerceIn(0.0, 1.0) }
                        ?: 0.0
                val oldBucket = (state.value.downloadProgress * 20).toInt()
                val newBucket = (progress * 20).toInt()
                mutableState.update { it.copy(downloadProgress = progress) }
                if (newBucket > oldBucket) {
                    notifyQuietly {
                        notifier.show(UpdateNotificationKind.PROGRESS, version, newBucket * 5)
                    }
                }
            }
            is UpdateTransferEvent.Completed -> {
                mutableState.update {
                    it.copy(
                        downloadStatus = DownloadStatus.COMPLETED,
                        downloadProgress = 1.0,
                        downloaded = DownloadedUpdate(event.generation, event.path, event.byteCount),
                        activeGeneration = null,
                        error = null,
                    )
                }
                notifyQuietly { notifier.dismissProgress() }
                notifyQuietly { notifier.show(UpdateNotificationKind.READY, version) }
            }
            is UpdateTransferEvent.Failed -> {
                mutableState.update {
                    it.copy(
                        downloadStatus = DownloadStatus.FAILED,
                        error = event.message,
                        activeGeneration = null,
                    )
                }
                notifyQuietly { notifier.dismissProgress() }
                notifyQuietly { notifier.show(UpdateNotificationKind.FAILED, version) }
            }
        }
    }

    /** Notifications are best effort, as the source treats them, but cancellation still wins. */
    private suspend fun notifyQuietly(block: suspend () -> Unit) {
        try {
            block()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // A dropped notification never fails an update.
        }
    }

}
