package com.pmgt.pos.auth

import androidx.compose.material3.Text
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Deterministic HTTP-backed UI workflow; credentials never leave the emulator. */
class AuthUiWorkflowTest {
    @get:Rule val compose = createComposeRule()
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    @Test
    fun loginMatchesNativeValidationAndRetainsCredentialsAfterFailure() {
        val http = ConvexHttp("http://127.0.0.1:1/")
        val auth = AuthRepository(http, MemorySessionStorage())
        val lock = LockState(memoryLockStorage(), http)
        compose.setContent { PosAuthShell(auth, lock, http, configured = true) }

        compose.onNodeWithText("Enter your credentials to continue").assertExists()
        compose.onNodeWithText("Login").performClick()
        compose.onNodeWithText("Please enter your email").assertExists()
        compose.onNodeWithText("OK").performClick()
        compose.onNodeWithText("Email").performTextInput("cashier@example.com")
        compose.onNodeWithText("Login").performClick()
        compose.onNodeWithText("Please enter your password").assertExists()
        compose.onNodeWithText("Password").performTextInput("wrong")
        compose.onNodeWithText("Login").performClick()
        compose.waitUntil(10_000) {
            compose
                .onAllNodesWithText(
                    "Authentication failed. Please check your credentials and try again."
                )
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onAllNodes(hasSetTextAction())[0].assertTextContains("cashier@example.com")
        compose.onNodeWithText("OK").performClick()
        compose.onNodeWithText("Login").performClick()
        compose.waitUntil(10_000) {
            compose
                .onAllNodesWithText(
                    "Authentication failed. Please check your credentials and try again."
                )
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
    }

    @Test
    fun cashierSignsInLocksUsesSixDotsAndManagerModalThenUnlocksAndSignsOut() {
        MockWebServer().use { server ->
            val requestedPaths = java.util.Collections.synchronizedList(mutableListOf<String>())
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
                        val path = body["path"]?.jsonPrimitive?.content
                        requestedPaths += path.orEmpty()
                        if (
                            path == "screenLockActions:screenUnlock" &&
                                body["args"]!!.jsonObject["pin"]!!.jsonPrimitive.content == "9999"
                        )
                            return MockResponse().setResponseCode(503)
                        if (
                            path == "screenLockActions:screenUnlockOverride" &&
                                body["args"]!!.jsonObject["managerPin"]!!.jsonPrimitive.content ==
                                    "9999"
                        )
                            return MockResponse().setResponseCode(503)
                        val value =
                            when (path) {
                                "auth:signIn" ->
                                    """{"tokens":{"token":"access","refreshToken":"refresh"}}"""
                                "auth:signOut" -> "null"
                                "sessions:getCurrentUser" ->
                                    """{"_id":"cashier","name":"Alex","storeId":"store","role":{"_id":"role","name":"Cashier","scopeLevel":"branch","permissions":["orders.create"]}}"""
                                "screenLock:getUserHasPin" -> "true"
                                "screenLock:getAutoLockTimeout" -> "0.51"
                                "stores:get" -> """{"name":"Test Restaurant"}"""
                                "screenLock:screenLock" -> "null"
                                "screenLockActions:screenUnlock" ->
                                    if (
                                        body["args"]!!.jsonObject["pin"]!!.jsonPrimitive.content ==
                                            "1234"
                                    )
                                        """{"success":true}"""
                                    else """{"success":false,"error":"Invalid PIN"}"""
                                "helpers/usersHelpers:listManagers" ->
                                    """[{"_id":"manager","name":"Morgan","roleName":"Manager"}]"""
                                "screenLockActions:screenUnlockOverride" ->
                                    if (
                                        body["args"]!!
                                            .jsonObject["managerPin"]!!
                                            .jsonPrimitive
                                            .content == "2222"
                                    )
                                        """{"success":true}"""
                                    else """{"success":false,"error":"Manager PIN is incorrect."}"""
                                else -> return MockResponse().setResponseCode(500)
                            }
                        return MockResponse().setBody("""{"status":"success","value":$value}""")
                    }
                }
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, MemorySessionStorage())
            val lock = LockState(memoryLockStorage(), http)
            compose.setContent {
                PosAuthShell(auth, lock, http, configured = true, showTestControls = true) {
                    Text(
                        if (auth.hasPermission("discounts.approve")) "Can approve"
                        else "Cashier permissions"
                    )
                }
            }
            compose.onNodeWithText("Email").performTextInput("cashier@example.com")
            compose.onNodeWithText("Password").performTextInput("password")
            compose.onNodeWithText("Login", useUnmergedTree = true).performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Cashier permissions").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Cashier permissions").assertExists()
            compose.waitUntil(4_000) {
                compose
                    .onAllNodes(hasText("Screen will lock in", substring = true))
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithText("Stay Active").performClick()
            compose.onNodeWithText("Cashier permissions").assertExists()
            compose.onNodeWithText("Lock screen").performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Manager Override").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithContentDescription("PIN digit 1 of 6, empty").assertExists()
            compose.onNodeWithContentDescription("PIN digit 6 of 6, empty").assertExists()
            compose.onNodeWithText("Clear").assertDoesNotExist()
            compose.onNodeWithText("1").performClick()
            compose.onNodeWithText("Manager Override").performClick()
            compose
                .onNodeWithText("A manager can unlock this screen with their PIN.")
                .assertExists()
            try {
                compose.waitUntil(10_000) {
                    compose.onAllNodesWithText("Morgan").fetchSemanticsNodes().isNotEmpty()
                }
            } catch (error: Throwable) {
                println("AUTH_REQUEST_PATHS=$requestedPaths")
                println("AUTH_UI_TREE=${compose.onRoot(useUnmergedTree = true).printToString()}")
                throw error
            }
            assertManagerPaintedBounds()
            compose.onNodeWithText("Morgan").performClick()
            compose.onNodeWithText("Enter manager PIN").performTextInput("1111")
            compose.onAllNodesWithText("Unlock")[1].performClick()
            compose.waitUntil(10_000) {
                compose
                    .onAllNodesWithText("Manager Override Failed")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithText("Manager PIN is incorrect.").assertExists()
            compose.onNodeWithText("OK").performClick()
            compose.onNodeWithText("Enter manager PIN").assertExists()
            compose.onNodeWithText("Enter manager PIN").performTextInput("9999")
            compose
                .onNodeWithTag("manager-unlock")
                .performScrollTo()
                .assertIsDisplayed()
                .performClick()
            compose.waitUntil(10_000) {
                compose
                    .onAllNodesWithText("Failed to verify manager PIN.")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithText("OK").performClick()
            compose.onNodeWithText("Enter manager PIN").assertExists()
            compose.onNodeWithText("Enter manager PIN").performTextInput("9999")
            compose
                .onNodeWithTag("manager-unlock")
                .performScrollTo()
                .assertIsDisplayed()
                .performClick()
            compose.waitUntil(10_000) {
                compose
                    .onAllNodesWithText("Failed to verify manager PIN.")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithText("OK").performClick()
            dismissManagerWithBack()
            compose
                .onNodeWithText("A manager can unlock this screen with their PIN.")
                .assertDoesNotExist()
            compose.onNodeWithContentDescription("PIN digit 1 of 6, filled").assertExists()
            compose.onNodeWithText("Manager Override").performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Morgan").fetchSemanticsNodes().isNotEmpty()
            }
            dismissManagerWithBack()
            compose
                .onNodeWithText("A manager can unlock this screen with their PIN.")
                .assertDoesNotExist()
            compose.onNodeWithContentDescription("Backspace").performClick()
            listOf("9", "9", "9", "9").forEach { compose.onNodeWithText(it).performClick() }
            compose.onNodeWithText("Unlock").performClick()
            compose.waitUntil(10_000) {
                compose
                    .onAllNodesWithText("Failed to verify PIN. Please try again.")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithText("OK").performClick()
            compose.onNodeWithText("Manager Override").performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Morgan").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Morgan").performClick()
            compose.onNodeWithText("Enter manager PIN").performTextInput("2222")
            compose.onAllNodesWithText("Unlock")[1].performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Sign out").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Sign out").performClick()
            compose.waitUntil(10_000) {
                compose
                    .onAllNodesWithText("Login", useUnmergedTree = true)
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithText("Email").assertExists()
        }
    }

    private fun memoryLockStorage() =
        object : LockStorage {
            private var snapshot = LockSnapshot()

            override fun read() = snapshot

            override fun write(snapshot: LockSnapshot) {
                this.snapshot = snapshot
            }
        }

    /** Catches a fill modifier overriding the cap, and fixed widths overflowing narrow windows. */
    private fun assertManagerPaintedBounds() {
        val dialog = compose.onNode(isDialog())
        val image = dialog.captureToImage()
        val pixels = image.toPixelMap()
        val description =
            compose.onNodeWithText("A manager can unlock this screen with their PIN.")
                .fetchSemanticsNode().boundsInRoot
        val dialogBounds = dialog.fetchSemanticsNode().boundsInRoot
        val y = (description.center.y - dialogBounds.top).toInt()
        // This row crosses the panel's straight sides, away from its rounded corners.
        val whitePixels = (0 until image.width).filter { x ->
            val color = pixels[x, y]
            color.red > .99f && color.green > .99f && color.blue > .99f
        }
        assertTrue("Manager panel must paint a white surface", whitePixels.isNotEmpty())
        val expectedWidth = with(compose.density) {
            minOf(448.dp.roundToPx(), image.width - 32.dp.roundToPx())
        }
        val expectedLeft = (image.width - expectedWidth) / 2
        println(
            "MANAGER_PAINTED_BOUNDS window=${image.width}px " +
                "left=${whitePixels.first()} right=${whitePixels.last() + 1} " +
                "width=${whitePixels.last() - whitePixels.first() + 1}px expected=${expectedWidth}px"
        )
        assertEquals(
            "Painted manager panel width must respect the 448dp cap and 16dp exterior gutters",
            expectedWidth,
            whitePixels.last() - whitePixels.first() + 1,
        )
        assertEquals("Painted manager panel must be centered", expectedLeft, whitePixels.first())
        assertEquals(
            "Painted manager panel right edge",
            expectedLeft + expectedWidth,
            whitePixels.last() + 1,
        )
    }

    /**
     * The manager modal and the error alert are separate dialog windows. `waitForIdle` settles
     * composition but not the platform's window focus transfer, so a Back sent in that gap is
     * delivered to the window that is going away. Poll for the modal to actually close instead of
     * assuming one frame is enough; the caller's assertion still requires it to be gone.
     */
    private fun dismissManagerWithBack() {
        repeat(3) {
            if (!managerModalVisible()) return
            device.pressBack()
            compose.waitForIdle()
            runCatching { compose.waitUntil(2_000) { !managerModalVisible() } }
        }
    }

    private fun managerModalVisible() =
        compose
            .onAllNodesWithText("A manager can unlock this screen with their PIN.")
            .fetchSemanticsNodes()
            .isNotEmpty()
}
