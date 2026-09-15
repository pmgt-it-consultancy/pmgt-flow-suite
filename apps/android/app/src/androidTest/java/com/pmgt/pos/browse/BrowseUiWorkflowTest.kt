package com.pmgt.pos.browse

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.*
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.pmgt.pos.auth.*
import com.pmgt.pos.db.*
import com.pmgt.pos.sync.*
import com.pmgt.pos.transport.ConvexHttp
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class BrowseUiWorkflowTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun gatedBrowsingRetainsHistoryFiltersScrollAndPausesHiddenSubscriptions() {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val name = "browse-${UUID.randomUUID()}"
        val root = File(base.cacheDir, name).apply { mkdirs() }
        val context =
            object : ContextWrapper(base) {
                override fun getDatabasePath(name: String): File =
                    if (File(name).isAbsolute) File(name) else File(root, "databases/$name")

                override fun getSharedPreferences(prefName: String, mode: Int) =
                    base.getSharedPreferences("$name-$prefName", mode)
            }
        val db = AndroidDatabase.open(context)
        fun row(id: String, vararg fields: Pair<String, Any?>) =
            BrowseDatabaseContract.row(id, *fields)
        val today = System.currentTimeMillis()
        db.applyRemote(
            "tables",
            listOf(
                row(
                    "table",
                    "store_id" to "store",
                    "name" to "Table 1",
                    "is_active" to true,
                    "capacity" to 4,
                ),
                row(
                    "free",
                    "store_id" to "store",
                    "name" to "Table 2",
                    "is_active" to true,
                    "capacity" to 2,
                ),
            ),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "orders",
            (0 until 60).map {
                row(
                    "paid$it",
                    "store_id" to "store",
                    "status" to "paid",
                    "order_type" to "dine_in",
                    "order_number" to "H${it.toString().padStart(3,'0')}",
                    "customer_name" to "Guest",
                    "created_at" to today - it * 60_000,
                    "net_sales" to 100,
                    "gross_sales" to 100,
                    "payment_method" to "cash",
                )
            } +
                listOf(
                    row(
                        "open1",
                        "store_id" to "store",
                        "status" to "open",
                        "order_type" to "dine_in",
                        "order_number" to "D001",
                        "table_id" to "table",
                        "created_at" to today,
                        "tab_number" to 1,
                    ),
                    row(
                        "open2",
                        "store_id" to "store",
                        "status" to "open",
                        "order_type" to "dine_in",
                        "order_number" to "D002",
                        "table_id" to "table",
                        "created_at" to today,
                        "tab_number" to 2,
                    ),
                    row(
                        "takeout",
                        "store_id" to "store",
                        "status" to "paid",
                        "order_type" to "takeout",
                        "takeout_status" to "preparing",
                        "order_number" to "T001",
                        "created_at" to today,
                    ),
                ),
            emptyList(),
            emptyList(),
        )
        MockWebServer().use { server ->
            var userPin = false
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        if (request.path == "/sync/pull")
                            return MockResponse()
                                .setBody(
                                    """{"changes":{},"cursors":{},"complete":true,"timestamp":100}"""
                                )
                        if (request.path == "/sync/registerDevice")
                            return MockResponse().setBody("""{"deviceCode":"07"}""")
                        val path =
                            Json.parseToJsonElement(request.body.clone().readUtf8())
                                .jsonObject["path"]!!
                                .jsonPrimitive
                                .content
                        val value =
                            when (path) {
                                "auth:signIn" ->
                                    """{"tokens":{"token":"test-access","refreshToken":"test-refresh"}}"""
                                "sessions:getCurrentUser" ->
                                    """{"_id":"user","name":"Cashier","storeId":"store","role":{"_id":"role","name":"Cashier","scopeLevel":"branch","permissions":[]}}"""
                                "screenLock:getUserHasPin" -> userPin.toString()
                                "screenLock:getAutoLockTimeout" -> "0"
                                "orders:getDashboardSummary" ->
                                    """{"totalOrdersToday":999,"todayRevenue":123456}"""
                                else -> "null"
                            }
                        return MockResponse().setBody("""{"status":"success","value":$value}""")
                    }
                }
            server.start()
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, MemorySessionStorage())
            val lock =
                LockState(
                    object : LockStorage {
                        override fun read() = LockSnapshot()

                        override fun write(snapshot: LockSnapshot) = Unit
                    },
                    http,
                )
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val startup =
                TabletStartup(
                    { AdoptedStorage(db, DeviceIdentity.readOrCreate(context, adopting = true)) },
                    http,
                    scope,
                    Dispatchers.IO,
                    MutableStateFlow(true),
                )
            runBlocking { auth.signIn("cashier@example.com", "test-password") }
            startup.bind(auth.state)
            val local = LocalBrowseRepository(db, Dispatchers.IO)
            val activeObservers = AtomicInteger()
            val historyObservers = AtomicInteger()
            var delayHistory = false
            val repository =
                object : BrowseRepository by local {
                    override fun activeOrders(storeId: String) =
                        local
                            .activeOrders(storeId)
                            .onStart { activeObservers.incrementAndGet() }
                            .onCompletion { activeObservers.decrementAndGet() }

                    override fun history(storeId: String, filter: HistoryFilter) =
                        local
                            .history(storeId, filter)
                            .onStart {
                                historyObservers.incrementAndGet()
                                if (delayHistory) delay(2_000)
                            }
                            .onCompletion { historyObservers.decrementAndGet() }
                }
            val actions = mutableListOf<BrowseAction>()
            val summary = DashboardSource(http).observe("store")
            compose.setContent {
                PosAuthShell(auth, lock, http, configured = false, startup = startup) { user ->
                    val lockUi by lock.state.collectAsState()
                    PosBrowseRoot(
                        user,
                        repository,
                        summary,
                        "Idle",
                        lockUi.pinUserId == user.id && lockUi.userHasPin,
                        {},
                        {},
                        {},
                        {},
                        { actions += it },
                    )
                }
            }
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Past Orders").fetchSemanticsNodes().isNotEmpty()
            }
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("999").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("D001").assertHasNoClickAction()
            compose.onNodeWithTag("home-actions").assertWidthIsEqualTo(320.dp)
            compose.onNodeWithText("Lock").assertDoesNotExist()
            userPin = true
            runBlocking { lock.configure(auth.state.value.user!!) }
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Lock").fetchSemanticsNodes().isNotEmpty()
            }
            compose.runOnIdle { lock.resetConfiguration() }
            compose.onNodeWithText("Lock").assertDoesNotExist()
            capture(base, "home")
            compose.onNodeWithText("View active tables").performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Table 1").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Table 1").performClick()
            compose.onNodeWithText("Table Table 1").assertExists()
            capture(base, "table-tabs")
            compose.onNodeWithText("Tab 2").performClick()
            assertEquals(
                BrowseAction.OpenDineIn("store", "table", "Table 1", "open2"),
                actions.last(),
            )
            compose.onNodeWithContentDescription("Back").performClick()
            compose.onNodeWithText("Past Orders").performClick()
            compose.waitUntil(5_000) { historyObservers.get() == 1 && activeObservers.get() == 0 }
            compose.onNodeWithText("Last 7 Days").performClick()
            compose.onAllNodesWithText("Paid", useUnmergedTree = true).onFirst().performClick()
            compose.onNodeWithContentDescription("Search orders").performTextInput("Guest")
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("#H000").fetchSemanticsNodes().isNotEmpty()
            }
            compose
                .onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.ScrollToIndex))
                .performScrollToNode(hasText("#H030"))
            compose.onNodeWithText("#H030").assertIsDisplayed().performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Order #H030").fetchSemanticsNodes().isNotEmpty()
            }
            compose.waitUntil(5_000) { historyObservers.get() == 0 }
            compose.onNodeWithText("Reprint").assertExists()
            capture(base, "history-detail")
            compose.onNodeWithContentDescription("Back").performClick()
            compose.waitUntil(5_000) { historyObservers.get() == 1 }
            compose.onNodeWithText("Last 7 Days").assertIsSelected()
            compose.onNodeWithContentDescription("Search orders").assertTextEquals("Guest")
            compose.onNodeWithText("#H030").assertIsDisplayed()
            capture(base, "history-return")
            delayHistory = true
            compose.onNodeWithText("Yesterday").performClick()
            compose.onNodeWithText("#H030").assertDoesNotExist()
            compose.onNodeWithContentDescription("Back").performClick()
            compose.onNodeWithText("Create takeout order").performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("T001").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("View Receipt").performClick()
            compose.onNodeWithText("Order Details").assertExists()
            compose.onNodeWithTag("takeout-detail").assertWidthIsEqualTo(1152.dp)
            capture(base, "takeout-detail")
            compose.onNodeWithText("Close").performClick()
            compose.onNodeWithContentDescription("Previous day").performClick()
            compose.onNodeWithText("Yesterday").assertExists()
            compose.onNodeWithText("Today").performClick()
            compose.onNodeWithContentDescription("Next day").assertIsNotEnabled()
            startup.stop()
            scope.cancel()
        }
        db.close()
    }

    private fun capture(context: Context, name: String) {
        compose.waitForIdle()
        val directory = File(context.getExternalFilesDir(null), "task6").apply { mkdirs() }
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val screenshot = File(directory, "$name.png")
        device.takeScreenshot(screenshot)
        device.executeShellCommand("cp ${screenshot.absolutePath} /sdcard/Download/task6-$name.png")
    }
}
