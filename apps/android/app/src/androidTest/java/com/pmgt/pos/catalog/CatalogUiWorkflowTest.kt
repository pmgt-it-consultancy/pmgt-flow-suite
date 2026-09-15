package com.pmgt.pos.catalog

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.db.*
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CatalogUiWorkflowTest {
    @get:Rule val compose = createComposeRule()
    private val meal = CatalogProduct("p", "Meal", "child", 112.0, true, true)
    private val menu =
        Catalog(
            listOf(
                meal,
                CatalogProduct("open", "Open item", "root", 0.0, false, false, true, 10.0, 20.0),
            ),
            listOf(
                CatalogCategory("root", "Food", null, 1),
                CatalogCategory("child", "Rice", "root", 1),
            ),
        )
    private val regular = ModifierOption("r", "Regular", 0.0, true)
    private val large = ModifierOption("l", "Large", 20.0, false)
    private val size = ModifierGroup("g", "Size", "single", 1.0, 1.0, listOf(regular, large))

    private class Repository(
        val menu: Catalog,
        val groups: MutableStateFlow<List<ModifierGroup>?>,
    ) : CatalogRepository {
        val active = AtomicInteger()

        override fun catalog(storeId: String): Flow<Catalog> = flow {
            active.incrementAndGet()
            try {
                emit(menu)
                kotlinx.coroutines.awaitCancellation()
            } finally {
                active.decrementAndGet()
            }
        }

        override fun modifiers(storeId: String, productId: String) = groups
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val context = ApplicationProvider.getApplicationContext<Context>()
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val file = File(context.getExternalFilesDir(null), "catalog-$name.png")
        check(device.takeScreenshot(file))
        device.executeShellCommand("cp ${file.absolutePath} /sdcard/Download/catalog-$name.png")
    }

    @Test
    fun takeoutSimpleQuantityAndNotesSurviveModifierVisibilityButPriceAndModifierSessionsReset() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = PosDatabase(AndroidSqliteDriver(LegacySqlSchema, context, null))
        CatalogDatabaseContract.seed(db)
        val repository = LocalCatalogRepository(db, Dispatchers.IO)
        val product = SelectedProduct("orphan", "Open special", 0.0, true, true, 10.0, 20.0)
        val selected = mutableStateOf<SelectedProduct?>(product)
        compose.setContent {
            ProductSelectionSheet(
                "s",
                selected.value,
                repository,
                CatalogEntryPoint.Takeout,
                false,
                { selected.value = null },
                {},
            )
        }
        fun awaitTitle(title: String) {
            compose.waitUntil(5000) {
                compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty()
            }
        }
        fun groupActive(active: Boolean) {
            db.updateLocal(
                "modifier_groups",
                "inactiveGroup",
                JsonObject(row("inactiveGroup", "is_active" to active) - "id"),
            )
        }
        awaitTitle("Add to Order")
        compose.onNodeWithContentDescription("Increase quantity").performClick()
        compose.onNodeWithContentDescription("Increase quantity").performClick()
        compose.onNodeWithTag("product-notes").performTextInput("Simple notes")
        compose.onNodeWithTag("product-notes").performImeAction()
        compose.onNodeWithTag("product-price").performTextReplacement("17")
        groupActive(true)
        awaitTitle("Customize Order")
        compose.onNodeWithTag("product-quantity").assertTextEquals("1")
        compose
            .onNodeWithTag("product-notes")
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(""))
            )
        compose.onNodeWithTag("product-price").assertTextEquals("10")
        compose.onNodeWithContentDescription("Increase quantity").performClick()
        compose.onNodeWithTag("product-notes").performTextInput("Modifier notes")
        compose.onNodeWithTag("product-notes").performImeAction()
        compose.onNodeWithTag("product-price").performTextReplacement("18")
        groupActive(false)
        awaitTitle("Add to Order")
        compose.onNodeWithTag("product-quantity").assertTextEquals("3")
        compose.onNodeWithTag("product-notes").assertTextEquals("Simple notes")
        compose.onNodeWithTag("product-price").assertTextEquals("10")
        groupActive(true)
        awaitTitle("Customize Order")
        compose.onNodeWithTag("product-quantity").assertTextEquals("1")
        compose
            .onNodeWithTag("product-notes")
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(""))
            )
        compose.onNodeWithTag("product-price").assertTextEquals("10")
        groupActive(false)
        awaitTitle("Add to Order")
        compose.onNodeWithTag("product-quantity").assertTextEquals("3")
        compose.onNodeWithTag("product-notes").assertTextEquals("Simple notes")
        compose.onNodeWithContentDescription("Close product").performClick()
        compose.onNodeWithTag("product-sheet").assertDoesNotExist()
        compose.runOnIdle { selected.value = product }
        awaitTitle("Add to Order")
        compose.onNodeWithTag("product-quantity").assertTextEquals("1")
        compose
            .onNodeWithTag("product-notes")
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(""))
            )
        compose.onNodeWithTag("product-price").assertTextEquals("10")
        db.close()
    }

    @Test
    fun relevantDatabaseRefreshPublishesLoadingWithoutResettingTheCashierSession() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = PosDatabase(AndroidSqliteDriver(LegacySqlSchema, context, null))
        CatalogDatabaseContract.seed(db)
        val local = LocalCatalogRepository(db, Dispatchers.IO)
        val resume = CompletableDeferred<Unit>()
        val transitions = AtomicInteger()
        // Hold delivery after the REAL repository's null emission, so a fast SQLite rebuild cannot
        // conflate away the intermediate render while instrumentation traverses the semantics tree.
        val controlled =
            object : CatalogRepository by local {
                override fun modifiers(storeId: String, productId: String) =
                    local.modifiers(storeId, productId).transform { groups ->
                        emit(groups)
                        if (groups == null) {
                            transitions.incrementAndGet()
                            resume.await()
                        }
                    }
            }
        compose.setContent {
            ProductSelectionSheet(
                "s",
                meal.snapshot(),
                controlled,
                CatalogEntryPoint.DineIn,
                false,
                {},
                {},
            )
        }
        compose.waitUntil(5000) {
            compose.onAllNodesWithTag("option-g-large").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("option-g-large").performClick()
        compose.onNodeWithTag("product-notes").performTextInput("Keep notes")
        compose.onNodeWithTag("product-notes").performImeAction()
        db.updateLocal(
            "modifier_options",
            "large",
            JsonObject(row("large", "updated_at" to 999) - "id"),
        )
        compose.waitForIdle()
        assertEquals(0, transitions.get())
        db.updateLocal(
            "modifier_options",
            "large",
            JsonObject(row("large", "price_adjustment" to 25) - "id"),
        )
        compose.waitUntil(5000) { transitions.get() == 1 }
        compose.onNodeWithText("Adding...").assertIsDisplayed()
        compose.onNodeWithTag("product-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("product-notes").assertTextContains("Keep notes")
        resume.complete(Unit)
        compose.waitUntil(5000) {
            compose.onAllNodesWithTag("option-g-large").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("option-g-large").assertIsSelected()
        compose.onNodeWithTag("product-total").assertTextEquals("₱137.00")
        compose.onNodeWithTag("product-notes").assertTextContains("Keep notes")
        db.close()
    }

    @Test
    fun adoptedDatabaseMenuSelectionRefreshAndConfirmationUseTypedSnapshot() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = PosDatabase(AndroidSqliteDriver(LegacySqlSchema, context, null))
        CatalogDatabaseContract.seed(db)
        val repo = LocalCatalogRepository(db, Dispatchers.IO)
        var choice: ProductChoice? = null
        compose.setContent {
            var selected by remember { mutableStateOf<SelectedProduct?>(null) }
            Row(Modifier.fillMaxSize()) {
                CatalogMenu("s", repo, { selected = it }, Modifier.weight(2f).fillMaxHeight())
                Box(Modifier.weight(1f)) { Text("Cart boundary — no writes") }
            }
            ProductSelectionSheet(
                "s",
                selected,
                repo,
                CatalogEntryPoint.DineIn,
                false,
                { selected = null },
                {
                    choice = it
                    selected = null
                },
            )
        }
        compose.waitUntil(5000) {
            compose.onAllNodesWithTag("catalog-tile-root").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("catalog-tile-root").performClick()
        compose.onNodeWithTag("catalog-tile-child").performClick()
        screenshot("grid")
        compose.onNodeWithTag("catalog-tile-p").performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithTag("option-g-large").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("product-confirm").assertIsNotEnabled() // Required empty Extra group.
        compose.onNodeWithTag("option-g-large").performClick()
        compose.onNodeWithTag("product-notes").performTextInput("No sauce")
        compose.onNodeWithTag("product-notes").performImeAction()
        db.updateLocal(
            "modifier_groups",
            "extra",
            JsonObject(row("extra", "min_selections" to 0) - "id"),
        )
        db.updateLocal(
            "products",
            "p",
            JsonObject(row("p", "name" to "Renamed product", "price" to 200) - "id"),
        )
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Required").fetchSemanticsNodes().isEmpty()
        }
        compose.onNodeWithText("Kiosk İnez Meal").assertIsDisplayed()
        compose.onNodeWithTag("product-total").assertTextEquals("₱132.00")
        screenshot("modifier-sheet")
        compose.onNodeWithTag("product-confirm").performClick()
        compose.runOnIdle {
            assertEquals("Kiosk İnez Meal", choice!!.product.name)
            assertEquals(112.0, choice!!.product.price, 0.0)
            assertEquals(listOf(ModifierSnapshot("Size", "Large", 20.0)), choice!!.modifiers)
            assertEquals("No sauce", choice!!.notes)
        }
        compose.onNodeWithText("Renamed product").assertIsDisplayed()
        db.close()
    }

    @Test
    fun categorySearchClearBackAndHiddenMenuRetainNavigation() {
        val repo = Repository(menu, MutableStateFlow(listOf(size)))
        val active = mutableStateOf(true)
        compose.setContent {
            Row(Modifier.fillMaxSize()) {
                CatalogMenu("s", repo, {}, Modifier.weight(2f).fillMaxHeight(), active.value)
                Box(Modifier.weight(1f)) { Text("Cart boundary") }
            }
        }
        compose.onNodeWithTag("catalog-tile-root").performClick()
        compose.onNodeWithTag("catalog-tile-child").performClick()
        compose.onNodeWithTag("catalog-tile-p").assertIsDisplayed()
        compose.onNodeWithTag("catalog-search").performTextInput("Open")
        compose.onNodeWithTag("catalog-tile-open").assertIsDisplayed()
        compose.onNodeWithContentDescription("Catalog back").assertDoesNotExist()
        compose.onNodeWithContentDescription("Clear product search").performClick()
        compose.onNodeWithTag("catalog-tile-p").assertIsDisplayed()
        compose.runOnIdle { active.value = false }
        compose.waitUntil { repo.active.get() == 0 }
        compose.runOnIdle { active.value = true }
        compose.waitUntil { repo.active.get() == 1 }
        compose.onNodeWithTag("catalog-tile-p").assertIsDisplayed()
        compose.onNodeWithContentDescription("Catalog back").performClick()
        compose.onNodeWithTag("catalog-tile-child").assertIsDisplayed()
        compose.onNodeWithContentDescription("Catalog back").performClick()
        compose.onNodeWithTag("catalog-tile-root").assertIsDisplayed()
    }

    @Test
    fun modifierRefreshKeepsChoicesNotesAndStickyFooterAtFullWidth() {
        val groups = MutableStateFlow<List<ModifierGroup>?>(listOf(size))
        val repo = Repository(menu, groups)
        var choice: ProductChoice? = null
        compose.setContent {
            ProductSelectionSheet(
                "s",
                meal.snapshot(),
                repo,
                CatalogEntryPoint.DineIn,
                false,
                {},
                { choice = it },
            )
        }
        compose.onNodeWithTag("option-g-r").assertIsSelected()
        compose.onNodeWithTag("option-g-l").performClick()
        compose.onNodeWithTag("product-notes").performTextInput("No ice")
        compose.onNodeWithTag("product-notes").performImeAction()
        compose.onNodeWithContentDescription("Increase quantity").performClick()
        compose.runOnIdle {
            groups.value =
                listOf(size.copy(options = listOf(regular, large.copy(priceAdjustment = 25.0))))
        }
        compose.onNodeWithTag("option-g-l").assertIsSelected()
        compose.onNodeWithTag("product-notes").assertTextContains("No ice")
        compose.onNodeWithTag("product-total").assertTextEquals("₱274.00")
        compose.onNodeWithTag("product-sheet").assertWidthIsEqualTo(1280.dp)
        val viewport =
            compose.onNodeWithTag("product-modal-viewport").fetchSemanticsNode().boundsInRoot
        val sheet = compose.onNodeWithTag("product-sheet").fetchSemanticsNode().boundsInRoot
        assertTrue(sheet.height <= viewport.height * .92f + 1)
        compose.runOnIdle {
            groups.value = (0..20).map { size.copy(id = "g$it", name = "Size $it") }
        }
        val before = compose.onNodeWithTag("product-sheet-footer").fetchSemanticsNode().boundsInRoot
        assertEquals(
            viewport.height * .92f,
            compose.onNodeWithTag("product-sheet").fetchSemanticsNode().boundsInRoot.height,
            1f,
        )
        compose.onNodeWithTag("product-options-scroll").performTouchInput { swipeUp() }
        assertEquals(
            before,
            compose.onNodeWithTag("product-sheet-footer").fetchSemanticsNode().boundsInRoot,
        )
        compose.onNodeWithTag("product-confirm").assertIsDisplayed().performClick()
        compose.runOnIdle {
            assertNotNull(choice)
            assertEquals(2, choice!!.quantity)
            assertEquals("No ice", choice!!.notes)
        }
    }

    @Test
    fun simpleOpenPriceInclusiveBoundsLoadingAndNotesDoneConfirmation() {
        val open = menu.products.last().snapshot()
        val sending = mutableStateOf(false)
        var choice: ProductChoice? = null
        compose.setContent {
            ProductOptionsSheet(
                open,
                emptyList(),
                CatalogEntryPoint.Takeout,
                sending.value,
                {},
                { choice = it },
            )
        }
        compose.onNodeWithText("Add to Order").assertIsDisplayed()
        compose.onNodeWithTag("product-price").performTextReplacement("0")
        compose.onNodeWithTag("product-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("product-price").performTextReplacement("20")
        compose.onNodeWithTag("product-price-container").assertWidthIsEqualTo(120.dp)
        compose.onNodeWithTag("product-confirm").assertIsEnabled()
        compose.runOnIdle { sending.value = true }
        compose.onNodeWithTag("product-confirm").assertIsNotEnabled()
        compose.onNodeWithText("Adding...").assertIsDisplayed()
        compose.runOnIdle { sending.value = false }
        compose.onNodeWithTag("product-notes").performTextInput("Wrap separately")
        compose.onNodeWithTag("product-notes").performImeAction()
        compose.runOnIdle {
            assertEquals(20.0, choice!!.customPrice!!, 0.0)
            assertEquals("Wrap separately", choice!!.notes)
        }
        screenshot("open-price-sheet")
        val viewport =
            compose.onNodeWithTag("product-modal-viewport").fetchSemanticsNode().boundsInRoot
        val sheet = compose.onNodeWithTag("product-sheet").fetchSemanticsNode().boundsInRoot
        assertTrue(sheet.height <= viewport.height * .8f + 1)
    }
}
