package com.pmgt.pos.orders

import android.content.Context
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.auth.*
import com.pmgt.pos.browse.*
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.catalog.*
import com.pmgt.pos.db.*
import com.pmgt.pos.db.string
import com.pmgt.pos.transport.ConvexHttp
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class OrderLockUiTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun actualManualAndIdleLockRetainDraftAndStopHiddenCatalogObservation() {
        MockWebServer().use { server ->
            server.dispatcher =
                object : okhttp3.mockwebserver.Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val path =
                            Json.parseToJsonElement(request.body.readUtf8())
                                .jsonObject["path"]!!
                                .jsonPrimitive
                                .content
                        val value =
                            when (path) {
                                "auth:signIn" ->
                                    """{"tokens":{"token":"test-access","refreshToken":"test-refresh"}}"""
                                "sessions:getCurrentUser" ->
                                    """{"_id":"u","name":"Ana","storeId":"s","role":{"_id":"r","name":"Cashier","scopeLevel":"branch","permissions":[]}}"""
                                "screenLock:getUserHasPin" -> "true"
                                "screenLock:getAutoLockTimeout" -> "60"
                                "screenLockActions:screenUnlock" -> """{"success":true}"""
                                "stores:get" -> """{"name":"Test Store"}"""
                                else -> "null"
                            }
                        return MockResponse().setBody("""{"status":"success","value":$value}""")
                    }
                }
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, MemorySessionStorage())
            val now = AtomicLong(1000)
            val lock =
                LockState(
                    object : LockStorage {
                        override fun read() = LockSnapshot()

                        override fun write(snapshot: LockSnapshot) {}
                    },
                    http,
                    now::get,
                )
            runBlocking { auth.signIn("a@b.test", "password") }
            val db =
                PosDatabase(
                    AndroidSqliteDriver(
                        LegacySqlSchema,
                        ApplicationProvider.getApplicationContext<Context>(),
                        null,
                    )
                )
            db.applyRemote("stores", listOf(row("s", "vat_rate" to 12)), emptyList(), emptyList())
            db.applyRemote(
                "tables",
                listOf(
                    row(
                        "t",
                        "store_id" to "s",
                        "name" to "Table 1",
                        "is_active" to true,
                        "status" to "available",
                    )
                ),
                emptyList(),
                emptyList(),
            )
            db.applyRemote(
                "categories",
                listOf(row("c", "store_id" to "s", "name" to "Meals", "is_active" to true)),
                emptyList(),
                emptyList(),
            )
            db.applyRemote(
                "products",
                listOf(
                    row(
                        "p",
                        "store_id" to "s",
                        "name" to "Chicken",
                        "category_id" to "c",
                        "price" to 112,
                        "is_open_price" to true,
                        "min_price" to 112,
                        "max_price" to 200,
                        "is_vatable" to true,
                        "is_active" to true,
                    )
                ),
                emptyList(),
                emptyList(),
            )
            val repo = LocalOrderRepository(db, Dispatchers.IO, { "test" })
            val saveStarted = CompletableDeferred<Unit>()
            val releaseSave = CompletableDeferred<Unit>()
            val gatedRepo =
                object : OrderEntryRepository by repo {
                    override suspend fun quantity(itemId: String, quantity: Double) {
                        if (!saveStarted.isCompleted) {
                            saveStarted.complete(Unit)
                            releaseSave.await()
                        }
                        repo.quantity(itemId, quantity)
                    }
                }
            val catalog = LocalCatalogRepository(db, Dispatchers.IO)
            val collectors = AtomicInteger()
            val observedCatalog =
                object : CatalogRepository by catalog {
                    override fun catalog(storeId: String): Flow<Catalog> = flow {
                        collectors.incrementAndGet()
                        try {
                            emitAll(catalog.catalog(storeId))
                        } finally {
                            collectors.decrementAndGet()
                        }
                    }
                }
            compose.setContent {
                val scope = rememberCoroutineScope()
                val sessions = remember { EditorSessions(scope) }
                val holder = rememberSaveableStateHolder()
                PosAuthShell(auth, lock, http, configured = false, showTestControls = true) { user
                    ->
                    holder.SaveableStateProvider("${user.id}:${user.storeId}") {
                        PosBrowseRoot(
                            user,
                            LocalBrowseRepository(db, Dispatchers.IO),
                            flowOf(null),
                            "Offline",
                            true,
                            {},
                            {},
                            {},
                            lock::setCurrentRoute,
                            entryRepository = gatedRepo,
                            catalogRepository = observedCatalog,
                            editorSessions = sessions,
                        )
                    }
                }
            }
            compose.onNodeWithText("Open tables").performClick()
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("Table 1").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Table 1").performClick()
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("Meals").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Meals").performClick()
            compose.onNodeWithText("Chicken").performClick()
            compose.onNodeWithTag("product-notes").performTextInput("Keep this note")
            compose.onNodeWithTag("product-price").performTextReplacement("140")
            compose.onNodeWithContentDescription("Increase quantity").performClick()
            runBlocking { lock.lock(auth.state.value.user!!) }
            compose.waitUntil(5000) { lock.state.value.snapshot.isLocked && collectors.get() == 0 }
            compose.onNodeWithTag("product-sheet").assertDoesNotExist()
            runBlocking { lock.unlock("s", "1234") }
            compose.waitUntil(5000) {
                compose.onAllNodesWithTag("product-sheet").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("product-notes").assertTextEquals("Keep this note")
            compose.onNodeWithTag("product-price").assertTextEquals("140")
            compose.onNodeWithTag("product-quantity").assertTextEquals("2")
            compose.onNodeWithContentDescription("Close product").performClick()
            compose.onNodeWithText("Chicken").performClick()
            compose
                .onNodeWithTag("product-notes")
                .assert(
                    SemanticsMatcher.expectValue(
                        androidx.compose.ui.semantics.SemanticsProperties.EditableText,
                        androidx.compose.ui.text.AnnotatedString(""),
                    )
                )
            compose.onNodeWithTag("product-price").assertTextEquals("112")
            compose.onNodeWithTag("product-quantity").assertTextEquals("1")
            compose.onNodeWithText("Add 1 to Order").performClick()
            compose.onNodeWithContentDescription("Increase Chicken quantity").performClick()
            compose.onNodeWithText("Lock screen").performClick()
            compose.waitUntil(5000) { lock.state.value.snapshot.isLocked && collectors.get() == 0 }
            compose.onNodeWithText("No items in order").assertDoesNotExist()
            assertTrue(db.select("orders").isEmpty())
            runBlocking { lock.unlock("s", "1234") }
            compose.waitUntil(5000) {
                compose
                    .onAllNodesWithTag("cart-quantity-draft-1")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithTag("cart-quantity-draft-1").assertTextEquals("2")
            assertEquals(1, collectors.get())
            now.addAndGet(3_600_001)
            runBlocking { lock.tick(auth.state.value.user!!) }
            compose.waitUntil(5000) { lock.state.value.snapshot.isLocked && collectors.get() == 0 }
            runBlocking { lock.unlock("s", "1234") }
            compose.waitUntil(5000) {
                compose
                    .onAllNodesWithTag("cart-quantity-draft-1")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithTag("cart-quantity-draft-1").assertTextEquals("2")
            assertTrue(db.select("orders").isEmpty())
            // Persist the draft, add an unsent line, then lock with one save in flight and a newer
            // edit.
            compose.onNodeWithText("Send to Kitchen").performClick()
            compose.onNodeWithTag("pax-input").performTextInput("2")
            runBlocking { lock.lock(auth.state.value.user!!) }
            compose.waitUntil(5000) { lock.state.value.snapshot.isLocked }
            compose.onNodeWithTag("pax-input").assertDoesNotExist()
            runBlocking { lock.unlock("s", "1234") }
            compose.waitUntil(5000) {
                compose.onAllNodesWithTag("pax-input").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("pax-input").assertTextEquals("2")
            compose.onNodeWithText("Confirm").performClick()
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("OK").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("OK").performClick()
            compose.onNodeWithText("Meals").performClick()
            compose.onAllNodesWithText("Chicken").onFirst().performClick()
            compose.onNodeWithText("Add 1 to Order").performClick()
            compose.waitUntil(5000) { db.select("order_items").size == 2 }
            compose.onNodeWithContentDescription("Increase Chicken quantity").performClick()
            compose.waitUntil(5000) { saveStarted.isCompleted }
            compose.onNodeWithContentDescription("Increase Chicken quantity").performClick()
            compose.onNodeWithText("Lock screen").performClick()
            compose.waitUntil(5000) { lock.state.value.snapshot.isLocked && collectors.get() == 0 }
            releaseSave.complete(Unit)
            compose.waitUntil(5000) {
                db.select("order_items")
                    .single { !it.boolean("is_sent_to_kitchen") }
                    .number("quantity") == 3.0
            }
            runBlocking { lock.unlock("s", "1234") }
            val itemId =
                db.select("order_items").single { !it.boolean("is_sent_to_kitchen") }.string("id")!!
            compose.waitUntil(5000) {
                compose
                    .onAllNodesWithTag("cart-quantity-$itemId")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithTag("cart-quantity-$itemId").assertTextEquals("3")
            assertEquals(5.0, db.select("orders").single().number("item_count"), 0.0)
        }
    }
}
