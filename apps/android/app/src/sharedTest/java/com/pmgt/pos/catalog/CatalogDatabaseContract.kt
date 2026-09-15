package com.pmgt.pos.catalog

import app.cash.sqldelight.db.SqlDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.browse.BrowseRecordingDriver
import com.pmgt.pos.db.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.junit.Assert.*

object CatalogDatabaseContract {
    fun seed(db: PosDatabase) {
        fun put(table: String, rows: List<Row>) =
            db.applyRemote(table, rows, emptyList(), emptyList())
        put(
            "categories",
            listOf(
                row("root", "store_id" to "s", "name" to "Food", "is_active" to true),
                row(
                    "child",
                    "store_id" to "s",
                    "name" to "Rice",
                    "parent_id" to "root",
                    "is_active" to true,
                ),
                row("hidden", "store_id" to "s", "name" to "Hidden", "is_active" to false),
            ) +
                (0 until 1000).map {
                    row("foreignCat$it", "store_id" to "other", "is_active" to true)
                },
        )
        put(
            "products",
            listOf(
                row(
                    "p",
                    "store_id" to "s",
                    "name" to "Kiosk İnez Meal",
                    "category_id" to "child",
                    "price" to 112,
                    "is_active" to true,
                    "is_vatable" to true,
                ),
                row(
                    "inactive",
                    "store_id" to "s",
                    "name" to "Inactive",
                    "category_id" to "root",
                    "is_active" to false,
                ),
                row(
                    "orphan",
                    "store_id" to "s",
                    "name" to "Hidden category product",
                    "category_id" to "hidden",
                    "is_active" to true,
                    "sort_order" to 1,
                ),
            ) +
                (0 until 1000).map {
                    row(
                        "foreignProduct$it",
                        "store_id" to "other",
                        "category_id" to "foreignCat$it",
                        "is_active" to true,
                    )
                },
        )
        put(
            "modifier_groups",
            listOf(
                row(
                    "g",
                    "store_id" to "s",
                    "name" to "Size",
                    "selection_type" to "single",
                    "min_selections" to 1,
                    "max_selections" to 1,
                    "is_active" to true,
                ),
                row(
                    "extra",
                    "store_id" to "s",
                    "name" to "Extra",
                    "selection_type" to "multi",
                    "min_selections" to 1,
                    "max_selections" to 2,
                    "is_active" to true,
                ),
                row(
                    "inactiveGroup",
                    "store_id" to "s",
                    "name" to "Inactive group",
                    "is_active" to false,
                ),
            ) +
                (0 until 1000).map {
                    row("foreignGroup$it", "store_id" to "other", "is_active" to true)
                },
        )
        put(
            "modifier_group_assignments",
            listOf(
                row(
                    "rootAssignment",
                    "store_id" to "s",
                    "category_id" to "root",
                    "modifier_group_id" to "g",
                    "min_selections_override" to 2,
                ),
                row(
                    "childAssignment",
                    "store_id" to "s",
                    "category_id" to "child",
                    "modifier_group_id" to "g",
                    "min_selections_override" to 1,
                ),
                row(
                    "direct",
                    "store_id" to "s",
                    "product_id" to "p",
                    "modifier_group_id" to "g",
                    "min_selections_override" to 0,
                    "max_selections_override" to 0,
                    "sort_order" to 1,
                ),
                row(
                    "extraAssignment",
                    "store_id" to "s",
                    "category_id" to "root",
                    "modifier_group_id" to "extra",
                    "sort_order" to 0,
                ),
                row(
                    "inactiveAssignment",
                    "store_id" to "s",
                    "product_id" to "orphan",
                    "modifier_group_id" to "inactiveGroup",
                ),
            ) +
                (0 until 1000).map {
                    row(
                        "foreignAssignment$it",
                        "store_id" to "other",
                        "product_id" to "foreignProduct$it",
                        "modifier_group_id" to "foreignGroup$it",
                    )
                },
        )
        put(
            "modifier_options",
            listOf(
                row(
                    "regular",
                    "modifier_group_id" to "g",
                    "name" to "Regular",
                    "is_available" to true,
                    "is_default" to true,
                ),
                row(
                    "large",
                    "modifier_group_id" to "g",
                    "name" to "Large",
                    "is_available" to true,
                    "price_adjustment" to 20,
                    "sort_order" to 1,
                ),
                row(
                    "unavailable",
                    "modifier_group_id" to "g",
                    "name" to "Unavailable",
                    "is_available" to false,
                    "is_default" to true,
                ),
            ) +
                (0 until 1000).map {
                    row(
                        "foreignOption$it",
                        "store_id" to "other",
                        "modifier_group_id" to "foreignGroup$it",
                        "is_available" to true,
                    )
                },
        )
    }

    suspend fun verify(driver: SqlDriver) {
        val recording = BrowseRecordingDriver(driver)
        val db = PosDatabase(recording)
        seed(db)
        val repo = LocalCatalogRepository(db, Dispatchers.IO)
        recording.reads.clear()
        val menu = repo.catalog("s").first()
        assertEquals(listOf("p", "orphan"), menu.products.map { it.id })
        assertEquals(
            2,
            (menu.tiles(CatalogNavigation(), "").single() as CatalogTile.Category).count,
        )
        assertEquals(
            listOf("child"),
            menu.tiles(CatalogNavigation("root", "Food"), "").map { it.id },
        )
        assertEquals(
            listOf("p"),
            menu.tiles(CatalogNavigation("root", "Food", "child"), "").map { it.id },
        )
        assertEquals(listOf("p"), menu.tiles(CatalogNavigation(), "kiosk i").map { it.id })
        assertTrue(menu.tiles(CatalogNavigation(), " Meal ").isEmpty())
        assertTrue(menu.products.all { it.hasModifiers })
        assertTrue(
            recording.reads.all { it.rows <= 5 && it.plan.none { p -> p.startsWith("SCAN ") } }
        )
        println(
            "Catalog store bounds: ${recording.reads.map { it.rows }}; ${recording.reads.flatMap { it.plan }}"
        )
        recording.reads.clear()
        val groups = repo.modifiers("s", "p").first()!!
        assertEquals(listOf("extra", "g"), groups.map { it.id })
        assertTrue(groups.first().options.isEmpty())
        assertEquals(0.0, groups.last().minSelections, 0.0)
        assertEquals(0.0, groups.last().maxSelections!!, 0.0)
        assertEquals(listOf("regular", "large"), groups.last().options.map { it.id })
        assertTrue(
            recording.reads.all { it.rows <= 2 && it.plan.none { p -> p.startsWith("SCAN ") } }
        )
        println(
            "Selected modifier bounds: ${recording.reads.map { it.rows }}; ${recording.reads.flatMap { it.plan }}"
        )
        assertTrue(repo.modifiers("s", "orphan").first()!!.isEmpty())
        assertNull(repo.modifiers("other", "p").first())
        // Nearest category wins after direct assignment is removed; root inheritance follows.
        db.deleteLocal("modifier_group_assignments", "direct")
        assertEquals(
            1.0,
            repo.modifiers("s", "p").first()!!.first { it.id == "g" }.minSelections,
            0.0,
        )
        db.deleteLocal("modifier_group_assignments", "childAssignment")
        assertEquals(
            2.0,
            repo.modifiers("s", "p").first()!!.first { it.id == "g" }.minSelections,
            0.0,
        )
        // Cyclic ancestry terminates without reading unrelated categories.
        db.updateLocal(
            "categories",
            "root",
            kotlinx.serialization.json.JsonObject(row("root", "parent_id" to "child") - "id"),
        )
        assertEquals(2, repo.modifiers("s", "p").first()!!.size)
        // Backend validators allow number, not integer; a fractional minimum needs two choices.
        db.updateLocal(
            "modifier_group_assignments",
            "rootAssignment",
            kotlinx.serialization.json.JsonObject(
                row("rootAssignment", "min_selections_override" to 1.5) - "id"
            ),
        )
        val fractional = repo.modifiers("s", "p").first()!!.first { it.id == "g" }
        assertFalse(
            ModifierSelection.opened(menu.products.first().snapshot())
                .refreshed(listOf(fractional))
                .valid(menu.products.first().snapshot(), listOf(fractional))
        )
        db.close()
    }
}
