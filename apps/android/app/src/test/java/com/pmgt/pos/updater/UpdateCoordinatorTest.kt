package com.pmgt.pos.updater

import com.pmgt.pos.telemetry.RecordingTelemetry
import com.pmgt.pos.transport.ConvexException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class UpdateCoordinatorTest {
    @get:Rule val telemetry = RecordingTelemetry()

    @Test
    fun `failed check download and install are reported by stage but authorization is not`() = runTest {
        val transfer = FakeTransfer()
        val backend = FakeBackend().apply { checkFailure = ConvexException(500, "Server request failed (500)") }
        val installer = FakeInstaller(InstallAttempt.AuthorizationRequired)
        val coordinator = coordinator(transfer, installer, backend)

        coordinator.check()
        backend.checkFailure = null
        coordinator.check()
        coordinator.startDownload()
        runCurrent()
        transfer.emit(UpdateTransferEvent.Failed(coordinator.state.value.activeGeneration!!, "Storage full"))
        runCurrent()
        assertEquals(DownloadStatus.FAILED, coordinator.state.value.downloadStatus)
        transfer.restored = UpdateTransferEvent.Completed(9, "/updater/update.apk", 50)
        coordinator.restore()
        coordinator.install()
        installer.result = InstallAttempt.IncompatibleSignature
        coordinator.install()

        assertEquals(listOf("update.check", "update.download", "update.install"), telemetry.operations())
    }

    @Test
    fun `a download failure restored on reopening Software Update is not reported again`() = runTest {
        val transfer = FakeTransfer()
        transfer.restored = UpdateTransferEvent.Failed(3, "Update download was interrupted")
        val coordinator = coordinator(transfer)

        coordinator.restore()
        coordinator.restore()

        assertEquals(DownloadStatus.FAILED, coordinator.state.value.downloadStatus)
        assertEquals(emptyList<String>(), telemetry.operations())
    }

    @Test
    fun `approved forced prompt leaves Software Update usable without granting a bypass`() {
        val forced = updateInfo(isForced = true)

        assertTrue(shouldShowForcedPrompt(true, "Home", forced))
        assertFalse(shouldShowForcedPrompt(true, SOFTWARE_UPDATE_ROUTE, forced))
        assertFalse(shouldShowForcedPrompt(false, "Home", forced))
    }

    @Test
    fun `unknown length remains zero and stale generation cannot replace active download`() = runTest {
        val transfer = FakeTransfer()
        val coordinator = coordinator(transfer)
        coordinator.check()
        coordinator.startDownload()
        advanceUntilIdle()
        val generation = coordinator.state.value.activeGeneration!!

        transfer.emit(UpdateTransferEvent.Progress(generation, 20, null))
        transfer.emit(UpdateTransferEvent.Completed(generation - 1, "/wrong.apk", 5))
        advanceUntilIdle()

        assertEquals(0.0, coordinator.state.value.downloadProgress, 0.0)
        assertEquals(DownloadStatus.DOWNLOADING, coordinator.state.value.downloadStatus)
        assertNull(coordinator.state.value.downloaded)
    }

    @Test
    fun `restored completed ownership becomes installable and seeds the next generation`() = runTest {
        val transfer = FakeTransfer()
        transfer.restored = UpdateTransferEvent.Completed(41, "/updater/update-41.apk", 300)
        val coordinator = coordinator(transfer)

        coordinator.restore()
        assertEquals(DownloadStatus.COMPLETED, coordinator.state.value.downloadStatus)
        assertEquals(41L, coordinator.state.value.downloaded?.generation)

        coordinator.check()
        coordinator.startDownload()
        assertEquals(42, transfer.started.single().generation)
    }

    @Test
    fun `installer launch is recorded only as launched and authorization preserves file`() = runTest {
        val transfer = FakeTransfer()
        val installer = FakeInstaller(InstallAttempt.AuthorizationRequired)
        transfer.restored = UpdateTransferEvent.Completed(7, "/updater/update.apk", 50)
        val coordinator = coordinator(transfer, installer)
        coordinator.restore()

        coordinator.install()
        assertEquals(InstallState.AUTHORIZATION_REQUIRED, coordinator.state.value.installState)
        assertEquals("/updater/update.apk", coordinator.state.value.downloaded?.path)

        installer.result = InstallAttempt.InstallerLaunched
        coordinator.install()
        assertEquals(InstallState.INSTALLER_LAUNCHED, coordinator.state.value.installState)
        assertEquals(DownloadStatus.COMPLETED, coordinator.state.value.downloadStatus)
    }

    private fun kotlinx.coroutines.test.TestScope.coordinator(
        transfer: FakeTransfer,
        installer: FakeInstaller = FakeInstaller(InstallAttempt.InstallerLaunched),
        backend: FakeBackend = FakeBackend(),
    ) =
        UpdateCoordinator(
            backend = backend,
            transfer = transfer,
            installer = installer,
            notifier = FakeNotifier(),
            currentVersion = "3.28.2",
            variant = "development",
            scope = backgroundScope,
            now = { 1234L },
        )

    private class FakeBackend : UpdateBackend {
        var checkFailure: Exception? = null

        override suspend fun check(currentVersion: String, variant: String): UpdateCheckResult {
            checkFailure?.let { throw it }
            return UpdateCheckResult.Available(updateInfo())
        }

        override suspend fun resolveDownloadUrl(assetUrl: String) = "https://example.invalid/update.apk"
    }

    private class FakeTransfer : UpdateTransferPlatform {
        private val mutableEvents = MutableSharedFlow<UpdateTransferEvent>(extraBufferCapacity = 8)
        override val events: Flow<UpdateTransferEvent> = mutableEvents
        val started = mutableListOf<UpdateTransferRequest>()
        var restored: UpdateTransferEvent? = null

        override suspend fun start(request: UpdateTransferRequest) {
            started += request
        }

        override suspend fun stop(generation: Long) = Unit
        override suspend fun restore() = restored
        fun emit(event: UpdateTransferEvent) = check(mutableEvents.tryEmit(event))
    }

    private class FakeInstaller(var result: InstallAttempt) : UpdateInstaller {
        override suspend fun install(update: DownloadedUpdate) = result
    }

    private class FakeNotifier : UpdateNotifier {
        override suspend fun show(
            kind: UpdateNotificationKind,
            version: String,
            progressPercent: Int?,
        ) = Unit

        override suspend fun dismissProgress() = Unit
    }

    companion object {
        private fun updateInfo(isForced: Boolean = false) =
            UpdateInfo("3.28.3", "release.apk", "Fixes", isForced)
    }
}
