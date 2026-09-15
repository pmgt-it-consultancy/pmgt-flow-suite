package com.pmgt.pos.catalog

import java.util.Locale
import kotlinx.coroutines.flow.Flow

/** Render projections deliberately omit server IDs, timestamps and synchronization markers. */
data class CatalogProduct(
    val id: String,
    val name: String,
    val categoryId: String,
    val price: Double,
    val isVatable: Boolean,
    val hasModifiers: Boolean,
    val isOpenPrice: Boolean = false,
    val minPrice: Double? = null,
    val maxPrice: Double? = null,
) {
    fun snapshot() = SelectedProduct(id, name, price, hasModifiers, isOpenPrice, minPrice, maxPrice)
}

data class SelectedProduct(
    val id: String,
    val name: String,
    val price: Double,
    val hasModifiers: Boolean = false,
    val isOpenPrice: Boolean = false,
    val minPrice: Double? = null,
    val maxPrice: Double? = null,
)

data class CatalogCategory(
    val id: String,
    val name: String,
    val parentId: String?,
    val productCount: Int,
)

data class Catalog(val products: List<CatalogProduct>, val categories: List<CatalogCategory>)

data class ModifierOption(
    val id: String,
    val name: String,
    val priceAdjustment: Double,
    val isDefault: Boolean,
)

data class ModifierGroup(
    val id: String,
    val name: String,
    val selectionType: String,
    val minSelections: Double,
    val maxSelections: Double?,
    val options: List<ModifierOption>,
)

data class ModifierSnapshot(
    val modifierGroupName: String,
    val modifierOptionName: String,
    val priceAdjustment: Double,
)

data class ProductChoice(
    val product: SelectedProduct,
    val quantity: Int,
    val notes: String,
    val modifiers: List<ModifierSnapshot>,
    val customPrice: Double?,
)

interface CatalogRepository {
    fun catalog(storeId: String): Flow<Catalog>

    /** Null means the selected product has not been found; empty means resolved without groups. */
    fun modifiers(storeId: String, productId: String): Flow<List<ModifierGroup>?>
}

enum class CatalogEntryPoint {
    DineIn,
    Takeout,
}

fun usesModifierSheet(
    entryPoint: CatalogEntryPoint,
    product: SelectedProduct,
    groups: List<ModifierGroup>?,
) =
    if (entryPoint == CatalogEntryPoint.DineIn) product.hasModifiers
    else groups == null || groups.isNotEmpty()

data class CatalogNavigation(
    val categoryId: String? = null,
    val categoryName: String? = null,
    val subcategoryId: String? = null,
) {
    fun back() = if (subcategoryId != null) copy(subcategoryId = null) else CatalogNavigation()
}

sealed interface CatalogTile {
    val id: String

    data class Category(val category: CatalogCategory, val count: Int) : CatalogTile {
        override val id = category.id
    }

    data class Product(val product: CatalogProduct) : CatalogTile {
        override val id = product.id
    }
}

fun Catalog.tiles(nav: CatalogNavigation, search: String): List<CatalogTile> {
    if (search.isNotEmpty()) {
        val needle = search.lowercase(Locale.ROOT)
        return products
            .filter { it.name.lowercase(Locale.ROOT).contains(needle) }
            .map(CatalogTile::Product)
    }
    if (nav.categoryId == null)
        return categories
            .filter { it.parentId == null }
            .map { root ->
                CatalogTile.Category(
                    root,
                    root.productCount + categories.count { it.parentId == root.id },
                )
            }
    if (nav.subcategoryId != null)
        return products.filter { it.categoryId == nav.subcategoryId }.map(CatalogTile::Product)
    if (categories.none { it.id == nav.categoryId && it.parentId == null }) return emptyList()
    return categories
        .filter { it.parentId == nav.categoryId }
        .map { CatalogTile.Category(it, it.productCount) } +
        products.filter { it.categoryId == nav.categoryId }.map(CatalogTile::Product)
}
