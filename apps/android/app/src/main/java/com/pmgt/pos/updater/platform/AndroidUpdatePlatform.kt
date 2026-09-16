package com.pmgt.pos.updater.platform

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import androidx.annotation.RequiresApi
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.pmgt.pos.BuildConfig
import com.pmgt.pos.MainActivity
import com.pmgt.pos.updater.DownloadedUpdate
import com.pmgt.pos.updater.InstallAttempt
import com.pmgt.pos.updater.UpdateInstaller
import com.pmgt.pos.updater.UpdateNotificationKind
import com.pmgt.pos.updater.UpdateNotifier
import com.pmgt.pos.updater.UpdateTransferEvent
import com.pmgt.pos.updater.UpdateTransferPlatform
import com.pmgt.pos.updater.UpdateTransferRequest
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class AndroidUpdateTransferPlatform(
    private val context: Context,
    private val scope: CoroutineScope,
) : UpdateTransferPlatform {
    private val app = context.applicationContext
    private val store = AndroidUpdateStore(app)
    private val downloadManager = app.getSystemService(DownloadManager::class.java)
    override val events: Flow<UpdateTransferEvent> = UpdateTransferBus.events

    override suspend fun start(request: UpdateTransferRequest) {
        val paths = UpdatePaths(app, request.generation)
        paths.directory.mkdirs()
        paths.partial.delete()
        paths.completed.delete()
        store.own(request.generation, request.version, mechanism())
        if (Build.VERSION.SDK_INT >= 36) {
            scheduleUidt(request, paths)
        } else {
            val androidRequest =
                DownloadManager.Request(Uri.parse(request.url))
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(true)
                    .setMimeType(APK_MIME)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN)
                    .setDestinationUri(Uri.fromFile(paths.completed))
            val id = downloadManager.enqueue(androidRequest)
            store.setDownloadManagerId(request.generation, id)
            pollDownloadManager(request.generation, id, request.version)
        }
    }

    override suspend fun stop(generation: Long) {
        if (!store.isOwned(generation)) return
        store.downloadManagerId(generation)?.let { id -> downloadManager.remove(id) }
        if (Build.VERSION.SDK_INT >= 36) {
            app.getSystemService(JobScheduler::class.java).cancel(UIDT_JOB_ID)
        }
        UpdatePaths(app, generation).partial.delete()
        UpdatePaths(app, generation).completed.delete()
        store.clear(generation)
    }

    override suspend fun restore(): UpdateTransferEvent? {
        val owned = store.snapshot() ?: return null
        val paths = UpdatePaths(app, owned.generation)
        if (owned.completed && paths.completed.isFile) {
            return UpdateTransferEvent.Completed(
                owned.generation,
                paths.completed.absolutePath,
                paths.completed.length(),
            )
        }
        owned.downloadManagerId?.let { id ->
            return queryDownloadManager(owned.generation, id)
        }
        if (Build.VERSION.SDK_INT >= 36) {
            val pending = app.getSystemService(JobScheduler::class.java).getPendingJob(UIDT_JOB_ID)
            if (pending != null) {
                return UpdateTransferEvent.Progress(
                    owned.generation,
                    paths.partial.length(),
                    owned.totalBytes,
                )
            }
        }
        return UpdateTransferEvent.Failed(owned.generation, "Update download was interrupted")
    }

    private fun mechanism() = if (Build.VERSION.SDK_INT >= 36) "uidt" else "download_manager"

    /** Only reached under the API 36 branch above; UIDT job APIs land in 34. */
    @RequiresApi(36)
    private fun scheduleUidt(request: UpdateTransferRequest, paths: UpdatePaths) {
        val extras =
            android.os.PersistableBundle().apply {
                putLong(EXTRA_GENERATION, request.generation)
                putString(EXTRA_URL, request.url)
                putString(EXTRA_VERSION, request.version)
                putString(EXTRA_PARTIAL, paths.partial.absolutePath)
                putString(EXTRA_COMPLETED, paths.completed.absolutePath)
            }
        val network =
            NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
        val job =
            JobInfo.Builder(UIDT_JOB_ID, ComponentName(app, AndroidUpdateTransferService::class.java))
                .setUserInitiated(true)
                .setRequiredNetwork(network)
                .setEstimatedNetworkBytes(UNKNOWN_SIZE_ESTIMATE, 0)
                .setExtras(extras)
                .build()
        check(app.getSystemService(JobScheduler::class.java).schedule(job) == JobScheduler.RESULT_SUCCESS) {
            "Unable to schedule update download"
        }
    }

    private fun pollDownloadManager(generation: Long, id: Long, version: String) {
        scope.launch {
            while (isActive && store.isOwned(generation)) {
                when (val event = queryDownloadManager(generation, id)) {
                    is UpdateTransferEvent.Progress -> UpdateTransferBus.publish(event)
                    is UpdateTransferEvent.Completed -> {
                        store.complete(generation, event.byteCount)
                        UpdateTransferBus.publish(event)
                        AndroidUpdateNotifier(app).show(UpdateNotificationKind.READY, version)
                        return@launch
                    }
                    is UpdateTransferEvent.Failed -> {
                        store.fail(generation)
                        UpdateTransferBus.publish(event)
                        AndroidUpdateNotifier(app).show(UpdateNotificationKind.FAILED, version)
                        return@launch
                    }
                    is UpdateTransferEvent.Began -> Unit
                }
                delay(POLL_MILLIS)
            }
        }
    }

    private fun queryDownloadManager(generation: Long, id: Long): UpdateTransferEvent {
        val query = DownloadManager.Query().setFilterById(id)
        downloadManager.query(query)?.use { cursor ->
            if (!cursor.moveToFirst()) {
                return UpdateTransferEvent.Failed(generation, "Update download is unavailable")
            }
            val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val downloaded =
                cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            val total =
                cursor
                    .getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    .takeIf { it > 0 }
            store.progress(generation, downloaded, total)
            return when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    val file = UpdatePaths(app, generation).completed
                    if (!file.isFile) {
                        UpdateTransferEvent.Failed(generation, "Downloaded update file is missing")
                    } else {
                        UpdateTransferEvent.Completed(generation, file.absolutePath, file.length())
                    }
                }
                DownloadManager.STATUS_FAILED ->
                    UpdateTransferEvent.Failed(generation, "Update download failed")
                else -> UpdateTransferEvent.Progress(generation, downloaded, total)
            }
        }
        return UpdateTransferEvent.Failed(generation, "Update download is unavailable")
    }

    private companion object {
        const val POLL_MILLIS = 750L
    }
}

class AndroidUpdateInstaller(private val context: Context) : UpdateInstaller {
    private val app = context.applicationContext

    override suspend fun install(update: DownloadedUpdate): InstallAttempt {
        val file = File(update.path)
        if (!UpdatePaths.isOwned(app, file) || !file.isFile) {
            return InstallAttempt.Failed("Downloaded update file is unavailable")
        }
        val packageManager = app.packageManager
        val archive =
            if (Build.VERSION.SDK_INT >= 33) {
                packageManager.getPackageArchiveInfo(
                    file.absolutePath,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
                )
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
            } ?: return InstallAttempt.Failed("Downloaded update is not a valid APK")
        if (archive.packageName != app.packageName) return InstallAttempt.IncompatiblePackage
        if (!signaturesCompatible(packageManager, archive)) return InstallAttempt.IncompatibleSignature
        if (!packageManager.canRequestPackageInstalls()) {
            val intent =
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${app.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (intent.resolveActivity(packageManager) == null) {
                return InstallAttempt.Failed("Unknown-source authorization is unavailable")
            }
            app.startActivity(intent)
            return InstallAttempt.AuthorizationRequired
        }
        val uri =
            FileProvider.getUriForFile(app, "${BuildConfig.APPLICATION_ID}.updater.files", file)
        val intent =
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, APK_MIME)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (intent.resolveActivity(packageManager) == null) {
            return InstallAttempt.Failed("No APK installer is available")
        }
        app.startActivity(intent)
        return InstallAttempt.InstallerLaunched
    }

    private fun signaturesCompatible(
        packageManager: PackageManager,
        archive: android.content.pm.PackageInfo,
    ): Boolean {
        val installed =
            if (Build.VERSION.SDK_INT >= 33) {
                packageManager.getPackageInfo(
                    app.packageName,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
                )
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(app.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
            }
        if (Build.VERSION.SDK_INT >= 28) {
            val current = installed.signingInfo ?: return false
            val candidate = archive.signingInfo ?: return false
            if (current.hasMultipleSigners() || candidate.hasMultipleSigners()) {
                return current.apkContentsSigners.digestSet() == candidate.apkContentsSigners.digestSet()
            }
            val currentHistory = current.signingCertificateHistory?.digestSet().orEmpty()
            val candidateHistory = candidate.signingCertificateHistory?.digestSet().orEmpty()
            return currentHistory.intersect(candidateHistory).isNotEmpty()
        }
        @Suppress("DEPRECATION")
        return installed.signatures.digestSet() == archive.signatures.digestSet()
    }

    private fun Array<android.content.pm.Signature>?.digestSet(): Set<String> =
        this.orEmpty().mapTo(linkedSetOf()) { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") {
                byte -> "%02x".format(byte)
            }
        }
}

class AndroidUpdateNotifier(private val context: Context) : UpdateNotifier {
    private val app = context.applicationContext
    private val manager = app.getSystemService(NotificationManager::class.java)

    override suspend fun show(kind: UpdateNotificationKind, version: String, progressPercent: Int?) {
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        ensureChannels()
        val contentIntent = pendingIntent(kind)
        val builder =
            NotificationCompat.Builder(app, CHANNEL_UPDATES)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentIntent(contentIntent)
                .setAutoCancel(kind != UpdateNotificationKind.PROGRESS)
                .setOnlyAlertOnce(kind == UpdateNotificationKind.PROGRESS)
        when (kind) {
            UpdateNotificationKind.AVAILABLE ->
                builder
                    .setContentTitle("Update Available")
                    .setContentText("v$version is available.")
            UpdateNotificationKind.PROGRESS ->
                builder
                    .setContentTitle("Downloading update")
                    .setContentText("v$version — ${progressPercent ?: 0}%")
                    .setProgress(100, progressPercent ?: 0, progressPercent == null)
                    .setOngoing(true)
            UpdateNotificationKind.READY ->
                builder
                    .setContentTitle("Update ready to install")
                    .setContentText("v$version downloaded. Tap to install.")
            UpdateNotificationKind.FAILED ->
                builder
                    .setContentTitle("Update download failed")
                    .setContentText("Tap to retry.")
        }
        manager.notify(if (kind == UpdateNotificationKind.PROGRESS) PROGRESS_ID else EVENT_ID, builder.build())
    }

    override suspend fun dismissProgress() {
        manager.cancel(PROGRESS_ID)
    }

    internal fun uidtNotification(version: String, progress: Int? = null) =
        NotificationCompat.Builder(app, CHANNEL_TRANSFER)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Downloading update")
            .setContentText("v$version — ${progress ?: 0}%")
            .setProgress(100, progress ?: 0, progress == null)
            .setOngoing(true)
            .setContentIntent(pendingIntent(UpdateNotificationKind.PROGRESS))
            .build()

    internal fun ensureChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_UPDATES, "Software updates", NotificationManager.IMPORTANCE_DEFAULT)
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_TRANSFER, "Update downloads", NotificationManager.IMPORTANCE_LOW)
        )
    }

    private fun pendingIntent(kind: UpdateNotificationKind): PendingIntent {
        val action =
            when (kind) {
                UpdateNotificationKind.READY -> ACTION_INSTALL
                UpdateNotificationKind.FAILED -> ACTION_FAILED
                else -> ACTION_OPEN
            }
        val intent =
            Intent(app, MainActivity::class.java)
                .setAction(action)
                .putExtra(EXTRA_NOTIFICATION_ACTION, action)
        return PendingIntent.getActivity(
            app,
            kind.ordinal,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}

class UpdateDownloadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
        val store = AndroidUpdateStore(context)
        val owned = store.snapshot() ?: return
        if (owned.downloadManagerId != id) return
        val pending = goAsync()
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
            try {
                val event = AndroidUpdateTransferPlatform(context, this).restore()
                if (event is UpdateTransferEvent.Completed) {
                    store.complete(event.generation, event.byteCount)
                    UpdateTransferBus.publish(event)
                    AndroidUpdateNotifier(context).show(UpdateNotificationKind.READY, owned.version)
                } else if (event is UpdateTransferEvent.Failed) {
                    store.fail(event.generation)
                    UpdateTransferBus.publish(event)
                    AndroidUpdateNotifier(context).show(UpdateNotificationKind.FAILED, owned.version)
                }
            } finally {
                pending.finish()
            }
        }
    }
}

internal object UpdateTransferBus {
    private val mutable = MutableSharedFlow<UpdateTransferEvent>(extraBufferCapacity = 32)
    val events = mutable.asSharedFlow()

    fun publish(event: UpdateTransferEvent) {
        mutable.tryEmit(event)
    }
}

internal data class UpdatePaths(val context: Context, val generation: Long) {
    val directory: File = File(requireNotNull(context.getExternalFilesDir(null)), "updater")
    val partial: File = File(directory, "update-$generation.apk.partial")
    val completed: File = File(directory, "update-$generation.apk")

    companion object {
        fun isOwned(context: Context, file: File): Boolean {
            val directory = File(requireNotNull(context.getExternalFilesDir(null)), "updater").canonicalFile
            val candidate = file.canonicalFile
            return candidate.parentFile == directory && candidate.name.matches(Regex("update-[0-9]+\\.apk"))
        }
    }
}

internal data class StoredTransfer(
    val generation: Long,
    val version: String,
    val mechanism: String,
    val downloadManagerId: Long?,
    val totalBytes: Long?,
    val completed: Boolean,
)

internal class AndroidUpdateStore(context: Context) {
    private val preferences =
        context.applicationContext.getSharedPreferences("kotlin_update_transfer", Context.MODE_PRIVATE)

    fun own(generation: Long, version: String, mechanism: String) {
        preferences.edit().clear().putLong("generation", generation).putString("version", version)
            .putString("mechanism", mechanism).apply()
    }

    fun isOwned(generation: Long) = preferences.getLong("generation", -1) == generation

    fun setDownloadManagerId(generation: Long, id: Long) {
        if (isOwned(generation)) preferences.edit().putLong("downloadId", id).apply()
    }

    fun downloadManagerId(generation: Long): Long? =
        if (isOwned(generation) && preferences.contains("downloadId")) {
            preferences.getLong("downloadId", -1)
        } else {
            null
        }

    fun progress(generation: Long, bytes: Long, total: Long?) {
        if (!isOwned(generation)) return
        preferences.edit().putLong("bytes", bytes).apply {
            if (total != null) putLong("total", total) else remove("total")
        }.apply()
    }

    fun complete(generation: Long, bytes: Long) {
        if (isOwned(generation)) preferences.edit().putBoolean("completed", true).putLong("bytes", bytes).apply()
    }

    fun fail(generation: Long) {
        if (isOwned(generation)) preferences.edit().putBoolean("failed", true).apply()
    }

    fun clear(generation: Long) {
        if (isOwned(generation)) preferences.edit().clear().apply()
    }

    fun snapshot(): StoredTransfer? {
        val generation = preferences.getLong("generation", -1).takeIf { it >= 0 } ?: return null
        return StoredTransfer(
            generation = generation,
            version = preferences.getString("version", "").orEmpty(),
            mechanism = preferences.getString("mechanism", "").orEmpty(),
            downloadManagerId = preferences.getLong("downloadId", -1).takeIf { it >= 0 },
            totalBytes = preferences.getLong("total", -1).takeIf { it > 0 },
            completed = preferences.getBoolean("completed", false),
        )
    }
}

internal const val APK_MIME = "application/vnd.android.package-archive"
internal const val UIDT_JOB_ID = 0x504d47
internal const val UNKNOWN_SIZE_ESTIMATE = 100L * 1024 * 1024
internal const val EXTRA_GENERATION = "generation"
internal const val EXTRA_URL = "url"
internal const val EXTRA_VERSION = "version"
internal const val EXTRA_PARTIAL = "partial"
internal const val EXTRA_COMPLETED = "completed"
internal const val EXTRA_NOTIFICATION_ACTION = "updateNotificationAction"
internal const val ACTION_OPEN = "com.pmgt.pos.UPDATE_OPEN"
internal const val ACTION_INSTALL = "com.pmgt.pos.UPDATE_INSTALL"
internal const val ACTION_FAILED = "com.pmgt.pos.UPDATE_FAILED"
internal const val CHANNEL_UPDATES = "software_updates"
internal const val CHANNEL_TRANSFER = "update_downloads"
internal const val PROGRESS_ID = 4101
internal const val EVENT_ID = 4102
