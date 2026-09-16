package com.pmgt.pos.catalog

import com.pmgt.pos.db.*
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.yield

/** Store-bounded menu, then only the selected product's ancestry and modifier graph. */
@OptIn(ExperimentalCoroutinesApi::class)
class LocalCatalogRepository(private val db: PosDatabase, private val io: CoroutineDispatcher) :
    CatalogRepository {
    private fun <T> observe(read: () -> T): Flow<T> =
        db.changes.mapLatest { db.transaction(read) }.distinctUntilChanged().flowOn(io)

    override fun catalog(storeId: String) = observe {
        val products =
            db.select("products", "$LIVE AND store_id = ?", listOf(storeId), "sort_order ASC")
        val categories =
            db.select("categories", "$LIVE AND store_id = ?", listOf(storeId), "sort_order ASC")
        val assignments =
            db.select("modifier_group_assignments", "$LIVE AND store_id = ?", listOf(storeId))
        val categoryById = categories.associateBy { it.id() }
        val direct = assignments.mapNotNull { it.string("product_id") }.toSet()
        val inherited = assignments.mapNotNull { it.string("category_id") }.toSet()
        val chains = mutableMapOf<String, Set<String>>()
        fun chain(id: String) =
            chains.getOrPut(id) {
                val seen = linkedSetOf<String>()
                var cursor: String? = id
                while (!cursor.isNullOrEmpty() && seen.add(cursor)) cursor =
                    categoryById[cursor]?.string("parent_id")
                seen
            }
        val counts = products.groupingBy { it.string("category_id") }.eachCount()
        Catalog(
            products
                .filter { it.boolean("is_active") }
                .map {
                    CatalogProduct(
                        it.id(),
                        it.text("name"),
                        it.text("category_id"),
                        it.number("price"),
                        it.boolean("is_vatable"),
                        it.id() in direct || chain(it.text("category_id")).any(inherited::contains),
                        it.boolean("is_open_price"),
                        it.optional("min_price"),
                        it.optional("max_price"),
                    )
                },
            categories
                .filter { it.boolean("is_active") }
                .map {
                    CatalogCategory(
                        it.id(),
                        it.text("name"),
                        it.string("parent_id"),
                        counts[it.id()] ?: 0,
                    )
                },
        )
    }

    override fun modifiers(storeId: String, productId: String): Flow<List<ModifierGroup>?> = flow {
        var initialized = false
        resolvedModifiers(storeId, productId).collect { groups ->
            // Equality filtering happens before this boundary: synchronization-only invalidations
            // never flash loading. Relevant graph changes retain RN's rebuilding transition.
            if (initialized && groups != null) {
                emit(null)
                yield()
            }
            emit(groups)
            initialized = true
        }
    }

    private fun resolvedModifiers(storeId: String, productId: String) = observe {
        val product =
            db.select(
                    "products",
                    "$LIVE AND id = ? AND store_id = ?",
                    listOf(productId, storeId),
                    limit = 1,
                )
                .firstOrNull() ?: return@observe null
        val ancestry = linkedSetOf<String>()
        var cursor = product.string("category_id")
        while (!cursor.isNullOrEmpty() && ancestry.add(cursor)) {
            cursor =
                db.select("categories", "$LIVE AND id = ?", listOf(cursor), limit = 1)
                    .firstOrNull()
                    ?.string("parent_id")
        }
        val resolved =
            db.select("modifier_group_assignments", "$LIVE AND product_id = ?", listOf(productId))
                .toMutableList()
        val seen = resolved.map { it.text("modifier_group_id") }.toMutableSet()
        ancestry.forEach { categoryId ->
            db.select("modifier_group_assignments", "$LIVE AND category_id = ?", listOf(categoryId))
                .forEach { if (seen.add(it.text("modifier_group_id"))) resolved += it }
        }
        val groups =
            byIds(
                    "modifier_groups",
                    "id",
                    resolved.map { it.text("modifier_group_id") },
                    " AND is_active = 1",
                )
                .associateBy { it.id() }
        val options =
            byIds(
                    "modifier_options",
                    "modifier_group_id",
                    groups.keys.toList(),
                    " AND is_available = 1",
                )
                .sortedBy { it.number("sort_order") }
                .groupBy { it.text("modifier_group_id") }
        resolved
            .sortedBy { it.number("sort_order") }
            .mapNotNull { assignment ->
                val group = groups[assignment.text("modifier_group_id")] ?: return@mapNotNull null
                ModifierGroup(
                    group.id(),
                    group.text("name"),
                    group.text("selection_type"),
                    assignment.optional("min_selections_override")
                        ?: group.number("min_selections"),
                    assignment.optional("max_selections_override")
                        ?: group.optional("max_selections"),
                    options[group.id()].orEmpty().map {
                        ModifierOption(
                            it.id(),
                            it.text("name"),
                            it.number("price_adjustment"),
                            it.boolean("is_default"),
                        )
                    },
                )
            }
    }

    private fun byIds(table: String, key: String, ids: List<String>, extra: String) =
        ids.distinct().chunked(400).flatMap {
            db.select(table, "$LIVE AND $key IN (${it.joinToString { "?" }})$extra", it)
        }

    private fun Row.id() = text("id")

    private fun Row.text(key: String) = string(key).orEmpty()

    private fun Row.optional(key: String) = if (string(key) == null) null else number(key)

    companion object {
        private const val LIVE = "_status != 'deleted'"
    }
}
