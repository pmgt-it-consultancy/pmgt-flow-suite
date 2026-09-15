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

    @Test fun cashierSignsInLocksUnlocksAndSignsOut() {
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
                    val value = when (body["path"]?.jsonPrimitive?.content) {
                        "auth:signIn" -> """{"tokens":{"token":"access","refreshToken":"refresh"}}"""
                        "auth:signOut" -> "null"
                        "sessions:getCurrentUser" -> """{"_id":"cashier","name":"Alex","storeId":"store","role":{"_id":"role","name":"Cashier","scopeLevel":"branch","permissions":["orders.create"]}}"""
                        "screenLock:getUserHasPin" -> "true"
                        "screenLock:getAutoLockTimeout" -> "5"
                        "stores:get" -> """{"name":"Test Restaurant"}"""
                        "screenLock:screenLock" -> "null"
                        "screenLockActions:screenUnlock" -> if (body["args"]!!.jsonObject["pin"]!!.jsonPrimitive.content == "1234") """{"success":true}""" else """{"success":false,"error":"Invalid PIN"}"""
                        else -> return MockResponse().setResponseCode(500)
                    }
                    return MockResponse().setBody("""{"status":"success","value":$value}""")
                }
            }
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, MemorySessionStorage())
            val lock = LockState(object : LockStorage {
                private var snapshot = LockSnapshot()
                override fun read() = snapshot
                override fun write(snapshot: LockSnapshot) { this.snapshot = snapshot }
            }, http)
            compose.setContent { PosAuthShell(auth, lock, http, configured = true) { Text(if (auth.hasPermission("discounts.approve")) "Can approve" else "Cashier permissions") } }
            compose.onNodeWithText("Email").performTextInput("cashier@example.com")
            compose.onNodeWithText("Password").performTextInput("password")
            compose.onNodeWithText("Sign in", useUnmergedTree = true).performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Test Restaurant").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Cashier permissions").assertExists()
            compose.onNodeWithText("Lock screen").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Screen locked").fetchSemanticsNodes().isNotEmpty() }
            listOf("1", "2", "3", "4").forEach { compose.onNodeWithText(it).performClick() }
            compose.onNodeWithText("Unlock").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Sign out").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Sign out").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Sign in", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Email").assertExists()
        }
    }
}
