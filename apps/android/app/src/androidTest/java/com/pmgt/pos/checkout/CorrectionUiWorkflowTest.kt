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
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.flowOf
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CorrectionUiWorkflowTest {
    @get:Rule val compose = createComposeRule()

    private fun assertTextStyle(
        text: String,
        size: Int? = null,
        color: androidx.compose.ui.graphics.Color? = null,
    ) {
        val layouts = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        compose.onNodeWithText(text).performSemanticsAction(
            androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult
        ) {
            it(layouts)
        }
        size?.let {
            assertEquals(it.toFloat(), layouts.single().layoutInput.style.fontSize.value, 0f)
        }
        color?.let { assertEquals(it, layouts.single().layoutInput.style.color) }
    }

    private var originalHandwriting: String? = null

    @org.junit.Before
    fun standardSoftwareKeyboardMode() {
        val device =
            androidx.test.uiautomator.UiDevice.getInstance(
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            )
        originalHandwriting =
            device.executeShellCommand("settings get secure stylus_handwriting_enabled").trim()
        device.executeShellCommand("settings put secure stylus_handwriting_enabled 0")
    }

    @org.junit.After
    fun restoreKeyboardMode() {
        val original = originalHandwriting ?: return
        val device =
            androidx.test.uiautomator.UiDevice.getInstance(
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            )
        device.executeShellCommand(
            if (original == "null") "settings delete secure stylus_handwriting_enabled"
            else "settings put secure stylus_handwriting_enabled $original"
        )
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation =
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.waitForIdle(500, 5000)
        val device = androidx.test.uiautomator.UiDevice.getInstance(instrumentation)
        val context = ApplicationProvider.getApplicationContext<Context>()
        val file = java.io.File(context.getExternalFilesDir(null), "correction-synthetic-$name.png")
        check(device.takeScreenshot(file))
        device.executeShellCommand(
            "cp ${file.absolutePath} /sdcard/Download/correction-synthetic-$name.png"
        )
    }

    @Test fun centeredVoidReasonDismissesThenCommitsThroughHistoryApproval() = additionalFlow(false)

    @Test
    fun takeoutLongRefundSelectionKeepsOuterDetailAndClosesAfterCommittedCorrection() =
        additionalFlow(true)

    private fun additionalFlow(takeout: Boolean) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val threads = CorrectionQueryThreads(AndroidSqliteDriver(LegacySqlSchema, context, null))
        val db = PosDatabase(threads)
        val browse = CorrectionCompose19Delivery(LocalBrowseRepository(db, Dispatchers.IO))
        val owner = CheckoutDatabaseContract.owner
        val entry = LocalOrderRepository(db, Dispatchers.IO, { "device" })
        val id = runBlocking {
            val order = CheckoutDatabaseContract.seed(db)
            if (takeout) {
                db.updateLocal(
                    "orders",
                    order,
                    fields("order_type" to "takeout", "takeout_status" to "picked_up"),
                )
                repeat(14) { index ->
                    entry.addItem(order, ItemInput("p", 1.0, notes = "line-$index"))
                    val item =
                        db.select(
                                "order_items",
                                "order_id = ? AND notes = ?",
                                listOf(order, "line-$index"),
                            )
                            .single()
                            .string("id")!!
                    db.updateLocal("order_items", item, fields("product_name" to "Meal $index"))
                }
            }
            LocalCheckoutRepository(db, Dispatchers.IO, { owner })
                .settle(
                    owner,
                    CheckoutRoute(order, if (takeout) "takeout" else "dine_in"),
                    listOf(PaymentLine(cashReceived = "5000")),
                    "Cashier",
                )
            order
        }
        val server = MockWebServer()
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) =
                    MockResponse()
                        .setBody(
                            if (request.body.readUtf8().contains("listManagers"))
                                """{"status":"success","value":[{"_id":"manager","name":"Manager","roleName":"Manager"}]}"""
                            else """{"status":"success","value":{"success":true}}"""
                        )
            }
        server.start()
        val http = ConvexHttp(server.url("/").toString())
        compose.setContent {
            PosBrowseRoot(
                SignedInUser(owner.userId, "Cashier", null, "s", null),
                browse,
                flowOf(null),
                "",
                false,
                {},
                {},
                {},
                {},
                entryRepository = entry,
                catalogRepository = remember { LocalCatalogRepository(db, Dispatchers.IO) },
                checkoutHttp = http,
                correctionRepository =
                    remember { LocalCorrectionRepository(db, Dispatchers.IO, entry, { owner }) },
            )
        }
        if (takeout) {
            compose.onNodeWithText("Takeout", useUnmergedTree = false).performClick()
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("View Details").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("View Details").performClick()
        } else {
            compose.onNodeWithText("Past Orders").performClick()
            val number = db.get("orders", id)!!.string("order_number")!!
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("#$number").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("#$number").performClick()
        }
        val action = if (takeout) "Refund Item" else "Void"
        compose.waitUntil(5000) {
            compose.onAllNodesWithText(action).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(action).performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithTag("correction-reason").fetchSemanticsNodes().isNotEmpty()
        }
        if (takeout) {
            compose
                .onNode(hasText("1x Meal 13") and hasAnyAncestor(isDialog()))
                .performScrollTo()
                .performClick()
            compose.onNodeWithText("Refund Amount (1 item)").assertExists()
            screenshot("long-refund")
        } else {
            compose.onNodeWithText("Continue").assertIsNotEnabled()
            assertTextStyle("Continue", size = 18)
            compose.onNodeWithTag("correction-reason").performTouchInput { click() }
            val device =
                androidx.test.uiautomator.UiDevice.getInstance(
                    androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
                )
            device.findObject(androidx.test.uiautomator.By.desc("Show on-screen keyboard"))?.click()
            check(
                device.wait(
                    androidx.test.uiautomator.Until.hasObject(
                        androidx.test.uiautomator.By.desc("q")
                    ),
                    5000,
                )
            ) {
                "Standard software keyboard must be visible"
            }
            compose
                .onNodeWithTag("correction-reason")
                .performTextInput("Accidental order\nManager approved return")
            compose
                .onNodeWithTag("correction-reason")
                .assertTextContains("Manager approved return", substring = true)
            screenshot("void-reason-ime")
            device.pressBack() // dismiss IME, retaining the reason surface
            compose
                .onNodeWithTag("correction-reason")
                .assertTextContains("Manager approved return", substring = true)
            screenshot("void-reason")
            compose.onNodeWithContentDescription("Close dialog").performClick()
            compose.onNodeWithText("Void").performClick()
            compose.waitUntil(5000) {
                compose.onAllNodesWithTag("correction-reason").fetchSemanticsNodes().isNotEmpty()
            }
            compose
                .onNodeWithTag("correction-reason")
                .assert(
                    SemanticsMatcher.expectValue(
                        androidx.compose.ui.semantics.SemanticsProperties.EditableText,
                        androidx.compose.ui.text.AnnotatedString(""),
                    )
                )
        }
        compose.onNodeWithTag("correction-reason").performTextReplacement("Return")
        compose.onNodeWithText("Continue").performScrollTo().performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Manager").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onAllNodesWithText("Manager").onFirst().performClick()
        compose.onNodeWithTag("approval-pin").performTextInput("1234")
        compose.onNodeWithText("Verify & Approve").performScrollTo().performClick()
        compose.waitUntil(5000) {
            compose
                .onAllNodesWithText(if (takeout) "Refund Processed" else "Success")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        assertEquals("voided", db.get("orders", id)!!.string("status"))
        if (takeout) assertEquals("picked_up", db.get("orders", id)!!.string("takeout_status"))
        compose.onNodeWithText("OK").performClick()
        compose.onNodeWithText(if (takeout) "Takeout Orders" else "Order History").assertExists()
        compose.onNodeWithText("Refund Item").assertDoesNotExist()
        if (takeout) {
            threads.assertIoProjection()
            browse.assertMainDelivery()
        }
        server.close()
        db.close()
    }

    @Test
    fun reopenedSavedRefundRequiresExplicitOriginalActionConfirmationFromVoidEntry() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "correction-ui-${java.util.UUID.randomUUID()}.db"
        val driver = CheckoutFaultDriver(AndroidSqliteDriver(LegacySqlSchema, context, name))
        val first = PosDatabase(driver)
        val owner = CorrectionDatabaseContract.owner
        val order = runBlocking {
            val id = CorrectionDatabaseContract.seed(first)
            driver.failTable = "audit_logs"
            val input =
                CorrectionDatabaseContract.input(first, id)
                    .copy(reason = "Saved reason. ".repeat(100))
            assertTrue(
                runCatching {
                        CorrectionDatabaseContract.repo(first)
                            .correct(
                                owner,
                                id,
                                "saved",
                                input,
                                CheckoutApproval(owner, id, "saved", "manager"),
                            )
                    }
                    .isFailure
            )
            id
        }
        val reserved = activeJournal(first, order)!!
        val number = first.get("orders", order)!!.string("order_number")!!
        first.close()
        val db = PosDatabase(AndroidSqliteDriver(LegacySqlSchema, context, name))
        val entry = LocalOrderRepository(db, Dispatchers.IO, { "device" })
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
                {},
                entryRepository = entry,
                catalogRepository = remember { LocalCatalogRepository(db, Dispatchers.IO) },
                checkoutHttp = remember { ConvexHttp("http://127.0.0.1") },
                correctionRepository =
                    remember { LocalCorrectionRepository(db, Dispatchers.IO, entry, { owner }) },
            )
        }
        compose.onNodeWithText("Past Orders").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("#$number").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("#$number").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Void").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Void").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Saved refund").fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals("paid", db.get("orders", order)!!.string("status"))
        assertTrue(db.select("order_voids").isEmpty())
        compose
            .onNode(hasText("2x Meal") and hasAnyAncestor(isDialog()))
            .performScrollTo()
            .assertExists()
        screenshot("saved-refund")
        compose.onNodeWithText("Later").performClick()
        compose.onNodeWithText("Void").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Resume saved refund").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Resume saved refund").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Refund Processed").fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals("voided", db.get("orders", order)!!.string("status"))
        assertEquals(
            reserved.allocatedIds.toSet(),
            listOf(
                    "orders",
                    "order_items",
                    "order_item_modifiers",
                    "order_discounts",
                    "order_payments",
                    "order_voids",
                    "audit_logs",
                )
                .flatMap {
                    db.select(it).map { it.string("id") }.filter { it in reserved.allocatedIds }
                }
                .toSet(),
        )
        compose.onNodeWithText("OK").performClick()
        compose.onNodeWithText("Order History").assertExists()
        db.close()
        context.deleteDatabase(name)
    }

    @Test
    fun historyRefundSelectionApprovalWritesRealRowsAndExitsOnSuccess() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = PosDatabase(AndroidSqliteDriver(LegacySqlSchema, context, null))
        val owner = CheckoutDatabaseContract.owner
        val entry = LocalOrderRepository(db, Dispatchers.IO, { "device" })
        val order = runBlocking {
            val id = CheckoutDatabaseContract.seed(db)
            entry.addItem(id, ItemInput("p", 1.0, notes = "retained"))
            LocalCheckoutRepository(db, Dispatchers.IO, { owner })
                .settle(
                    owner,
                    CheckoutRoute(id, "dine_in"),
                    listOf(PaymentLine(cashReceived = "500")),
                    "Cashier",
                )
            id
        }
        val number = db.get("orders", order)!!.string("order_number")!!
        val server = MockWebServer()
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val body = request.body.readUtf8()
                    return if (body.contains("9999")) MockResponse().setResponseCode(503)
                    else
                        MockResponse()
                            .setBody(
                                if (body.contains("listManagers"))
                                    """{"status":"success","value":[{"_id":"manager","name":"Manager","roleName":"Manager"}]}"""
                                else if (body.contains("1234"))
                                    """{"status":"success","value":{"success":true}}"""
                                else """{"status":"success","value":{"success":false}}"""
                            )
                }
            }
        server.start()
        val http = ConvexHttp(server.url("/").toString())
        val hidden = mutableStateOf(false)
        compose.setContent {
            val scope = rememberCoroutineScope()
            val sessions = remember { CorrectionSessions(scope) }
            if (hidden.value) Text("Locked fixture")
            else
                PosBrowseRoot(
                    SignedInUser(owner.userId, "Cashier", null, "s", null),
                    remember { LocalBrowseRepository(db, Dispatchers.IO) },
                    flowOf(null),
                    "",
                    false,
                    {},
                    {},
                    {},
                    {},
                    entryRepository = entry,
                    catalogRepository = remember { LocalCatalogRepository(db, Dispatchers.IO) },
                    checkoutRepository =
                        remember { LocalCheckoutRepository(db, Dispatchers.IO, { owner }) },
                    checkoutHttp = http,
                    correctionRepository =
                        remember {
                            LocalCorrectionRepository(
                                db,
                                Dispatchers.IO,
                                entry,
                                { owner },
                                { error("Synthetic postcommit scheduling failure") },
                            )
                        },
                    correctionSessions = sessions,
                )
        }
        compose.onNodeWithText("Past Orders").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("#$number").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("#$number").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Refund Item").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Refund Item").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Refund Items").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Continue").assertIsNotEnabled()
        compose.onNode(hasText("2x Meal") and hasAnyAncestor(isDialog())).performClick()
        compose.onNodeWithText("Refund Amount (1 item)").assertExists()
        assertTextStyle(
            "Refund Amount (1 item)",
            color = androidx.compose.ui.graphics.Color(0xFFDC2626),
        )
        screenshot("refund-sheet-settled")
        compose.onNodeWithTag("correction-reason").performTextInput("Returned meal")
        screenshot("refund-sheet")
        compose.runOnIdle { hidden.value = true }
        compose.onNodeWithText("Refund Items").assertDoesNotExist()
        compose.runOnIdle { hidden.value = false }
        compose.waitUntil(5000) {
            compose.onAllNodesWithTag("correction-reason").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("correction-reason").assertTextContains("Returned meal")
        compose.onNodeWithText("Continue").performScrollTo().performClick()
        compose.onNodeWithText("Approve Refund").assertExists()
        compose.onNodeWithContentDescription("Close dialog").performClick()
        compose.onNodeWithText("Approve Refund").assertDoesNotExist()
        // Lock-style remount recreates navigation; return to the same real paid history row.
        compose.onNodeWithText("Past Orders").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("#$number").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("#$number").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Refund Item").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Refund Item").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithTag("correction-reason").fetchSemanticsNodes().isNotEmpty()
        }
        compose
            .onNodeWithTag("correction-reason")
            .assert(
                SemanticsMatcher.expectValue(
                    androidx.compose.ui.semantics.SemanticsProperties.EditableText,
                    androidx.compose.ui.text.AnnotatedString(""),
                )
            )
        compose.onNodeWithText("Refund Amount (1 item)").assertDoesNotExist()
        compose.onNode(hasText("2x Meal") and hasAnyAncestor(isDialog())).performClick()
        compose.onNodeWithTag("correction-reason").performTextInput("Returned meal")
        compose.onNodeWithTag("correction-reason").assertTextContains("Returned meal")
        compose.onNodeWithText("Continue").performScrollTo().performClick()
        compose.onNodeWithText("Approve Refund").assertExists()
        compose.waitUntil(5000) {
            compose
                .onAllNodesWithText("Manager", useUnmergedTree = true)
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onAllNodesWithText("Manager").onFirst().performClick()
        compose.onNodeWithTag("approval-pin").performTextInput("0000")
        repeat(2) {
            compose.onNodeWithText("Verify & Approve").performScrollTo().performClick()
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("Invalid PIN").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("OK").performClick()
        }
        compose.onNodeWithTag("approval-pin").performTextReplacement("9999")
        compose.onNodeWithText("Verify & Approve").performScrollTo().performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Failed to verify PIN").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("OK").performClick()
        compose.onNodeWithTag("approval-pin").performTextClearance()
        compose.onNodeWithTag("approval-pin").performTextInput("1234")
        compose.onNodeWithText("Verify & Approve").performScrollTo().performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Refund Processed").fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals("voided", db.get("orders", order)!!.string("status"))
        assertEquals(1, db.select("order_voids").size)
        assertEquals(1, db.select("audit_logs").size)
        compose.onNodeWithText("OK").performClick()
        compose.onNodeWithText("Order History").assertExists()
        compose.onNodeWithText("Refund Item").assertDoesNotExist()
        server.close()
        db.close()
    }
}
