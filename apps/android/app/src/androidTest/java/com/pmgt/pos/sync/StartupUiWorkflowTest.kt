package com.pmgt.pos.sync

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.material3.Text
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import com.pmgt.pos.auth.*
import com.pmgt.pos.db.*
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

class StartupUiWorkflowTest {
    @get:Rule val compose = createComposeRule()

    @Test fun signedInShellHidesSellingUntilRealStorageAndAuthenticatedReferencesAreReady() {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val name = "startup-gate-${UUID.randomUUID()}"
        val root = File(base.cacheDir, name).apply { mkdirs() }
        val context = object : ContextWrapper(base) {
            override fun getDatabasePath(name: String): File = if (File(name).isAbsolute) File(name) else File(root, "databases/$name")
            override fun getSharedPreferences(prefName: String, mode: Int) = base.getSharedPreferences("$name-$prefName", mode)
        }
        val db = AndroidDatabase.open(context)
        db.applyRemote("orders", listOf(buildJsonObject { put("id", "local"); put("server_id", "server") }), emptyList(), emptyList())
        val originalIdentity = DeviceIdentity.readOrCreate(context, adopting = true)
        db.close()
        MockWebServer().use { server ->
            var verification = "offline"
            val paths = CopyOnWriteArrayList<String>()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    paths += request.path!!
                    if (request.path == "/sync/pull") {
                        if (verification == "offline") return MockResponse().setResponseCode(503)
                        return MockResponse().setBody("""{"changes":{},"cursors":{},"complete":true,"timestamp":100}""")
                    }
                    if (request.path == "/sync/registerDevice") return MockResponse().setBody("""{"deviceCode":"07"}""")
                    val path = Json.parseToJsonElement(request.body.clone().readUtf8()).jsonObject["path"]!!.jsonPrimitive.content
                    val value = when (path) {
                        "auth:signIn" -> """{"tokens":{"token":"test-access","refreshToken":"test-refresh"}}"""
                        "sessions:getCurrentUser" -> """{"_id":"user","name":"Cashier","storeId":"store","role":{"_id":"role","name":"Cashier","scopeLevel":"branch","permissions":["orders.create"]}}"""
                        "screenLock:getUserHasPin" -> "false"
                        "screenLock:getAutoLockTimeout" -> "0"
                        "orders:get" -> if (verification == "missing") "null" else """{"_id":"server","storeId":"store"}"""
                        else -> "null"
                    }
                    return MockResponse().setBody("""{"status":"success","value":$value}""")
                }
            }
            server.start()
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, MemorySessionStorage())
            val lock = LockState(object : LockStorage {
                override fun read() = LockSnapshot()
                override fun write(snapshot: LockSnapshot) = Unit
            }, http)
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            var adopted: PosDatabase? = null
            val startup = TabletStartup({
                val opened = AndroidDatabase.open(context).also { adopted = it }
                AdoptedStorage(opened, DeviceIdentity.readOrCreate(context, adopting = true))
            }, http, scope, Dispatchers.IO, MutableStateFlow(true))
            runBlocking { auth.signIn("cashier@example.com", "test-password") }
            startup.bind(auth.state)
            compose.setContent {
                PosAuthShell(auth, lock, http, configured = false, startup = startup) { Text("Selling content") }
            }
            compose.waitUntil(5_000) { startup.state.value.userId != null && !startup.state.value.verifying }
            compose.onNodeWithTag("adoption-gate").assertExists()
            compose.onNodeWithText("Selling content").assertDoesNotExist()
            assertFalse(paths.contains("/sync/registerDevice"))
            verification = "missing"
            compose.onNodeWithText("Retry verification").performClick()
            compose.waitUntil(5_000) { startup.state.value.adoption is AdoptionState.Blocked }
            compose.onNodeWithText("Tablet setup blocked").assertExists()
            compose.onNodeWithText("Selling content").assertDoesNotExist()
            verification = "ready"
            compose.onNodeWithText("Retry verification").performClick()
            compose.waitUntil(5_000) { startup.state.value.adoption is AdoptionState.Ready }
            compose.onNodeWithText("Selling content").assertExists()
            compose.onNodeWithTag("adoption-gate").assertDoesNotExist()
            assertEquals(originalIdentity, DeviceIdentity.readOrCreate(context, adopting = true))
            assertEquals("server", startup.database!!.get("orders", "local")!!["server_id"]!!.jsonPrimitive.content)
            startup.stop(); scope.cancel(); adopted?.close()
        }
    }
}
