package com.pmgt.pos.catalog

import org.junit.Assert.*
import org.junit.Test

class ModifierSelectionTest {
    private val regular = ModifierOption("r", "Regular", 0.0, true)
    private val large = ModifierOption("l", "Large", 20.0, false)
    private val size = ModifierGroup("size", "Size", "single", 1.0, 1.0, listOf(regular, large))
    private val product = SelectedProduct("p", "Meal", 112.0, true)

    @Test
    fun defaultsInitializeOnceAndRefreshRetainsNotesChoicesAndRemovedIds() {
        var state = ModifierSelection.opened(product).refreshed(listOf(size))
        assertEquals(setOf("r"), state.selections["size"])
        state = state.toggle(size, "l").copy(notes = "No ice", quantity = 3)
        val changed = size.copy(options = listOf(regular))
        state = state.refreshed(listOf(changed))
        assertEquals(setOf("l"), state.selections["size"])
        assertEquals("No ice", state.notes)
        assertTrue(state.valid(product, listOf(changed)))
        assertEquals(336.0, state.total(product, listOf(changed)), 0.0)
        assertTrue(state.choice(product, listOf(changed)).modifiers.isEmpty())
        val extra = size.copy(id = "extra", name = "Extra")
        state = state.refreshed(listOf(extra))
        assertEquals(setOf("r"), state.selections["extra"])
        assertEquals(setOf("l"), state.refreshed(listOf(size)).selections["size"])
    }

    @Test
    fun singleDoesNotToggleOffAndMultiZeroMaxIsUnlimitedAndDefaultsAreNotPruned() {
        val single = ModifierSelection.opened(product).refreshed(listOf(size)).toggle(size, "r")
        assertEquals(setOf("r"), single.selections["size"])
        val multi = size.copy(selectionType = "multi", maxSelections = 0.0)
        val state = single.toggle(multi, "l")
        assertEquals(setOf("r", "l"), state.selections["size"])
        assertEquals(setOf("l"), state.toggle(multi, "r").selections["size"])
        assertEquals(single, single.toggle(multi.copy(maxSelections = 1.0), "l"))
        val defaults = size.copy(options = listOf(regular, large.copy(isDefault = true)))
        val over = ModifierSelection.opened(product).refreshed(listOf(defaults))
        assertEquals(2, over.selections["size"]!!.size)
        assertTrue(over.valid(product, listOf(defaults)))
        assertEquals(
            listOf("Regular", "Large"),
            over.choice(product, listOf(defaults)).modifiers.map { it.modifierOptionName },
        )
    }

    @Test
    fun openPriceUsesJsParseFloatInclusiveBoundsAndPositiveRequirement() {
        val open = product.copy(isOpenPrice = true, minPrice = 10.0, maxPrice = 20.0)
        val state = ModifierSelection.opened(open)
        assertEquals("10", state.customPriceText)
        assertTrue(state.valid(open, emptyList()))
        for (text in listOf("10", "20", " 12.5xyz", "1e1", "10e")) assertTrue(
            text,
            state.copy(customPriceText = text).valid(open, emptyList()),
        )
        for (text in listOf("", " ", "0", "9.99", "20.01", "xyz", "Infinity")) assertFalse(
            text,
            state.copy(customPriceText = text).valid(open, emptyList()),
        )
        assertEquals(
            12.5,
            state.copy(customPriceText = "12.5xyz").choice(open, emptyList()).customPrice!!,
            0.0,
        )
        assertFalse(state.copy(customPriceText = "0").valid(open.copy(minPrice = 0.0), emptyList()))
    }

    @Test
    fun entryPointsRetainDifferentInactiveGroupRouting() {
        assertTrue(usesModifierSheet(CatalogEntryPoint.DineIn, product, emptyList()))
        assertFalse(usesModifierSheet(CatalogEntryPoint.Takeout, product, emptyList()))
        assertTrue(
            usesModifierSheet(CatalogEntryPoint.Takeout, product.copy(hasModifiers = false), null)
        )
        assertFalse(
            usesModifierSheet(CatalogEntryPoint.DineIn, product.copy(hasModifiers = false), null)
        )
    }
}
