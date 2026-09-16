package com.pmgt.pos.updater.platform

import android.app.job.JobParameters
import android.app.job.JobService
import androidx.annotation.RequiresApi
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

/** Scheduled only on API 36+, where user-initiated data-transfer jobs exist. */
class AndroidUpdateTransferService : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val runningJob = AtomicReference<Job?>()
    private val runningCall = AtomicReference<Call?>()

    /** The scheduler only runs this on API 36+; `setNotification` is an API 34 UIDT API. */
    @RequiresApi(34)
    override fun onStartJob(params: JobParameters): Boolean {
        val generation = params.extras.getLong(EXTRA_GENERATION, -1)
        val url = params.extras.getString(EXTRA_URL)
        val version = params.extras.getString(EXTRA_VERSION).orEmpty()
        val partialPath = params.extras.getString(EXTRA_PARTIAL)
        val completedPath = params.extras.getString(EXTRA_COMPLETED)
        if (generation < 0 || url == null || partialPath == null || completedPath == null) {
            return false
        }
        val notifier = AndroidUpdateNotifier(this)
        notifier.ensureChannels()
        setNotification(
            params,
            PROGRESS_ID,
            notifier.uidtNotification(version),
            JOB_END_NOTIFICATION_POLICY_REMOVE,
        )
        val job =
            scope.launch {
                val store = AndroidUpdateStore(this@AndroidUpdateTransferService)
                try {
                    download(
                        generation = generation,
                        url = url,
                        partial = File(partialPath),
                        completed = File(completedPath),
                        store = store,
                    )
                    jobFinished(params, false)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    if (store.isOwned(generation)) {
                        store.fail(generation)
                        UpdateTransferBus.publish(
                            com.pmgt.pos.updater.UpdateTransferEvent.Failed(
                                generation,
                                failure.message ?: "Update download failed",
                            )
                        )
                        notifier.show(com.pmgt.pos.updater.UpdateNotificationKind.FAILED, version)
                    }
                    jobFinished(params, false)
                } finally {
                    runningCall.set(null)
                    runningJob.set(null)
                }
            }
        runningJob.set(job)
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        runningCall.getAndSet(null)?.cancel()
        runningJob.getAndSet(null)?.cancel()
        return true
    }

    override fun onDestroy() {
        runningCall.getAndSet(null)?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private fun download(
        generation: Long,
        url: String,
        partial: File,
        completed: File,
        store: AndroidUpdateStore,
    ) {
        check(store.isOwned(generation)) { "Update ownership changed" }
        partial.parentFile?.mkdirs()
        var existing = partial.length()
        var request = Request.Builder().url(url).apply {
            if (existing > 0) header("Range", "bytes=$existing-")
        }.build()
        var call = HTTP.newCall(request)
        runningCall.set(call)
        var response = call.execute()
        if (existing > 0 && response.code != 206) {
            response.close()
            partial.delete()
            existing = 0
            request = Request.Builder().url(url).build()
            call = HTTP.newCall(request)
            runningCall.set(call)
            response = call.execute()
        }
        response.use { result ->
            check(result.isSuccessful) { "Update download failed (${result.code})" }
            val body = checkNotNull(result.body) { "Update download returned no data" }
            val total = body.contentLength().takeIf { it >= 0 }?.let { it + existing }
            FileOutputStream(partial, existing > 0).use { output ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var downloaded = existing
                    while (true) {
                        check(store.isOwned(generation)) { "Update ownership changed" }
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        downloaded += count
                        store.progress(generation, downloaded, total)
                        UpdateTransferBus.publish(
                            com.pmgt.pos.updater.UpdateTransferEvent.Progress(
                                generation,
                                downloaded,
                                total,
                            )
                        )
                    }
                    output.fd.sync()
                }
            }
        }
        check(store.isOwned(generation)) { "Update ownership changed" }
        completed.delete()
        check(partial.renameTo(completed)) { "Unable to finalize downloaded update" }
        store.complete(generation, completed.length())
        UpdateTransferBus.publish(
            com.pmgt.pos.updater.UpdateTransferEvent.Completed(
                generation,
                completed.absolutePath,
                completed.length(),
            )
        )
    }

    private companion object {
        val HTTP = OkHttpClient()
    }
}
