package com.pmgt.pos.orders

import android.content.Context
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogWindowProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.*
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.catalog.LocalCatalogRepository
import com.pmgt.pos.db.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class OrderDialogUiTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun tabAndVoidAutomaticallyFocusRetainInputOnRemountAndSaveThroughRealEditor() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = PosDatabase(AndroidSqliteDriver(LegacySqlSchema, context, null))
        db.applyRemote("stores", listOf(row("s", "vat_rate" to 12)), emptyList(), emptyList())
        // A real snapshotted product name makes the actual Void Item dialog taller than the
        // available viewport. The cart still uses its source single-line truncation.
        val productName = "Chicken with a very long preparation description ".repeat(60)
        db.applyRemote(
            "products",
            listOf(row("p", "store_id" to "s", "name" to productName, "price" to 112)),
            emptyList(),
            emptyList(),
        )
        val repo = LocalOrderRepository(db, Dispatchers.IO, { "test" })
        val id = runBlocking {
            repo.createOrder(NewOrder("s")).also {
                repo.addItem(it, ItemInput("p", 1.0))
                repo.send(it)
            }
        }
        db.updateLocal(
            "orders",
            id,
            buildJsonObject {
                put("tab_number", 1)
                put("tab_name", "Tab 1")
            },
        )
        val hidden = mutableStateOf(false)
        compose.setContent {
            val scope = rememberCoroutineScope()
            val session = remember {
                OrderEditorSession(EditorRoute("s", orderId = id), repo, scope) {}
            }
            if (hidden.value) Text("Locked")
            else
                OrderEditorScreen(
                    session,
                    repo,
                    LocalCatalogRepository(db, Dispatchers.IO),
                    {},
                    {},
                    {},
                )
        }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Tab 1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Tab 1").performClick()
        compose.onNodeWithTag("tab-name").assertIsFocused()
        assertImeVisible(context)
        // Text-edit semantics exclude EntryField's14dp internal padding on each side:
        // centered448dp cap -40dp dialog padding -28dp field padding.
        compose.onNodeWithTag("tab-name").assertWidthIsEqualTo(380.dp)
        compose.onNodeWithTag("tab-name").performTextReplacement("Window table")
        compose.onNodeWithText("Save").performScrollTo().performClick()
        compose.waitUntil(5000) { db.get("orders", id)!!.string("tab_name") == "Window table" }
        compose.onNodeWithText("Update Pax").performClick()
        compose.onNodeWithTag("entry-dialog").assertWidthIsEqualTo(240.dp)
        assertNoOuterScroll()
        compose.onNodeWithText("Cancel", substring = false).performClick()
        compose.onNodeWithText("Transfer", substring = false).performClick()
        assertNoOuterScroll()
        compose.onNodeWithContentDescription("Close dialog").performClick()
        compose.onNodeWithText("View Bill").performClick()
        // Source90%-wide surface, with20dp padding each side, remains distinct from448dp cap.
        compose.onNodeWithTag("entry-dialog").assertWidthIsEqualTo(1112.dp)
        assertNoOuterScroll()
        compose.onNodeWithContentDescription("Close dialog").performClick()
        compose.onNodeWithText("Void", substring = false).performClick()
        compose.onNodeWithTag("void-reason").assertIsFocused()
        assertImeVisible(context)
        compose.onNodeWithTag("void-reason").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("void-reason").performTextInput("Entered twice")
        compose.runOnIdle { hidden.value = true }
        compose.onNodeWithTag("void-reason").assertDoesNotExist()
        compose.runOnIdle { hidden.value = false }
        compose.onNodeWithTag("void-reason").assertTextEquals("Entered twice").assertIsFocused()
        compose.onNodeWithText("Confirm Void").performScrollTo().assertIsDisplayed().performClick()
        compose.waitUntil(5000) { db.select("order_items").single().boolean("is_voided") }
    }

    @Test
    fun centeredDialogScrollsEntireContentAndKeepsNarrowHorizontalGutters() {
        var completed = false
        compose.setContent {
            EntryDialog("Scroll check", {}) {
                // Constrain only this test's real Dialog window to360x320dp. No display/settings
                // mutation or production-only test seam; this is not a physical-phone claim.
                val window = (LocalView.current.parent as DialogWindowProvider).window
                SideEffect { window.setLayout(720, 640) }
                repeat(30) { Text("Long content row $it") }
                EntryButton("Complete", { completed = true }, Modifier.fillMaxWidth())
            }
        }
        compose.onNodeWithText("Complete").performScrollTo().assertIsDisplayed().performClick()
        assertTrue(completed)
        compose.onNodeWithText("Scroll check").performScrollTo()
        val left = compose.onNodeWithText("Scroll check").fetchSemanticsNode().boundsInRoot.left
        assertEquals("16dp gutter plus20dp content padding", 36f * 2f, left, 1f)
    }

    private fun assertImeVisible(context: Context) {
        val packageName =
            Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
                .substringBefore('/')
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        assertTrue(
            "Auto-focused editor must show the installed IME",
            device.wait(Until.hasObject(By.pkg(packageName)), 5000),
        )
    }

    private fun assertNoOuterScroll() {
        compose
            .onNodeWithTag("entry-dialog")
            .assert(
                SemanticsMatcher("No outer scroll around PAX or virtualized lists") {
                    !it.config.contains(SemanticsProperties.VerticalScrollAxisRange)
                }
            )
    }
}
