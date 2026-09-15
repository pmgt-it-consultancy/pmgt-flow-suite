package com.pmgt.pos.auth

import androidx.compose.material3.Text
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Rule
import org.junit.Test

/** Deterministic HTTP-backed UI workflow; credentials never leave the emulator. */
class AuthUiWorkflowTest {
    @get:Rule val compose = createComposeRule()

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
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
                        val path = body["path"]?.jsonPrimitive?.content
                        if (
                            path == "screenLockActions:screenUnlock" &&
                                body["args"]!!.jsonObject["pin"]!!.jsonPrimitive.content == "9999"
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
                                    ) """{"success":true}"""
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
            compose.onNodeWithText("Manager Override").performClick()
            compose
                .onNodeWithText("A manager can unlock this screen with their PIN.")
                .assertExists()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Morgan").fetchSemanticsNodes().isNotEmpty()
            }
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
            compose.onNodeWithContentDescription("Close").performClick()
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
}
