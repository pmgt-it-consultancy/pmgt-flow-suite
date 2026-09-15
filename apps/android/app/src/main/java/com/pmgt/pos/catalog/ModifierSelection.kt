package com.pmgt.pos.catalog

import java.math.BigDecimal
import kotlin.math.abs

/** A modal session, not an order. Writes belong to the editor receiving ProductChoice. */
data class ModifierSelection(
    val quantity: Int = 1,
    val notes: String = "",
    val customPriceText: String = "",
    val selections: Map<String, Set<String>> = emptyMap(),
) {
    fun refreshed(groups: List<ModifierGroup>): ModifierSelection {
        val next = selections.toMutableMap()
        groups.forEach { group ->
            if (group.id !in next)
                next[group.id] = group.options.filter { it.isDefault }.map { it.id }.toSet()
        }
        return copy(selections = next)
    }

    fun toggle(group: ModifierGroup, optionId: String): ModifierSelection {
        val current = selections[group.id].orEmpty()
        val next =
            when {
                group.selectionType == "single" -> setOf(optionId)
                optionId in current -> current - optionId
                group.maxSelections != null &&
                    group.maxSelections != 0.0 &&
                    current.size >= group.maxSelections -> return this
                else -> current + optionId
            }
        return copy(selections = selections + (group.id to next))
    }

    fun priceValid(product: SelectedProduct): Boolean =
        !product.isOpenPrice ||
            (customPriceText.trim().isNotEmpty() &&
                customPrice > 0 &&
                customPrice >= (product.minPrice ?: 0.0) &&
                customPrice <= (product.maxPrice ?: Double.POSITIVE_INFINITY))

    fun valid(product: SelectedProduct, groups: List<ModifierGroup>): Boolean =
        priceValid(product) && groups.all { selections[it.id].orEmpty().size >= it.minSelections }

    fun choice(product: SelectedProduct, groups: List<ModifierGroup>) =
        ProductChoice(
            product,
            quantity,
            notes,
            groups.flatMap { group ->
                group.options
                    .filter { it.id in selections[group.id].orEmpty() }
                    .map { ModifierSnapshot(group.name, it.name, it.priceAdjustment) }
            },
            if (product.isOpenPrice) customPrice else null,
        )

    fun total(product: SelectedProduct, groups: List<ModifierGroup>): Double {
        var adjustment = 0.0
        groups.forEach { group ->
            group.options.forEach {
                if (it.id in selections[group.id].orEmpty()) adjustment += it.priceAdjustment
            }
        }
        return ((if (product.isOpenPrice) customPrice else product.price) + adjustment) * quantity
    }

    // JS parseFloat accepts a leading numeric prefix, including an incomplete exponent suffix.
    val customPrice: Double
        get() = NUMBER_PREFIX.find(customPriceText.trimStart())?.value?.toDoubleOrNull() ?: 0.0

    companion object {
        private val NUMBER_PREFIX =
            Regex("^[+-]?(?:Infinity|(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")

        fun opened(product: SelectedProduct) =
            ModifierSelection(
                customPriceText =
                    if (product.isOpenPrice) product.minPrice?.let(::priceText).orEmpty() else ""
            )

        // Presentation only, equivalent to String(minPrice) for normal menu price magnitudes.
        // Never used by ledger arithmetic, bounds comparisons or totals.
        private fun priceText(value: Double): String =
            when {
                value == 0.0 -> "0"
                value.isFinite() && abs(value) >= 1e-6 && abs(value) < 1e21 ->
                    BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
                else ->
                    value
                        .toString()
                        .replace(".0E", "e")
                        .replace("E", "e")
                        .replace(Regex("e([0-9])"), "e+$1")
            }
    }
}
