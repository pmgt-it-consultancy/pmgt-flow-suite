package com.pmgt.pos.sync

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SyncWorkflowTest {
    private fun database(path: String = JdbcSqliteDriver.IN_MEMORY): PosDatabase {
        val driver = JdbcSqliteDriver(path)
        javaClass.getResource("/legacy-v3.sql")!!.readText().split(';')
            .filter { it.isNotBlank() }.forEach { driver.execute(null, it, 0) }
        return PosDatabase(driver)
    }
    private fun row(id: String, name: String = "Guest") = buildJsonObject {
        put("id", id); put("customer_name", name)
    }
    private fun page(changes: String = "{}", complete: Boolean = true, cursor: Int = 1, timestamp: Long = 100) =
        """{"changes":$changes,"cursors":{"orders":{"cursor":"$cursor","isDone":$complete}},"complete":$complete,"timestamp":$timestamp}"""
    private fun response(body: String) = MockResponse().setBody(body)
    private suspend fun eventually(predicate: () -> Boolean) = withTimeout(8_000) {
        while (!predicate()) delay(10)
    }
    private class Harness(val db: PosDatabase, workScope: CoroutineScope? = null) : AutoCloseable {
        val server = MockWebServer()
        val scope = workScope ?: CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val online = MutableStateFlow(true)
        val requests = CopyOnWriteArrayList<RecordedRequest>()
        var handler: (RecordedRequest) -> MockResponse = { MockResponse().setBody("""{"changes":{},"cursors":{},"complete":true,"timestamp":100}""") }
        init {
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests += request
                    return if (request.path == "/sync/registerDevice") MockResponse().setBody("""{"deviceCode":"07"}""") else handler(request)
                }
            }
            server.start()
        }
        val http = ConvexHttp(server.url("/").toString()).apply { freshToken = { "test-token" } }
        val sync = SyncManager(db, http, "test-device", scope, Dispatchers.IO, online)
        override fun close() { sync.stop(); scope.cancel(); server.shutdown(); db.close() }
    }

    @Test fun pagedPullUsesStableRangeAndOnlyAcknowledgesWhatWasSent() = runBlocking {
        Harness(database()).use { h ->
            h.db.insertLocal("orders", row("local"))
            var pulls = 0
            h.handler = { request ->
                if (request.path == "/sync/push") response("""{"success":true}""")
                else {
                    pulls++
                    if (pulls == 1) page("""{"orders":{"created":[{"id":"remote","server_id":"server-remote","customerName":"Remote","_creationTime":5}],"updated":[],"deleted":[]}}""", false).let(::response)
                    else {
                        // A later page must not acknowledge this unsent local change.
                        h.db.updateLocal("orders", "local", buildJsonObject { put("customer_name", "Late") })
                        response(page(timestamp = 999))
                    }
                }
            }
            h.sync.start("store")
            eventually { h.sync.state.value.lastPulledAt != null }
            assertEquals("server-remote", h.db.get("orders", "remote")!!.string("server_id"))
            assertEquals("Remote", h.db.get("orders", "remote")!!.string("customer_name"))
            assertEquals("Late", h.db.get("orders", "local")!!.string("customer_name"))
            assertEquals(1, h.db.pendingCount())
            assertEquals("100", h.db.localValue("__watermelon_last_pulled_at"))
            val pullsSent = h.requests.filter { it.path == "/sync/pull" }.map { Json.parseToJsonElement(it.body.clone().readUtf8()).jsonObject }
            assertEquals(JsonNull, pullsSent[0]["lastPulledAt"])
            assertEquals(JsonNull, pullsSent[1]["lastPulledAt"])
            assertEquals(100L, pullsSent[1]["serverNow"]!!.jsonPrimitive.long)
            val push = h.requests.single { it.path == "/sync/push" }
            assertEquals("test-device", push.getHeader("x-device-id"))
            assertEquals("Bearer test-token", push.getHeader("Authorization"))
            val sent = Json.parseToJsonElement(push.body.clone().readUtf8()).jsonObject["changes"]!!.jsonObject["orders"]!!.jsonObject["created"]!!.jsonArray.single().jsonObject
            assertEquals("Guest", sent["customerName"]!!.jsonPrimitive.content)
            assertFalse(sent.containsKey("_status"))
            assertEquals("07", h.sync.deviceCode.value)
        }
    }

    @Test fun partialRejectionAndUnsupportedWritesStayPendingAndPreventResync() = runBlocking {
        Harness(database()).use { h ->
            h.db.setLocalValue("__watermelon_last_pulled_at", "50")
            h.db.insertLocal("orders", row("accepted"))
            h.db.insertLocal("orders", row("rejected"))
            h.db.insertLocal("app_config", buildJsonObject { put("id", "counter"); put("key", "orderCounter.test"); put("value", "3") })
            h.handler = { if (it.path == "/sync/push") response("""{"rejected":[{"table":"orders","clientId":"rejected","reason":"conflict"}]}""") else response(page()) }
            h.sync.start("store")
            eventually { h.sync.state.value.status == SyncStatus.Error }
            assertEquals("synced", h.db.get("orders", "accepted")!!.string("_status"))
            assertEquals(2, h.db.pendingCount())
            assertFalse(h.sync.syncForDelivery() is SyncOutcome.Delivered)
            assertFalse(h.sync.forceFullResync() is ResyncResult.Ready)
            assertEquals("100", h.db.localValue("__watermelon_last_pulled_at"))
        }
    }

    @Test fun failedPushIsReplayedAfterRestartWithSameMutationAndPreservesNewEdits() = runBlocking {
        val path = "jdbc:sqlite:${Files.createTempFile("sync-replay", ".db")}"
        var firstPayload = ""
        Harness(database(path)).use { h ->
            h.db.insertLocal("orders", row("local", "First"))
            h.handler = { if (it.path == "/sync/push") {
                firstPayload = it.body.clone().readUtf8()
                MockResponse().setResponseCode(503)
            } else response(page()) }
            h.sync.start("store")
            eventually { h.sync.state.value.status == SyncStatus.Error }
            h.sync.stop()
            h.db.updateLocal("orders", "local", buildJsonObject { put("customer_name", "Second") })
        }
        Harness(PosDatabase(JdbcSqliteDriver(path))).use { h ->
            h.handler = { if (it.path == "/sync/push") response("""{"success":true}""") else response(page()) }
            h.sync.start("store")
            eventually { h.sync.state.value.lastPulledAt != null }
            assertEquals(firstPayload, h.requests.first { it.path == "/sync/push" }.body.clone().readUtf8())
            assertEquals("Second", h.db.get("orders", "local")!!.string("customer_name"))
            // Snapshot comparison must retain the edit made after the failed request.
            assertEquals(1, h.db.pendingCount())
            assertTrue(h.sync.syncForDelivery() is SyncOutcome.Delivered)
            assertEquals(0, h.db.pendingCount())
        }
    }

    @Test fun stopCancelsInFlightPushWithoutLateAcknowledgementAndNewSessionResumes() = runBlocking {
        Harness(database()).use { h ->
            h.db.insertLocal("orders", row("local"))
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            h.handler = { if (it.path == "/sync/push") {
                entered.countDown(); release.await(5, TimeUnit.SECONDS)
                response("""{"success":true}""")
            } else response(page()) }
            h.sync.start("store")
            assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
            val waiter = async { h.sync.syncNow() }
            delay(20)
            h.sync.stop()
            release.countDown()
            assertThrows(CancellationException::class.java) { runBlocking { waiter.await() } }
            assertEquals(1, h.db.pendingCount())
            assertNull(h.sync.state.value.lastPushedAt)
            h.sync.start("store")
            eventually { h.sync.state.value.lastPushedAt != null }
            assertEquals(0, h.db.pendingCount())
        }
    }

    @Test fun interruptionReplaysMarkerOneAndCursorLoopFailsWithoutAdvancingWatermark() = runBlocking {
        Harness(database()).use { h ->
            var calls = 0
            h.handler = { calls++; response(page(complete = false, cursor = 1)) }
            h.sync.start("store")
            eventually { h.sync.state.value.status == SyncStatus.Error }
            assertEquals(2, calls)
            assertEquals("1", h.db.localValue("__watermelon_last_pulled_at"))
            h.sync.stop()
            h.handler = { response(page()) }
            h.sync.start("store")
            eventually { h.sync.state.value.lastPulledAt != null }
            val last = h.requests.last { it.path == "/sync/pull" }
            assertEquals(JsonNull, Json.parseToJsonElement(last.body.clone().readUtf8()).jsonObject["lastPulledAt"])
        }
    }

    @Test fun progressingBacklogBeyondFiftyPagesDrainsQueuedEditsAndMergesExistingCreates() = runBlocking {
        Harness(database()).use { h ->
            h.db.insertLocal("orders", row("local", "Before"))
            var pulls = 0
            val lastPageEntered = CountDownLatch(1)
            val release = CountDownLatch(1)
            h.handler = { request ->
                if (request.path == "/sync/push") response("""{"success":true}""")
                else {
                    pulls++
                    if (pulls == 60) {
                        h.db.updateLocal("orders", "local", buildJsonObject { put("customer_name", "After") })
                        h.sync.triggerPush()
                    }
                    if (pulls == 61) { lastPageEntered.countDown(); release.await(5, TimeUnit.SECONDS) }
                    response(page(
                        if (pulls == 1) """{"orders":{"created":[{"id":"local","server_id":"server-local","customerName":"Server"}],"updated":[],"deleted":[]}}""" else "{}",
                        complete = pulls >= 61, cursor = pulls,
                    ))
                }
            }
            h.sync.start("store")
            assertTrue(withContext(Dispatchers.IO) { lastPageEntered.await(5, TimeUnit.SECONDS) })
            assertEquals("1", h.db.localValue("__watermelon_last_pulled_at"))
            val completion = async { h.sync.syncNow() }
            release.countDown()
            completion.await()
            assertTrue(pulls >= 62)
            assertEquals(0, h.db.pendingCount())
            assertEquals("After", h.db.get("orders", "local")!!.string("customer_name"))
            assertEquals("server-local", h.db.get("orders", "local")!!.string("server_id"))
            assertEquals(2, h.requests.count { it.path == "/sync/push" })
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun debouncePeriodBackoffAndReconnectRetainOneActiveFlight() = runBlocking {
        val scheduler = TestCoroutineScheduler()
        val work = CoroutineScope(SupervisorJob() + StandardTestDispatcher(scheduler))
        Harness(database(), work).use { h ->
            h.sync.start("store")
            eventually { scheduler.runCurrent(); h.sync.state.value.lastPulledAt != null }
            val baseline = h.requests.size
            h.db.insertLocal("orders", row("local"))
            h.sync.triggerPush(); h.sync.triggerPush()
            scheduler.runCurrent()
            scheduler.advanceTimeBy(499); scheduler.runCurrent()
            assertEquals(baseline, h.requests.size)
            h.handler = { if (it.path == "/sync/push") MockResponse().setResponseCode(503) else response(page()) }
            scheduler.advanceTimeBy(1)
            eventually { scheduler.runCurrent(); h.sync.state.value.status == SyncStatus.Error }
            assertTrue(h.sync.syncForDelivery() is SyncOutcome.Backoff)
            for (backoff in listOf(2_000L, 5_000L, 15_000L, 60_000L)) {
                val before = h.requests.size
                h.sync.triggerPush()
                scheduler.runCurrent()
                scheduler.advanceTimeBy(backoff - 1); scheduler.runCurrent()
                assertEquals(before, h.requests.size)
                scheduler.advanceTimeBy(1)
                eventually { scheduler.runCurrent(); h.requests.size > before && h.sync.state.value.status == SyncStatus.Error }
            }
            h.online.value = false
            scheduler.runCurrent()
            assertTrue(h.sync.syncForDelivery() is SyncOutcome.Offline)
            assertEquals(1, h.db.pendingCount())
            val disconnected = h.requests.size
            scheduler.advanceTimeBy(120_000); scheduler.runCurrent()
            assertEquals(disconnected, h.requests.size)
            h.handler = { if (it.path == "/sync/push") response("""{"success":true}""") else response(page()) }
            h.online.value = true
            eventually { scheduler.runCurrent(); h.db.pendingCount() == 0 && h.sync.state.value.status == SyncStatus.Idle }
            val connected = h.requests.size
            scheduler.advanceTimeBy(60_000)
            eventually { scheduler.runCurrent(); h.requests.size > connected && h.sync.state.value.status == SyncStatus.Idle }
            h.sync.stop()
            val stopped = h.requests.size
            scheduler.advanceTimeBy(120_000); scheduler.runCurrent()
            assertEquals(stopped, h.requests.size)
        }
    }

    @Test fun fullResyncResetsOnlyAfterSuccessfulDeliveryAndRefusesOffline() = runBlocking {
        Harness(database()).use { h ->
            h.db.setLocalValue("__watermelon_last_pulled_at", "75")
            h.handler = { if (it.path == "/sync/push") response("""{"success":true}""") else response(page()) }
            h.sync.start("store")
            eventually { h.sync.state.value.lastPulledAt != null }
            h.db.insertLocal("orders", row("local"))
            assertEquals(ResyncResult.Ready, h.sync.forceFullResync())
            assertEquals(0, h.db.pendingCount())
            val sent = h.requests.filter { it.path == "/sync/pull" }.map { Json.parseToJsonElement(it.body.clone().readUtf8()).jsonObject }
            assertEquals(75L, sent.first()["lastPulledAt"]!!.jsonPrimitive.long)
            assertEquals(JsonNull, sent.last()["lastPulledAt"])
            h.online.value = false
            eventually { h.sync.state.value.status == SyncStatus.Offline }
            assertEquals(ResyncResult.Unavailable(ResyncResult.Reason.Offline), h.sync.forceFullResync())
            assertEquals("100", h.db.localValue("__watermelon_last_pulled_at"))
        }
    }

    @Test fun editsAndRecreatedTombstoneDuringPushSurviveSerializedAcknowledgement() = runBlocking {
        val path = "jdbc:sqlite:${Files.createTempFile("sync-tombstone", ".db")}"
        var originalPayload = ""
        Harness(database(path)).use { h ->
            h.db.insertLocal("orders", row("edit", "First"))
            h.db.insertLocal("orders", row("gone")); h.db.deleteLocal("orders", "gone")
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            h.handler = { request ->
                if (request.path == "/sync/push") {
                    originalPayload = request.body.clone().readUtf8()
                    entered.countDown(); release.await(5, TimeUnit.SECONDS)
                    MockResponse().setResponseCode(503)
                } else response(page())
            }
            h.sync.start("store")
            assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
            h.db.updateLocal("orders", "edit", buildJsonObject { put("customer_name", "Second") })
            h.db.insertLocal("orders", row("gone")); h.db.deleteLocal("orders", "gone")
            release.countDown()
            eventually { h.sync.state.value.status == SyncStatus.Error }
            h.sync.stop()
        }
        Harness(PosDatabase(JdbcSqliteDriver(path))).use { h ->
            h.handler = { if (it.path == "/sync/push") response("""{"success":true}""") else response(page()) }
            h.sync.start("store")
            eventually { h.sync.state.value.lastPulledAt != null }
            assertEquals(originalPayload, h.requests.first { it.path == "/sync/push" }.body.clone().readUtf8())
            assertEquals(2, h.db.pendingCount())
            assertEquals("Second", h.db.get("orders", "edit")!!.string("customer_name"))
            assertNotNull(h.db.get("orders", "gone"))
            assertTrue(h.sync.syncForDelivery() is SyncOutcome.Delivered)
            assertNull(h.db.get("orders", "gone"))
        }
    }
}
