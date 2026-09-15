package com.pmgt.pos.sync

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.auth.AuthState
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.db.*
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class StartupWorkflowTest {
    private fun database(): PosDatabase {
        val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        javaClass.getResource("/legacy-v3.sql")!!.readText().split(';').filter { it.isNotBlank() }.forEach { driver.execute(null, it, 0) }
        return PosDatabase(driver)
    }
    private fun seed(db: PosDatabase, table: String = "orders", id: String = "local", server: String = "server") {
        db.applyRemote(table, listOf(buildJsonObject { put("id", id); put("server_id", server) }), emptyList(), emptyList())
    }
    private val emptyPage = """{"changes":{},"cursors":{},"complete":true,"timestamp":100}"""
    private fun success(value: String) = MockResponse().setBody("""{"status":"success","value":$value}""")
    private suspend fun eventually(predicate: () -> Boolean) = withTimeout(5_000) { while (!predicate()) delay(10) }

    @Test fun missingLiveOrderBlocksButOfflineVerificationStaysPendingWithoutStartingSync() = runBlocking {
        for (offline in listOf(true, false)) {
            val db = database()
            seed(db)
            db.insertLocal("orders", buildJsonObject { put("id", "unsent") })
            val before = db.integrity()
            MockWebServer().use { server ->
                val paths = CopyOnWriteArrayList<String>()
                server.dispatcher = object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        paths += request.path!!
                        return if (offline) MockResponse().setResponseCode(503)
                        else if (request.path == "/api/query") success("null") else MockResponse().setBody(emptyPage)
                    }
                }
                server.start()
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
                val result = startup.adopt("user", "store")
                assertTrue(if (offline) result is AdoptionState.PendingVerification else result is AdoptionState.Blocked)
                assertNull(startup.sync.value)
                assertFalse(paths.contains("/sync/registerDevice"))
                assertFalse(paths.contains("/sync/push"))
                assertEquals(before, db.integrity())
                startup.stop(); scope.cancel()
            }
            db.close()
        }
    }

    @Test fun resolvedLiveOrdersAllowAdoptionWhileUnsentAndRetiredAncillaryRowsArePreserved() = runBlocking {
        val db = database()
        seed(db)
        seed(db, id = "deleted", server = "deleted-server"); db.deleteLocal("orders", "deleted")
        seed(db, table = "audit_logs", id = "audit", server = "audit-server")
        db.insertLocal("orders", buildJsonObject { put("id", "unsent") })
        MockWebServer().use { server ->
            val requests = CopyOnWriteArrayList<RecordedRequest>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests += request
                    return when (request.path) {
                        "/api/query" -> {
                            val args = Json.parseToJsonElement(request.body.clone().readUtf8()).jsonObject
                            assertEquals("orders:get", args["path"]!!.jsonPrimitive.content)
                            if (args["args"]!!.jsonObject["orderId"]!!.jsonPrimitive.content == "server")
                                success("""{"_id":"server","storeId":"store"}""") else success("null")
                        }
                        "/sync/registerDevice" -> MockResponse().setBody("""{"deviceCode":"07"}""")
                        "/sync/push" -> MockResponse().setResponseCode(503)
                        else -> MockResponse().setBody(emptyPage)
                    }
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
            eventually { startup.sync.value?.state?.value?.status == SyncStatus.Error }
            assertEquals(2, db.pendingCount())
            assertEquals("audit-server", db.get("audit_logs", "audit")!!.string("server_id"))
            val queried = requests.filter { it.path == "/api/query" }.map {
                Json.parseToJsonElement(it.body.clone().readUtf8()).jsonObject["args"]!!.jsonObject["orderId"]!!.jsonPrimitive.content
            }
            assertEquals(setOf("server", "deleted-server"), queried.toSet())
            assertFalse(queried.contains("unsent"))
            startup.stop(); scope.cancel()
        }
        db.close()
    }

    @Test fun wrongStoreAndLocalIntegrityFailureNeverOpenSellingGate() = runBlocking {
        val db = database(); seed(db)
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = if (request.path == "/api/query") success("""{"_id":"server","storeId":"other-store"}""") else MockResponse().setBody(emptyPage)
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val http = ConvexHttp(server.url("/").toString())
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, http, scope, Dispatchers.IO, MutableStateFlow(true))
            assertTrue(startup.adopt("user", "store") is AdoptionState.Blocked)
            assertNull(startup.database)
            val invalid = TabletStartup({ throw AdoptionBlocked("Unsupported local schema version") }, http, scope, Dispatchers.IO, MutableStateFlow(true))
            assertTrue(invalid.adopt("user", "store") is AdoptionState.Blocked)
            assertNull(invalid.sync.value)
            startup.stop(); invalid.stop(); scope.cancel()
        }
        db.close()
    }

    @Test fun authSignoutCancelsVerificationAndCannotPublishOldSessionReadiness() = runBlocking {
        val db = database(); seed(db)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        MockWebServer().use { server ->
            val paths = CopyOnWriteArrayList<String>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    entered.countDown(); release.await(5, TimeUnit.SECONDS)
                    return MockResponse().setBody(emptyPage)
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            val auth = MutableStateFlow(AuthState(user = SignedInUser("user", "Cashier", null, "store", null)))
            startup.bind(auth)
            assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
            auth.value = AuthState()
            eventually { startup.state.value.userId == null }
            release.countDown()
            delay(40)
            assertTrue(startup.state.value.adoption is AdoptionState.PendingVerification)
            assertNull(startup.sync.value)
            assertFalse(paths.contains("/sync/registerDevice"))
            assertFalse(paths.contains("/sync/push"))
            startup.stop(); scope.cancel()
        }
        db.close()
    }

    @Test fun deletedDuplicateCannotHideMissingLiveOrderReference() = runBlocking {
        val db = database()
        seed(db, id = "live", server = "shared-server")
        seed(db, id = "deleted", server = "shared-server")
        db.deleteLocal("orders", "deleted")
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = if (request.path == "/api/query") success("null") else MockResponse().setBody(emptyPage)
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Blocked)
                assertNull(startup.sync.value)
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    @Test fun damagedSavedPushBlocksBeforeAdvertisingAdoptionReady() = runBlocking {
        val db = database()
        db.setLocalValue("__kotlin_sync_retry_v1", "damaged-pending-snapshot")
        val before = db.integrity()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp("http://127.0.0.1:1/"), scope, Dispatchers.IO, MutableStateFlow(true))
        try {
            assertTrue(startup.adopt("user", "store") is AdoptionState.Blocked)
            assertNull(startup.sync.value)
            assertEquals(before, db.integrity())
        } finally { startup.stop(); scope.cancel(); db.close() }
    }
}
