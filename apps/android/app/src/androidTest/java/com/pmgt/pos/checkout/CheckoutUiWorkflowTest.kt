package com.pmgt.pos.checkout

import android.content.Context
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.browse.*
import com.pmgt.pos.catalog.LocalCatalogRepository
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import com.pmgt.pos.transport.ConvexHttp
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.flowOf
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CheckoutUiWorkflowTest {
    @get:Rule val compose = createComposeRule()

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val context = ApplicationProvider.getApplicationContext<Context>()
        val device =
            androidx.test.uiautomator.UiDevice.getInstance(
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            )
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .uiAutomation
            .waitForIdle(500, 5000)
        val file = java.io.File(context.getExternalFilesDir(null), "checkout-synthetic-$name.png")
        check(device.takeScreenshot(file))
        device.executeShellCommand(
            "cp ${file.absolutePath} /sdcard/Download/checkout-synthetic-$name.png"
        )
    }

    @Test
    fun laterIsScopedAcrossLockAndMarkersAndDoesNotStarveNextOwnedIntent() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val driver = CheckoutFaultDriver(AndroidSqliteDriver(LegacySqlSchema, context, null))
        val db = PosDatabase(driver)
        val owner = CheckoutDatabaseContract.owner
        val ids = runBlocking {
            List(2) {
                    val id = CheckoutDatabaseContract.seed(db)
                    driver.failTable = "tables"
                    driver.successfulWrites = 0
                    assertTrue(
                        runCatching {
                                LocalCheckoutRepository(db, Dispatchers.IO, { owner })
                                    .settle(
                                        owner,
                                        CheckoutRoute(id, "dine_in", "t", "Table 1"),
                                        listOf(PaymentLine(cashReceived = "300")),
                                        "Cashier",
                                    )
                            }
                            .isFailure
                    )
                    id
                }
                .sorted()
        }
        val repo = LocalCheckoutRepository(db, Dispatchers.IO, { owner })
        val hidden = mutableStateOf(false)
        val epoch = mutableLongStateOf(0)
        val currentRoute = AtomicReference("")
        compose.setContent {
            val scope = rememberCoroutineScope()
            val sessions = remember(epoch.longValue) { CheckoutSessions(scope) }
            DisposableEffect(sessions) { onDispose { sessions.clear() } }
            if (hidden.value) Text("Locked fixture")
            else
                key(epoch.longValue) {
                    PosBrowseRoot(
                        SignedInUser(owner.userId, "Cashier", null, "s", null),
                        remember { LocalBrowseRepository(db, Dispatchers.IO) },
                        flowOf(null),
                        "",
                        false,
                        {},
                        {},
                        {},
                        { currentRoute.set(it) },
                        entryRepository =
                            remember { LocalOrderRepository(db, Dispatchers.IO, { "d" }) },
                        catalogRepository = remember { LocalCatalogRepository(db, Dispatchers.IO) },
                        checkoutRepository = repo,
                        checkoutHttp = remember { ConvexHttp("http://127.0.0.1") },
                        checkoutSessions = sessions,
                    )
                }
        }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Later").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Later").performClick()
        // Deterministic next owned intent is offered after the first was deferred.
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Resume saved checkout").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Resume saved checkout").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Skip").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Skip").performClick()
        compose.waitUntil(5000) { currentRoute.get() == "HomeScreen" }
        assertNull(db.localValue(activeKey(ids[1]))?.takeIf { it.isNotEmpty() })
        assertNotNull(db.localValue(activeKey(ids[0]))?.takeIf { it.isNotEmpty() })
        db.acknowledge(db.pendingChanges(), emptySet())
        compose.runOnIdle { hidden.value = true }
        compose.onNodeWithText("Resume saved checkout").assertDoesNotExist()
        compose.runOnIdle { hidden.value = false }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Open tables").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Resume saved checkout").assertDoesNotExist()
        // Conflated same user/store values still get fresh memory after the auth epoch changes.
        compose.runOnIdle { epoch.longValue++ }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Resume saved checkout").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Resume saved checkout").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Skip").fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(2, db.select("order_payments").size)
    }

    @Test
    fun freshHomeAfterActualDatabaseReopenResumesHiddenPaidCheckout() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "synthetic-checkout-reopen-${java.util.UUID.randomUUID()}.sqlite"
        val owner = CheckoutDatabaseContract.owner
        lateinit var id: String
        lateinit var paymentIds: List<String?>
        val driver = CheckoutFaultDriver(AndroidSqliteDriver(LegacySqlSchema, context, name))
        PosDatabase(driver).use { db ->
            id = runBlocking { CheckoutDatabaseContract.seed(db) }
            driver.failTable = "tables"
            assertTrue(
                runCatching {
                        runBlocking {
                            LocalCheckoutRepository(db, Dispatchers.IO, { owner })
                                .settle(
                                    owner,
                                    CheckoutRoute(id, "dine_in", "t", "Table 1"),
                                    listOf(PaymentLine(cashReceived = "300")),
                                    "Cashier",
                                )
                        }
                    }
                    .isFailure
            )
            assertEquals("paid", db.get("orders", id)!!.string("status"))
            paymentIds = db.select("order_payments").map { it.string("id") }
        }
        val db = PosDatabase(AndroidSqliteDriver(LegacySqlSchema, context, name))
        val repo = LocalCheckoutRepository(db, Dispatchers.IO, { owner })
        val currentRoute = AtomicReference("")
        compose.setContent {
            PosBrowseRoot(
                SignedInUser(owner.userId, "Cashier", null, "s", null),
                remember { LocalBrowseRepository(db, Dispatchers.IO) },
                flowOf(null),
                "",
                false,
                {},
                {},
                {},
                { currentRoute.set(it) },
                entryRepository = remember { LocalOrderRepository(db, Dispatchers.IO, { "d" }) },
                catalogRepository = remember { LocalCatalogRepository(db, Dispatchers.IO) },
                checkoutRepository = repo,
                checkoutHttp = remember { ConvexHttp("http://127.0.0.1") },
            )
        }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Resume saved checkout").fetchSemanticsNodes().isNotEmpty()
        }
        screenshot("recovery")
        compose.onNodeWithText("Resume saved checkout").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Skip").fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(paymentIds, db.select("order_payments").map { it.string("id") })
        assertEquals("available", db.get("tables", "t")!!.string("status"))
        compose.onNodeWithText("Skip").performClick()
        compose.waitUntil(5000) { currentRoute.get() == "HomeScreen" }
        // This simulates a fresh process owner/navigation around real DB close/reopen,
        // not Android killing/relaunching the actual production process.
    }

    @Test
    fun discountImeManagerRepeatedErrorsDismissAndApprovedRemoval() {
        MockWebServer().use { server ->
            val calls = java.util.concurrent.atomic.AtomicInteger()
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val path =
                            kotlinx.serialization.json.Json.parseToJsonElement(
                                    request.body.readUtf8()
                                )
                                .let {
                                    (it as kotlinx.serialization.json.JsonObject)["path"].toString()
                                }
                        if (path.contains("listManagers"))
                            return MockResponse()
                                .setBody(
                                    """{"status":"success","value":[{"_id":"manager","name":"Manager","roleName":"Supervisor"}]}"""
                                )
                        val attempt = calls.incrementAndGet()
                        return if (attempt <= 2)
                            MockResponse()
                                .setBody(
                                    """{"status":"success","value":{"success":false,"error":"Wrong PIN"}}"""
                                )
                        else if (attempt == 3) MockResponse().setResponseCode(503)
                        else
                            MockResponse()
                                .setBody("""{"status":"success","value":{"success":true}}""")
                    }
                }
            val db =
                PosDatabase(
                    AndroidSqliteDriver(
                        LegacySqlSchema,
                        ApplicationProvider.getApplicationContext<Context>(),
                        null,
                    )
                )
            val id = runBlocking { CheckoutDatabaseContract.seed(db) }
            val owner = CheckoutDatabaseContract.owner
            val repo = LocalCheckoutRepository(db, Dispatchers.IO, { owner })
            val http = ConvexHttp(server.url("/").toString()).apply { token = "synthetic" }
            val hidden = mutableStateOf(false)
            compose.setContent {
                val scope = rememberCoroutineScope()
                val session = remember {
                    CheckoutSession(
                        owner,
                        CheckoutRoute(id, "dine_in"),
                        repo,
                        http,
                        "Cashier",
                        scope,
                    ) {
                        true
                    }
                }
                if (hidden.value) Text("Locked fixture")
                else
                    CheckoutScreen(
                        owner,
                        session.route,
                        repo,
                        http,
                        "Cashier",
                        { true },
                        {},
                        {},
                        session,
                    )
            }
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("Add SC/PWD Discount").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Add SC/PWD Discount").performScrollTo().performClick()
            compose.onNodeWithText("Senior Citizen").performClick()
            compose.onNodeWithText("2x Meal").performClick()
            screenshot("discount")
            compose.onNodeWithTag("discount-id").performTextInput(" ID ")
            compose.onNodeWithTag("discount-id").performImeAction()
            compose.onNodeWithTag("discount-name").assertIsFocused().performTextInput(" Customer ")
            compose.runOnIdle { hidden.value = true }
            compose.onNodeWithTag("discount-name").assertDoesNotExist()
            compose.runOnIdle { hidden.value = false }
            compose
                .onNodeWithTag("discount-name")
                .assertTextContains(" Customer ")
                .performImeAction()
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("Manager").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Manager").performClick()
            screenshot("manager")
            compose.waitUntil(5000) {
                compose
                    .onNodeWithTag("approval-pin")
                    .fetchSemanticsNode()
                    .config[androidx.compose.ui.semantics.SemanticsProperties.Focused]
            }
            compose.onNodeWithTag("approval-pin").performTextInput("1234")
            repeat(3) { index ->
                compose.onNodeWithTag("approval-pin").performImeAction()
                val title = if (index < 2) "Invalid PIN" else "Error"
                compose.waitUntil(5000) {
                    compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty()
                }
                compose.onNodeWithText("OK").performClick()
                compose.onNodeWithTag("approval-pin").assertTextContains("1234")
            }
            compose.onNodeWithTag("approval-pin").performImeAction()
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("Success").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("OK").performClick()
            val discount = db.select("order_discounts").single()
            assertEquals(25.0, discount.number("discount_amount"), 0.0)
            compose.onNodeWithText("Add Another Discount").performScrollTo().performClick()
            compose.onNodeWithText("All items already have discounts").assertExists()
            compose.onNodeWithContentDescription("Close dialog").performClick()
            compose
                .onNodeWithContentDescription("Remove discount ${discount.string("id")}")
                .performScrollTo()
                .performClick()
            compose.onNodeWithText("Remove").performClick()
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("Manager").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("approval-pin").assertTextEquals("", "••••")
            compose.onNodeWithText("Manager").performClick()
            compose.onNodeWithTag("approval-pin").performTextInput("1234")
            compose.onNodeWithText("Verify & Approve").performScrollTo().performClick()
            compose.waitUntil(5000) {
                db.get("order_discounts", discount.string("id")!!)!!.string("_status") == "deleted"
            }
            assertEquals(280.0, db.get("orders", id)!!.number("net_sales"), 0.0)
        }
    }

    @Test
    fun realRootEditorCheckoutBackAndSkipPublishActualRoute() {
        val db =
            PosDatabase(
                AndroidSqliteDriver(
                    LegacySqlSchema,
                    ApplicationProvider.getApplicationContext<Context>(),
                    null,
                )
            )
        val id = runBlocking { CheckoutDatabaseContract.seed(db) }
        db.updateLocal(
            "tables",
            "t",
            kotlinx.serialization.json.buildJsonObject {
                put("is_active", kotlinx.serialization.json.JsonPrimitive(true))
            },
        )
        val owner = CheckoutDatabaseContract.owner
        val currentRoute = AtomicReference("")
        compose.setContent {
            PosBrowseRoot(
                SignedInUser(owner.userId, "Cashier", null, "s", null),
                LocalBrowseRepository(db, Dispatchers.IO),
                flowOf(null),
                "",
                false,
                {},
                {},
                {},
                { currentRoute.set(it) },
                entryRepository = LocalOrderRepository(db, Dispatchers.IO, { "d" }),
                catalogRepository = LocalCatalogRepository(db, Dispatchers.IO),
                checkoutRepository = LocalCheckoutRepository(db, Dispatchers.IO, { owner }),
                checkoutHttp = ConvexHttp("http://127.0.0.1"),
            )
        }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("View active tables").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("View active tables").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Table 1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Table 1").performClick()
        compose.waitUntil(5000) { currentRoute.get() == "OrderScreen" }
        // Seed line is unsent, so source editor must send before Close Table becomes available.
        runBlocking { LocalOrderRepository(db, Dispatchers.IO, { "d" }).send(id) }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Close Table").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Close Table").performClick()
        compose.waitUntil(5000) { currentRoute.get() == "CheckoutScreen" }
        compose.onNodeWithContentDescription("Back").performClick()
        compose.waitUntil(5000) { currentRoute.get() == "OrderScreen" }
        compose.onNodeWithText("Close Table").performClick()
        compose.onNodeWithText("Exact Amount").performScrollTo().performClick()
        compose.onNodeWithText("Complete Payment").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Skip").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Skip").performClick()
        compose.waitUntil(5000) { currentRoute.get() == "HomeScreen" }
        assertEquals("paid", db.get("orders", id)!!.string("status"))
    }

    @Test
    fun realSqliteCashQuickAddSplitCardAndCompletion() {
        val db =
            PosDatabase(
                AndroidSqliteDriver(
                    LegacySqlSchema,
                    ApplicationProvider.getApplicationContext<Context>(),
                    null,
                )
            )
        val id = runBlocking { CheckoutDatabaseContract.seed(db) }
        val owner = CheckoutDatabaseContract.owner
        val repo = LocalCheckoutRepository(db, Dispatchers.IO, { owner })
        val completed = AtomicReference<CompletedCheckout?>()
        compose.setContent {
            CheckoutScreen(
                owner,
                CheckoutRoute(id, "dine_in", "t", "Table 1"),
                repo,
                ConvexHttp("http://127.0.0.1"),
                "Cashier",
                { true },
                {},
                { completed.set(it) },
            )
        }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Cash Amount").fetchSemanticsNodes().isNotEmpty()
        }
        screenshot("cash")
        compose.onNodeWithText("Complete Payment").assertIsNotEnabled()
        compose.onNodeWithText("+₱100").performScrollTo().performClick()
        compose.onNodeWithText("+₱100").performClick()
        compose.onNodeWithTag("cash-1").assertTextContains("200")
        compose.onNodeWithText("Add Payment Method").performScrollTo().performClick()
        compose.onNodeWithTag("card-2").performScrollTo().assertTextContains("80")
        compose.onNodeWithTag("custom-2").assertExists()
        compose.onNodeWithText("GCash").performScrollTo().performClick()
        compose.onNodeWithTag("reference-2").performTextInput(" REF ")
        compose.onNodeWithText("Complete Payment").performClick()
        compose.waitUntil(5000) { completed.get() != null }
        assertEquals("paid", db.get("orders", id)!!.string("status"))
        assertEquals(listOf(200.0, 80.0), db.select("order_payments").map { it.number("amount") })
        compose.onNodeWithText("Complete Payment").performClick()
        assertEquals(2, db.select("order_payments").size)
    }
}
