package com.pmgt.pos.sync

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.auth.AuthState
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.db.*
import com.pmgt.pos.telemetry.RecordingTelemetry
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import kotlinx.serialization.encodeToString
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class StartupWorkflowTest {
    @get:Rule val telemetry = RecordingTelemetry()

    private fun database(): PosDatabase {
        val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        javaClass.getResource("/legacy-v3.sql")!!.readText().split(';').filter { it.isNotBlank() }.forEach { driver.execute(null, it, 0) }
        return PosDatabase(driver)
    }
    private fun seed(db: PosDatabase, table: String = "orders", id: String = "local", server: String = "server") {
        db.applyRemote(table, listOf(buildJsonObject { put("id", id); put("server_id", server); put("store_id", "store") }), emptyList(), emptyList())
    }
    private val emptyPage = """{"changes":{},"cursors":{},"complete":true,"timestamp":100}"""
    private fun success(value: String) = MockResponse().setBody("""{"status":"success","value":$value}""")
    private suspend fun eventually(predicate: () -> Boolean) = withTimeout(5_000) { while (!predicate()) delay(10) }

    private fun registrationFailure(entered: CountDownLatch) =
        MockResponse().setResponseCode(503).also { entered.countDown() }

    @Test fun exactOrderEvidenceStopsBeforeUnrelatedTablesFinish() = runBlocking {
        val db = database(); seed(db)
        val before = db.integrity()
        MockWebServer().use { server ->
            val paths = CopyOnWriteArrayList<String>()
            val registered = CountDownLatch(1)
            var pulls = 0
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    return when (request.path) {
                        "/sync/pull" -> if (++pulls == 1) MockResponse().setBody(
                            """{"changes":{"orders":{"created":[{"id":"local","server_id":"server","storeId":"store"}],"updated":[],"deleted":[]}},"cursors":{"orders":{"cursor":"more","isDone":false},"orderItems":{"cursor":null,"isDone":false}},"complete":false,"timestamp":100}"""
                        ) else MockResponse().setBody(emptyPage)
                        "/sync/registerDevice" -> registrationFailure(registered)
                        "/api/query" -> error("Exact pulled order evidence must not fall back to orders:get")
                        else -> MockResponse().setResponseCode(404)
                    }
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
                assertTrue(registered.await(5, TimeUnit.SECONDS))
                assertEquals(1, paths.count { it == "/sync/pull" })
                assertEquals(before, db.integrity())
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    @Test fun completedOrdersCursorStopsGlobalPullAndQueriesOnlyUnresolvedOrders() = runBlocking {
        val db = database(); seed(db)
        MockWebServer().use { server ->
            val paths = CopyOnWriteArrayList<String>()
            val registered = CountDownLatch(1)
            var pulls = 0
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    return when (request.path) {
                        "/sync/pull" -> if (++pulls == 1) MockResponse().setBody(
                            """{"changes":{"orders":{"created":[{"id":"local","server_id":"server","storeId":"other-store"}],"updated":[],"deleted":[]}},"cursors":{"orders":{"cursor":null,"isDone":true},"orderItems":{"cursor":"more","isDone":false}},"complete":false,"timestamp":100}"""
                        ) else MockResponse().setBody(emptyPage)
                        "/api/query" -> success("""{"_id":"server","storeId":"store"}""")
                        "/sync/registerDevice" -> registrationFailure(registered)
                        else -> MockResponse().setResponseCode(404)
                    }
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
                assertTrue(registered.await(5, TimeUnit.SECONDS))
                assertEquals(1, paths.count { it == "/sync/pull" })
                assertEquals(1, paths.count { it == "/api/query" })
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    @Test fun missingOrdersCursorNeverClaimsThatOrderEvidenceIsExhausted() = runBlocking {
        val db = database(); seed(db)
        MockWebServer().use { server ->
            val paths = CopyOnWriteArrayList<String>()
            val registered = CountDownLatch(1)
            var pulls = 0
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    return when (request.path) {
                        "/sync/pull" -> if (++pulls == 1) MockResponse().setBody(
                            """{"changes":{},"cursors":{"categories":{"cursor":"next","isDone":false}},"complete":false,"timestamp":100}"""
                        ) else MockResponse().setBody(
                            """{"changes":{"orders":{"created":[{"id":"local","server_id":"server","storeId":"store"}],"updated":[],"deleted":[]}},"cursors":{"orders":{"cursor":null,"isDone":true}},"complete":true,"timestamp":100}"""
                        )
                        "/sync/registerDevice" -> registrationFailure(registered)
                        "/api/query" -> error("A missing orders cursor must continue the pull, not use fallback early")
                        else -> MockResponse().setResponseCode(404)
                    }
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
                assertTrue(registered.await(5, TimeUnit.SECONDS))
                assertEquals(2, paths.count { it == "/sync/pull" })
                assertFalse(paths.contains("/api/query"))
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    @Test fun incompleteOrdersCursorContinuesUntilExactOrderEvidenceArrives() = runBlocking {
        val db = database(); seed(db)
        MockWebServer().use { server ->
            val paths = CopyOnWriteArrayList<String>()
            val registered = CountDownLatch(1)
            var pulls = 0
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    return when (request.path) {
                        "/sync/pull" -> if (++pulls == 1) MockResponse().setBody(
                            """{"changes":{},"cursors":{"orders":{"cursor":"next","isDone":false}},"complete":false,"timestamp":100}"""
                        ) else MockResponse().setBody(
                            """{"changes":{"orders":{"created":[{"id":"local","server_id":"server","storeId":"store"}],"updated":[],"deleted":[]}},"cursors":{"orders":{"cursor":null,"isDone":true}},"complete":true,"timestamp":100}"""
                        )
                        "/sync/registerDevice" -> registrationFailure(registered)
                        "/api/query" -> error("An incomplete orders cursor must continue the pull, not use fallback early")
                        else -> MockResponse().setResponseCode(404)
                    }
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
                assertTrue(registered.await(5, TimeUnit.SECONDS))
                assertEquals(2, paths.count { it == "/sync/pull" })
                assertFalse(paths.contains("/api/query"))
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    @Test fun ancillaryReferencesKeepAuthenticatedFirstPullButDoNotRequireGlobalCompletion() = runBlocking {
        val db = database(); seed(db, table = "audit_logs", id = "audit", server = "audit-server")
        MockWebServer().use { server ->
            val paths = CopyOnWriteArrayList<String>()
            val registered = CountDownLatch(1)
            var pulls = 0
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    return when (request.path) {
                        "/sync/pull" -> if (++pulls == 1) MockResponse().setBody(
                            """{"changes":{},"cursors":{"orders":{"cursor":"more","isDone":false}},"complete":false,"timestamp":100}"""
                        ) else MockResponse().setBody(emptyPage)
                        "/sync/registerDevice" -> registrationFailure(registered)
                        "/api/query" -> error("Ancillary references are preserved, not a new orders:get gate")
                        else -> MockResponse().setResponseCode(404)
                    }
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
                assertTrue(registered.await(5, TimeUnit.SECONDS))
                assertEquals(1, paths.count { it == "/sync/pull" })
                assertFalse(paths.contains("/api/query"))
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    @Test fun missingLiveOrderBlocksButOfflineVerificationStaysPendingWithoutStartingSync() = runBlocking {
        for (offline in listOf(true, false)) {
            val db = database()
            seed(db)
            db.insertLocal("orders", buildJsonObject { put("id", "unsent"); put("store_id", "store") })
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
        db.insertLocal("orders", buildJsonObject { put("id", "unsent"); put("store_id", "store") })
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

    @Test fun blockedAdoptionIsReportedButOfflineVerificationIsNot() = runBlocking {
        val db = database(); seed(db)
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = if (request.path == "/api/query") success("""{"_id":"server","storeId":"other-store"}""") else MockResponse().setBody(emptyPage)
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val http = ConvexHttp(server.url("/").toString())
            val offline = TabletStartup({ AdoptedStorage(db, "test-device") }, http, scope, Dispatchers.IO, MutableStateFlow(false))
            assertTrue(offline.adopt("user", "store") is AdoptionState.PendingVerification)
            assertEquals(emptyList<String>(), telemetry.operations())
            val missing = TabletStartup({ AdoptedStorage(db, "test-device") }, http, scope, Dispatchers.IO, MutableStateFlow(true))
            assertTrue(missing.adopt("user", "store") is AdoptionState.Blocked)
            val unreadable = TabletStartup({ throw AdoptionBlocked("Unsupported local schema version") }, http, scope, Dispatchers.IO, MutableStateFlow(true))
            assertTrue(unreadable.adopt("user", "store") is AdoptionState.Blocked)
            assertEquals(listOf("startup.adoption_blocked", "startup.adoption_blocked"), telemetry.operations())
            // The report has to be the throwable that was raised, not one rebuilt from its message:
            // a fabricated exception carries a stack pointing here instead of at the real failure.
            assertEquals(
                listOf("An existing server reference could not be resolved. Tablet data is preserved; repair the reference before continuing.", "Unsupported local schema version"),
                telemetry.nonFatals.map { it.error.message },
            )
            assertTrue(telemetry.nonFatals.all { it.error is AdoptionBlocked })
            offline.stop(); missing.stop(); unreadable.stop(); scope.cancel()
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

    /**
     * A failure with connectivity already up has no reconnection to wait for. Without a timer the
     * till parks until a human taps, which is the whole defect: it must heal on its own.
     */
    @Test fun aFailedVerificationIsRetriedOnATimerUntilItSucceeds() = runBlocking {
        val db = database(); seed(db)
        MockWebServer().use { server ->
            var pulls = 0
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                    "/sync/pull" ->
                        if (++pulls <= 2) MockResponse().setResponseCode(503)
                        else MockResponse().setBody(
                            """{"changes":{"orders":{"created":[{"id":"local","server_id":"server","storeId":"store"}],"updated":[],"deleted":[]}},"cursors":{"orders":{"cursor":null,"isDone":true}},"complete":true,"timestamp":100}"""
                        )
                    "/sync/registerDevice" -> MockResponse().setBody("""{"deviceCode":"07"}""")
                    else -> MockResponse().setBody(emptyPage)
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup(
                { AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()),
                scope, Dispatchers.IO, MutableStateFlow(true), retryDelays = listOf(20L),
            )
            try {
                startup.bind(MutableStateFlow(AuthState(user = SignedInUser("user", "Cashier", null, "store", null))))
                eventually { startup.state.value.adoption is AdoptionState.Ready }
                assertTrue("expected more than one attempt, saw $pulls", pulls > 1)
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    /** Retrying must never turn a real refusal into an accident. Both terminal states stay put. */
    @Test fun terminalRefusalsAreNeverRetried() = runBlocking {
        for (scenario in listOf("foreign", "blocked")) {
            val db = database(); seed(db)
            if (scenario == "foreign") seedStore(db, "local-store", "other-store", "Test Store A")
            MockWebServer().use { server ->
                val paths = CopyOnWriteArrayList<String>()
                server.dispatcher = object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        paths += request.path!!
                        return if (request.path == "/api/query") success("null") else MockResponse().setBody(emptyPage)
                    }
                }
                server.start()
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val startup = TabletStartup(
                    { AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()),
                    scope, Dispatchers.IO, MutableStateFlow(true), retryDelays = listOf(20L),
                )
                try {
                    startup.bind(MutableStateFlow(AuthState(user = SignedInUser("user", "Cashier", null, "store", null))))
                    val expected: (AdoptionState) -> Boolean =
                        if (scenario == "foreign") ({ it is AdoptionState.ForeignStore })
                        else ({ it is AdoptionState.Blocked })
                    eventually { expected(startup.state.value.adoption) }
                    val settled = paths.size
                    delay(200)
                    assertTrue("$scenario must stay terminal", expected(startup.state.value.adoption))
                    assertEquals("$scenario must not keep retrying", settled, paths.size)
                } finally { startup.stop(); scope.cancel() }
            }
            db.close()
        }
    }

    /**
     * The full sweep resolves every order reference by paging the whole orders table back with no
     * `since` cursor. Measured at 104 seconds on a real store. It is a one-time integrity gate, so
     * once a store has passed it a later launch spot-checks a bounded sample instead of re-paging.
     */
    @Test fun aVerifiedStoreSpotChecksInsteadOfRepagingTheWholeReplica() = runBlocking {
        val db = database()
        repeat(40) { index -> seed(db, id = "local-$index", server = "server-$index") }
        val evidence = InMemoryAdoptionEvidence()
        val pulled = (0 until 40).joinToString(",") {
            """{"id":"local-$it","server_id":"server-$it","storeId":"store"}"""
        }
        MockWebServer().use { server ->
            val paths = CopyOnWriteArrayList<String>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    return when (request.path) {
                        "/sync/pull" -> MockResponse().setBody(
                            """{"changes":{"orders":{"created":[$pulled],"updated":[],"deleted":[]}},"cursors":{"orders":{"cursor":null,"isDone":true}},"complete":true,"timestamp":100}"""
                        )
                        "/sync/registerDevice" -> MockResponse().setBody("""{"deviceCode":"07"}""")
                        "/api/query" -> {
                            // Echo the requested id back: the spot check rejects a mismatched _id.
                            val asked = Json.parseToJsonElement(request.body.clone().readUtf8())
                                .jsonObject["args"]!!.jsonObject["orderId"]!!.jsonPrimitive.content
                            success("""{"_id":"$asked","storeId":"store"}""")
                        }
                        else -> MockResponse().setBody(emptyPage)
                    }
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            fun startup() = TabletStartup(
                { AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()),
                scope, Dispatchers.IO, MutableStateFlow(true), evidence = evidence,
            )
            try {
                val first = startup()
                assertTrue(first.adopt("user", "store") is AdoptionState.Ready)
                assertTrue("the first adoption still sweeps", paths.count { it == "/sync/pull" } > 0)
                first.stop()

                paths.clear()
                val second = startup()
                assertTrue(second.adopt("user", "store") is AdoptionState.Ready)
                assertEquals("a verified store must not page the replica again", 0, paths.count { it == "/sync/pull" })
                val checks = paths.count { it == "/api/query" }
                assertTrue("expected a bounded spot check, saw $checks", checks in 1..20)
                second.stop()
            } finally { scope.cancel() }
        }
        db.close()
    }

    /**
     * An empty replica verifies trivially, so recording that as "this store passed the sweep" would
     * let the first real pull land behind evidence that was never earned. The sweep must actually
     * have run against references before it counts.
     */
    @Test fun aTriviallyEmptyReplicaDoesNotCountAsAVerifiedStore() = runBlocking {
        val db = database()
        val evidence = InMemoryAdoptionEvidence()
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) =
                    if (request.path == "/sync/registerDevice") MockResponse().setBody("""{"deviceCode":"07"}""")
                    else MockResponse().setBody(emptyPage)
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup(
                { AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()),
                scope, Dispatchers.IO, MutableStateFlow(true), evidence = evidence,
            )
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
                assertNull("an empty replica has not earned a sweep", evidence.read())
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    /**
     * References arrive in rowid order, so the tail is the newest orders. A sample that always stops
     * short of it would let a corrupted newest reference escape on every launch, forever.
     */
    @Test fun theSpotCheckAlwaysReachesTheNewestReference() = runBlocking {
        val db = database()
        repeat(40) { index -> seed(db, id = "local-$index", server = "server-$index") }
        val evidence = InMemoryAdoptionEvidence()
        evidence.write(AdoptionEvidence("store", "test-device"))
        MockWebServer().use { server ->
            val asked = CopyOnWriteArrayList<String>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.path != "/api/query") return MockResponse().setBody(emptyPage)
                    val id = Json.parseToJsonElement(request.body.clone().readUtf8())
                        .jsonObject["args"]!!.jsonObject["orderId"]!!.jsonPrimitive.content
                    asked += id
                    return success("""{"_id":"$id","storeId":"store"}""")
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup(
                { AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()),
                scope, Dispatchers.IO, MutableStateFlow(true), evidence = evidence,
            )
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
                assertTrue("the newest reference must be checked, saw $asked", asked.contains("server-39"))
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    /**
     * The spot check is an optimisation. If the lookup it relies on errors — as orders:get does
     * against some real data — adoption must fall back to the full sweep, not strand the till.
     */
    @Test fun aFailingSpotCheckFallsBackToTheFullSweep() = runBlocking {
        val db = database(); seed(db)
        val evidence = InMemoryAdoptionEvidence()
        evidence.write(AdoptionEvidence("store", "test-device"))
        MockWebServer().use { server ->
            val paths = CopyOnWriteArrayList<String>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    return when (request.path) {
                        "/api/query" -> MockResponse().setResponseCode(500)
                        "/sync/pull" -> MockResponse().setBody(
                            """{"changes":{"orders":{"created":[{"id":"local","server_id":"server","storeId":"store"}],"updated":[],"deleted":[]}},"cursors":{"orders":{"cursor":null,"isDone":true}},"complete":true,"timestamp":100}"""
                        )
                        "/sync/registerDevice" -> MockResponse().setBody("""{"deviceCode":"07"}""")
                        else -> MockResponse().setBody(emptyPage)
                    }
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup(
                { AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()),
                scope, Dispatchers.IO, MutableStateFlow(true), evidence = evidence,
            )
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
                assertTrue("a broken lookup must not stop the sweep running", paths.contains("/sync/pull"))
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    /** The spot check is a real gate: a sampled reference the server has lost still blocks. */
    @Test fun aSpotCheckStillBlocksWhenTheServerHasLostAnOrder() = runBlocking {
        val db = database()
        repeat(40) { index -> seed(db, id = "local-$index", server = "server-$index") }
        val evidence = InMemoryAdoptionEvidence()
        evidence.write(AdoptionEvidence("store", "test-device"))
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) =
                    if (request.path == "/api/query") success("null") else MockResponse().setBody(emptyPage)
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup(
                { AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()),
                scope, Dispatchers.IO, MutableStateFlow(true), evidence = evidence,
            )
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Blocked)
                assertNull(startup.sync.value)
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    private fun seedStore(db: PosDatabase, id: String, server: String, name: String) {
        db.applyRemote("stores", listOf(buildJsonObject { put("id", id); put("server_id", server); put("name", name) }), emptyList(), emptyList())
    }

    /**
     * The replica belongs to whichever store commissioned the tablet. Signing in from another store
     * cannot resolve any of its references, so the gate must say so from local evidence alone rather
     * than spend a full pull discovering it.
     */
    @Test fun aReplicaFromAnotherStoreIsRefusedWithoutTouchingTheNetwork() = runBlocking {
        val db = database(); seed(db)
        seedStore(db, "local-store", "other-store", "Test Store A")
        MockWebServer().use { server ->
            val paths = CopyOnWriteArrayList<String>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    return MockResponse().setBody(emptyPage)
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                val result = startup.adopt("user", "store")
                assertTrue("expected ForeignStore, got $result", result is AdoptionState.ForeignStore)
                val refused = result as AdoptionState.ForeignStore
                assertEquals("Test Store A", refused.localStoreName)
                assertEquals("other-store", refused.localStoreId)
                assertEquals("store", refused.expectedStoreId)
                assertEquals(0, refused.pendingLocalWork)
                assertTrue("refusal must not reach the network, saw $paths", paths.isEmpty())
                assertNull(startup.sync.value)
                assertNull(startup.database)
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    /** A tablet that has never been commissioned has no store rows; that is not a mismatch. */
    @Test fun anUncommissionedReplicaIsNotTreatedAsAForeignStore() = runBlocking {
        val db = database()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) =
                    if (request.path == "/sync/registerDevice") MockResponse().setBody("""{"deviceCode":"07"}""")
                    else MockResponse().setBody(emptyPage)
            }
            server.start()
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Ready)
            } finally { startup.stop(); scope.cancel() }
        }
        db.close()
    }

    /**
     * A cold start reaches adoption before the connectivity callback has reported a validated
     * network, so verification sees an offline flag and stops. Sync recovers on reconnection; the
     * gate must too, or the till waits on a network that arrived a second later.
     */
    @Test fun offlineVerificationRecoversWhenConnectivityArrives() = runBlocking {
        val db = database(); seed(db)
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                    "/sync/pull" -> MockResponse().setBody(
                        """{"changes":{"orders":{"created":[{"id":"local","server_id":"server","storeId":"store"}],"updated":[],"deleted":[]}},"cursors":{"orders":{"cursor":null,"isDone":true}},"complete":true,"timestamp":100}"""
                    )
                    "/sync/registerDevice" -> MockResponse().setBody("""{"deviceCode":"07"}""")
                    else -> MockResponse().setBody(emptyPage)
                }
            }
            server.start()
            val online = MutableStateFlow(false)
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp(server.url("/").toString()), scope, Dispatchers.IO, online)
            try {
                val auth = MutableStateFlow(AuthState(user = SignedInUser("user", "Cashier", null, "store", null)))
                startup.bind(auth)
                // userId is only set once adopt() is under way, so this cannot match the initial
                // state, which is already PendingVerification with verifying = false.
                eventually {
                    startup.state.value.userId == "user" &&
                        startup.state.value.adoption is AdoptionState.PendingVerification &&
                        !startup.state.value.verifying
                }
                assertNull(startup.sync.value)
                online.value = true
                eventually { startup.state.value.adoption is AdoptionState.Ready }
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

    @Test fun foreignOrUnresolvedPendingParentsAndChildrenBlockBeforeRegistration() = runBlocking {
        for (scenario in listOf("parent", "item", "modifier", "payment", "orphan")) {
            val db = database()
            val parent = buildJsonObject { put("id", "parent"); put("store_id", "other-store") }
            if (scenario == "parent") db.insertLocal("orders", parent)
            else {
                if (scenario != "orphan") db.applyRemote("orders", listOf(parent), emptyList(), emptyList())
                when (scenario) {
                    "item", "orphan" -> db.insertLocal("order_items", buildJsonObject { put("id", "child"); put("order_id", "parent") })
                    "modifier" -> {
                        db.applyRemote("order_items", listOf(buildJsonObject { put("id", "item"); put("order_id", "parent") }), emptyList(), emptyList())
                        db.insertLocal("order_item_modifiers", buildJsonObject { put("id", "child"); put("order_item_id", "item") })
                    }
                    "payment" -> db.insertLocal("order_payments", buildJsonObject { put("id", "child"); put("order_id", "parent"); put("store_id", "store") })
                }
            }
            val before = db.integrity()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp("http://127.0.0.1:1/"), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue("Scenario: $scenario", startup.adopt("user", "store") is AdoptionState.Blocked)
                assertNull(startup.sync.value)
                assertEquals(before, db.integrity())
            } finally { startup.stop(); scope.cancel(); db.close() }
        }
    }

    @Test fun matchingEnvelopeCannotHideForeignSavedRowsOrParentEvidence() = runBlocking {
        for (childOnly in listOf(false, true)) {
            val db = database()
            db.applyRemote("orders", listOf(buildJsonObject { put("id", "parent"); put("store_id", "other-store") }), emptyList(), emptyList())
            if (childOnly) db.insertLocal("order_items", buildJsonObject { put("id", "child"); put("order_id", "parent") })
            else db.insertLocal("orders", buildJsonObject { put("id", "foreign"); put("store_id", "other-store") })
            val snapshot = db.pendingChanges()
            db.acknowledge(snapshot, emptySet()) // Current pending is clean; replay must still validate its old rows.
            val encoded = syncJson.encodeToString(SavedPush("store", "test-device", snapshot, 100, "saved-mutation"))
            db.setLocalValue(SAVED_PUSH_KEY, encoded)
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp("http://127.0.0.1:1/"), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue(startup.adopt("user", "store") is AdoptionState.Blocked)
                assertNull(startup.sync.value)
                assertEquals(encoded, db.localValue(SAVED_PUSH_KEY))
            } finally { startup.stop(); scope.cancel(); db.close() }
        }
    }

    @Test fun savedRawSchemaTypesAndTombstoneEvidenceAreValidatedBeforeReady() = runBlocking {
        val corruptions = listOf(
            Triple("orders", "gross_sales", JsonPrimitive("wrong")),
            Triple("orders", "gross_sales", buildJsonObject { put("amount", 1) }),
            Triple("orders", "gross_sales", JsonNull),
            Triple("orders", "customer_name", JsonPrimitive(42)),
            Triple("orders", "customer_name", buildJsonArray { add("wrong") }),
            Triple("order_items", "is_voided", JsonPrimitive("true")),
            Triple("order_items", "is_voided", JsonPrimitive(1)),
            Triple("order_items", "is_voided", buildJsonObject { put("wrong", true) }),
        )
        for ((table, field, corrupt) in corruptions) for (deleted in listOf(false, true)) {
            val db = database()
            db.applyRemote("orders", listOf(buildJsonObject { put("id", "parent"); put("store_id", "store") }), emptyList(), emptyList())
            db.insertLocal(table, buildJsonObject { put("id", "local"); if (table == "orders") put("store_id", "store") else put("order_id", "parent") })
            if (deleted) db.deleteLocal(table, "local")
            val snapshot = db.pendingChanges()
            val damaged = if (deleted) {
                val tombstones = snapshot.deletedRows.getValue(table)
                val old = tombstones.getValue("local")
                snapshot.copy(deletedRows = snapshot.deletedRows + (table to (tombstones + ("local" to old.copy(row = JsonObject(old.row + (field to corrupt)))))))
            } else {
                val bucket = snapshot.changes.getValue(table).jsonObject
                val old = bucket.getValue("created").jsonArray.single().jsonObject
                snapshot.copy(changes = JsonObject(snapshot.changes + (table to JsonObject(bucket + ("created" to JsonArray(listOf(JsonObject(old + (field to corrupt)))))))))
            }
            val encoded = syncJson.encodeToString(SavedPush("store", "test-device", damaged, 100, "saved-mutation"))
            db.setLocalValue(SAVED_PUSH_KEY, encoded)
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup = TabletStartup({ AdoptedStorage(db, "test-device") }, ConvexHttp("http://127.0.0.1:1/"), scope, Dispatchers.IO, MutableStateFlow(true))
            try {
                assertTrue("$table.$field deleted=$deleted", startup.adopt("user", "store") is AdoptionState.Blocked)
                assertNull(startup.sync.value)
                assertEquals(encoded, db.localValue(SAVED_PUSH_KEY))
            } finally { startup.stop(); scope.cancel(); db.close() }
        }
    }
}
