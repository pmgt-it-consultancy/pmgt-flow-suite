package com.pmgt.pos.orders

import android.content.Context
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.AnnotatedString
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.browse.*
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.catalog.LocalCatalogRepository
import com.pmgt.pos.db.*
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class OrderEditorUiWorkflowTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun persistedEditorCancellationConfirmsAndPreservesChildrenWhileReleasingLastTable() {
        val faults =
            OrderFaultDriver(
                AndroidSqliteDriver(
                    LegacySqlSchema,
                    ApplicationProvider.getApplicationContext<Context>(),
                    null,
                )
            )
        val db = PosDatabase(faults)
        db.applyRemote("stores", listOf(row("s", "vat_rate" to 12)), emptyList(), emptyList())
        db.applyRemote(
            "tables",
            listOf(row("t", "store_id" to "s", "name" to "Table 1", "status" to "available")),
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
                    "price" to 112,
                    "is_vatable" to true,
                )
            ),
            emptyList(),
            emptyList(),
        )
        val repo = LocalOrderRepository(db, Dispatchers.IO, { "test" })
        db.applyRemote(
            "products",
            listOf(
                row(
                    "rice",
                    "store_id" to "s",
                    "name" to "Rice",
                    "price" to 10,
                    "is_vatable" to true,
                )
            ),
            emptyList(),
            emptyList(),
        )
        val id = runBlocking {
            repo.createOrder(NewOrder("s", tableId = "t")).also {
                repo.addItem(it, ItemInput("p", 1.0))
                repo.addItem(it, ItemInput("rice", 1.0))
            }
        }
        val wentBack = java.util.concurrent.atomic.AtomicBoolean()
        val hidden = mutableStateOf(false)
        compose.setContent {
            val scope = rememberCoroutineScope()
            val owners = remember { EditorSessions(scope) }
            if (hidden.value) Text("Locked")
            else {
                val session = owners.get("u:s", "route", EditorRoute("s", "t", "Table 1", id), repo)
                OrderEditorScreen(
                    session,
                    repo,
                    LocalCatalogRepository(db, Dispatchers.IO),
                    { wentBack.set(true) },
                    {},
                    {},
                )
            }
        }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Cancel Order").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription("Increase Chicken quantity").performClick()
        compose.waitUntil(5000) { db.get("orders", id)!!.number("net_sales") == 234.0 }
        assertTrue(
            compose.onNodeWithText("Chicken").fetchSemanticsNode().boundsInRoot.top <
                compose.onNodeWithText("Rice").fetchSemanticsNode().boundsInRoot.top
        )
        compose.onNodeWithText("Cancel Order").performClick()
        compose.onNodeWithText("No", substring = false).performClick()
        assertEquals("open", db.get("orders", id)!!.string("status"))
        faults.failNextTableWrite = true
        compose.onNodeWithText("Cancel Order").performClick()
        compose.onNodeWithText("Yes, Cancel").performClick()
        compose.waitUntil(5000) {
            compose
                .onAllNodesWithText("Simulated table update failure")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        assertFalse(wentBack.get())
        assertEquals(1, db.select("order_voids").size)
        compose.runOnIdle { hidden.value = true }
        compose.onNodeWithText("Locked").assertExists()
        compose.onNodeWithText("Simulated table update failure").assertDoesNotExist()
        compose.runOnIdle { hidden.value = false }
        compose.onNodeWithText("OK").performClick()
        compose.onNodeWithText("Cancel Order").performClick()
        compose.onNodeWithText("Yes, Cancel").performClick()
        compose.waitUntil(5000) { wentBack.get() }
        assertEquals("voided", db.get("orders", id)!!.string("status"))
        assertEquals("available", db.get("tables", "t")!!.string("status"))
        assertEquals(2, db.select("order_items").size)
        assertEquals(1, db.select("order_voids").size)
        assertEquals(
            "Order cancelled by cashier",
            db.select("order_voids").single().string("reason"),
        )
        assertEquals(234.0, db.select("order_voids").single().number("amount"), 0.0)
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val context = ApplicationProvider.getApplicationContext<Context>()
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val file = File(context.getExternalFilesDir(null), "order-$name.png")
        check(device.takeScreenshot(file))
        device.executeShellCommand("cp ${file.absolutePath} /sdcard/Download/order-$name.png")
    }

    @Test
    fun tableDraftMenuCartPaxSendAndResumeUseRealSqlite() {
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
                    "is_vatable" to true,
                    "is_active" to true,
                )
            ),
            emptyList(),
            emptyList(),
        )
        val repo = LocalOrderRepository(db, Dispatchers.IO, { "test" })
        compose.setContent {
            PosBrowseRoot(
                SignedInUser("u", "Ana", "a@b.test", "s", null),
                LocalBrowseRepository(db, Dispatchers.IO),
                flowOf(null),
                "Offline",
                false,
                {},
                {},
                {},
                {},
                entryRepository = repo,
                catalogRepository = LocalCatalogRepository(db, Dispatchers.IO),
            )
        }
        compose.onNodeWithText("Open tables").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Table 1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Table 1").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("No items in order").fetchSemanticsNodes().isNotEmpty()
        }
        assertTrue(db.select("orders").isEmpty())
        compose.onNodeWithText("Meals").performClick()
        compose.onNodeWithText("Chicken").performClick()
        compose.onNodeWithText("Add to Order").assertExists()
        compose.onNodeWithText("Add 1 to Order", substring = false).performClick()
        compose.onNodeWithTag("cart-quantity-draft-1").assertTextEquals("1")
        val menuBounds = compose.onNodeWithTag("order-menu").fetchSemanticsNode().boundsInRoot
        val cartBounds = compose.onNodeWithTag("order-cart").fetchSemanticsNode().boundsInRoot
        assertEquals(2.0, (menuBounds.width / cartBounds.width).toDouble(), .01)
        val sendPixels = compose.onNodeWithText("Send to Kitchen").captureToImage().toPixelMap()
        assertEquals(Color(0xFF22C55E).toArgb(), sendPixels[sendPixels.width / 2, 4].toArgb())
        screenshot("dine-in-draft")
        compose.onNodeWithContentDescription("Increase Chicken quantity").performClick()
        compose.onNodeWithContentDescription("Increase Chicken quantity").performClick()
        compose.onNodeWithText("Send to Kitchen").performClick()
        screenshot("pax")
        compose.onNodeWithTag("pax-input").performTextInput("4")
        compose.onNodeWithText("Confirm").performClick()
        compose.waitUntil(5000) {
            db.select("orders").size == 1 &&
                db.select("order_items").singleOrNull()?.boolean("is_sent_to_kitchen") == true
        }
        // The sent-item batch intentionally precedes recalc. This existing printer seam is
        // reached only after session.send/createAndSend has awaited that later recalc phase.
        compose.waitUntil(5000) {
            compose
                .onAllNodesWithText(
                    "Kitchen printing is not available in this build yet. The order is saved locally."
                )
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        assertEquals(3.0, db.select("orders").single().number("item_count"), 0.0)
        assertEquals(336.0, db.select("orders").single().number("net_sales"), 0.0)
        compose.onNodeWithText("Sent", substring = false).assertDoesNotExist()
        compose.onNodeWithText("OK").performClick()
        compose.onNodeWithText("Close Table").assertExists()
        compose.onNodeWithText("Cancel Order").assertDoesNotExist()
        compose.onNodeWithText("Qty: 3").assertExists()
        screenshot("dine-in-sent")
    }

    @Test
    fun takeoutResumePreservesSourceCategoryResetBlankIgnoreAndCheckoutMetadata() {
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
                    "is_vatable" to true,
                    "is_active" to true,
                )
            ),
            emptyList(),
            emptyList(),
        )
        val repo = LocalOrderRepository(db, Dispatchers.IO, { "test" })
        val id = runBlocking {
            repo.createDraft("s").also { repo.customer(it, "Ana", "dine_in", "old") }
        }
        val checkout = AtomicReference<CheckoutRoute>()
        val billPrints = AtomicInteger()
        val billedQuantity = AtomicReference<Double>()
        compose.setContent {
            val scope = rememberCoroutineScope()
            val session = remember {
                OrderEditorSession(EditorRoute("s", orderId = id, takeout = true), repo, scope) {}
            }
            OrderEditorScreen(
                session,
                repo,
                LocalCatalogRepository(db, Dispatchers.IO),
                {},
                {},
                checkout::set,
                printBill = {
                    billedQuantity.set(repo.cart("s", it).filterNotNull().first().lines.single().quantity)
                    billPrints.incrementAndGet()
                },
            )
        }
        compose.waitUntil(5000) {
            compose.onAllNodesWithTag("customer-name").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("customer-name").assertTextEquals("Ana")
        compose
            .onNodeWithTag("table-marker")
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(""))
            )
        compose.waitUntil(5000) { db.get("orders", id)!!.string("order_category") == "takeout" }
        compose.onNodeWithTag("customer-name").performTextClearance()
        compose.onNodeWithTag("table-marker").performTextInput("15")
        compose.onNodeWithTag("customer-name").performClick()
        compose.waitUntil(5000) { db.get("orders", id)!!.string("table_marker") == "15" }
        assertEquals("Ana", db.get("orders", id)!!.string("customer_name"))
        compose.onNodeWithText("Dine-in").performClick()
        compose.onNodeWithText("Meals").performClick()
        compose.onNodeWithText("Chicken").performClick()
        compose.onNodeWithText("Add 1 to Order").performClick()
        compose.waitUntil(5000) { db.select("order_items").isNotEmpty() }
        compose.onNodeWithContentDescription("Increase Chicken quantity").performClick()
        val viewBillTop = compose.onNodeWithText("View Bill").fetchSemanticsNode().boundsInRoot.top
        val paymentTop =
            compose.onNodeWithText("Proceed to Payment").fetchSemanticsNode().boundsInRoot.top
        assertTrue("View Bill must appear above payment", viewBillTop < paymentTop)
        compose.onNodeWithText("View Bill").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Print Bill").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Print Bill").performClick()
        compose.waitUntil(5000) { billPrints.get() == 1 }
        assertEquals(2.0, billedQuantity.get(), 0.0)
        assertNull(checkout.get())
        assertEquals("draft", db.get("orders", id)!!.string("status"))
        compose.onNodeWithText("Current Bill").assertExists()
        compose.onNodeWithContentDescription("Close dialog").performClick()
        val paymentPixels =
            compose.onNodeWithText("Proceed to Payment").captureToImage().toPixelMap()
        assertEquals(Color(0xFF0D87E1).toArgb(), paymentPixels[paymentPixels.width / 2, 4].toArgb())
        screenshot("takeout-cart")
        compose.onNodeWithText("Proceed to Payment").performClick()
        compose.waitUntil(5000) { checkout.get() != null }
        assertEquals("dine_in", checkout.get().orderCategory)
        assertEquals("15", checkout.get().tableMarker)
        assertEquals("takeout", checkout.get().orderType)
        assertNull(checkout.get().tableId)
        assertEquals("open", db.get("orders", id)!!.string("status"))
        assertEquals(2.0, db.get("orders", id)!!.number("item_count"), 0.0)
    }
}
