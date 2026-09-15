package com.pmgt.pos

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.pmgt.pos.auth.*
import com.pmgt.pos.browse.*
import com.pmgt.pos.transport.ConvexHttp
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class RootLogoutUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun failedRevocationReturnsHomeToLoginWithoutUncaughtFailure() = logoutWorkflow(false)

    @Test fun repeatedConfirmationDoesNotOverlapLogout() = logoutWorkflow(true)

    private fun logoutWorkflow(repeatConfirmation: Boolean) {
        val release = CountDownLatch(1)
        val entered = CountDownLatch(1)
        val revocations = AtomicInteger()
        val clearedBrowseStates = AtomicInteger()
        val uncaught = CopyOnWriteArrayList<Throwable>()
        val scope =
            CoroutineScope(
                SupervisorJob() +
                    Dispatchers.Main.immediate +
                    CoroutineExceptionHandler { _, error -> uncaught.add(error) }
            )
        MockWebServer().use { server ->
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val path =
                            Json.parseToJsonElement(request.body.readUtf8())
                                .jsonObject["path"]!!
                                .jsonPrimitive
                                .content
                        if (path == "auth:signOut") {
                            if (revocations.incrementAndGet() == 1) {
                                entered.countDown()
                                check(release.await(10, TimeUnit.SECONDS))
                                return MockResponse().setResponseCode(503).setBody("offline")
                            }
                            return MockResponse().setBody("""{"status":"success","value":null}""")
                        }
                        val value =
                            when (path) {
                                "auth:signIn" ->
                                    """{"tokens":{"token":"test-access","refreshToken":"test-refresh"}}"""
                                "sessions:getCurrentUser" ->
                                    """{"_id":"user","name":"Cashier","storeId":"store","role":{"_id":"role","name":"Cashier","scopeLevel":"branch","permissions":[]}}"""
                                "screenLock:getUserHasPin" -> "false"
                                "screenLock:getAutoLockTimeout" -> "0"
                                else -> "null"
                            }
                        return MockResponse().setBody("""{"status":"success","value":$value}""")
                    }
                }
            server.start()
            val http = ConvexHttp(server.url("/").toString())
            val storage = MemorySessionStorage()
            val auth = AuthRepository(http, storage)
            val lock =
                LockState(
                    object : LockStorage {
                        override fun read() = LockSnapshot()

                        override fun write(snapshot: LockSnapshot) = Unit
                    },
                    http,
                )
            val logout = RootLogout(auth, scope)
            val repository =
                object : BrowseRepository {
                    override fun activeOrders(storeId: String) = flowOf(emptyList<OrderSummary>())

                    override fun tables(storeId: String) = flowOf(emptyList<DiningTable>())

                    override fun takeout(storeId: String, range: DayRange) =
                        emptyFlow<TakeoutLane>()

                    override fun history(storeId: String, filter: HistoryFilter) =
                        flowOf(emptyList<OrderSummary>())

                    override fun detail(storeId: String, orderId: String) =
                        flowOf<OrderDetail?>(null)
                }
            runBlocking { auth.signIn("cashier@example.com", "test-password") }
            try {
                compose.setContent {
                    PosAuthShell(auth, lock, http, configured = false) { user ->
                        PosBrowseRoot(
                            user,
                            repository,
                            flowOf(DashboardSummary(0, 0.0)),
                            "Idle",
                            false,
                            {},
                            onLogout = {
                                logout { clearedBrowseStates.incrementAndGet() }
                                Unit
                            },
                            refreshHistory = {},
                            onRoute = {},
                        )
                    }
                }
                fun confirmLogout() {
                    compose.onNodeWithText("Logout").performClick()
                    compose.onAllNodesWithText("Logout").onLast().performClick()
                }
                confirmLogout()
                assertTrue(entered.await(5, TimeUnit.SECONDS))
                if (repeatConfirmation) {
                    confirmLogout()
                    compose.waitForIdle()
                    assertEquals(
                        "Repeated confirmation must share one in-flight operation",
                        1,
                        clearedBrowseStates.get(),
                    )
                }
                release.countDown()
                compose.waitUntil(5_000) { auth.state.value.user == null }
                compose.waitUntil(5_000) { scope.coroutineContext[Job]!!.children.none() }
                compose
                    .onAllNodes(hasSetTextAction())
                    .onFirst()
                    .assertIsDisplayed()
                    .performTextInput("still-alive@example.com")
                compose
                    .onAllNodes(hasSetTextAction())
                    .onFirst()
                    .assertTextContains("still-alive@example.com")
                assertNull(runBlocking { storage.read() })
                assertNull(http.token)
                assertEquals(1, revocations.get())
                assertTrue("Root callback leaked: $uncaught", uncaught.isEmpty())
                // The same production callback must release its guard after failure.
                runBlocking { auth.signIn("cashier@example.com", "test-password") }
                compose.waitUntil(5_000) {
                    compose.onAllNodesWithText("Logout").fetchSemanticsNodes().size == 1
                }
                confirmLogout()
                compose.waitUntil(5_000) {
                    auth.state.value.user == null && scope.coroutineContext[Job]!!.children.none()
                }
                compose.onNodeWithText("Email").assertIsDisplayed()
                assertEquals(2, clearedBrowseStates.get())
                assertEquals(2, revocations.get())
                assertNull(runBlocking { storage.read() })
                assertNull(http.token)
                assertTrue(uncaught.isEmpty())
            } finally {
                release.countDown()
                scope.cancel()
            }
        }
    }
}
