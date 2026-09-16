package com.pmgt.pos.catalog

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `usesModifierSheet` is deliberately unstable across a counter load: the source shows the modifier
 * sheet optimistically while groups are still resolving. That makes it a mode, never an identity —
 * `ProductOptionsSheet` must not key its Dialog on it, or the window is torn down and rebuilt mid
 * load and the sheet visibly dismisses and reopens under a different title.
 */
class ProductSheetModeTest {
    private val plain = SelectedProduct(id = "p1", name = "Coke", price = 50.0)
    private val withModifiers = plain.copy(hasModifiers = true)
    private val group =
        ModifierGroup(
            id = "g1",
            name = "Size",
            selectionType = "single",
            minSelections = 1.0,
            maxSelections = 1.0,
            options = emptyList(),
        )

    @Test
    fun `a counter product flips out of modifier mode once empty groups resolve`() {
        assertTrue(usesModifierSheet(CatalogEntryPoint.Takeout, plain, null))
        assertFalse(usesModifierSheet(CatalogEntryPoint.Takeout, plain, emptyList()))
    }

    @Test
    fun `a counter product that really has groups stays in modifier mode`() {
        assertTrue(usesModifierSheet(CatalogEntryPoint.Takeout, plain, null))
        assertTrue(usesModifierSheet(CatalogEntryPoint.Takeout, plain, listOf(group)))
    }

    @Test
    fun `dine-in reads the product flag and never flips while groups load`() {
        assertFalse(usesModifierSheet(CatalogEntryPoint.DineIn, plain, null))
        assertFalse(usesModifierSheet(CatalogEntryPoint.DineIn, plain, emptyList()))
        assertTrue(usesModifierSheet(CatalogEntryPoint.DineIn, withModifiers, null))
        assertTrue(usesModifierSheet(CatalogEntryPoint.DineIn, withModifiers, listOf(group)))
    }
}
