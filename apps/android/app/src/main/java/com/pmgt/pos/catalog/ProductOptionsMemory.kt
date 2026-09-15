package com.pmgt.pos.catalog

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf

/** Optional editor-owned, memory-only presentation state. No window or query survives the lock. */
class ProductOptionsMemory(private val product: SelectedProduct) {
    val simpleQuantity = mutableStateOf(1)
    val simpleNotes = mutableStateOf("")
    var lastGroups: List<ModifierGroup>? = null
    private var mode: Boolean? = null
    private val selection = mutableStateOf(ModifierSelection.opened(product))

    fun selection(custom: Boolean): MutableState<ModifierSelection> {
        if (mode != custom) {
            mode = custom
            selection.value =
                ModifierSelection.opened(product)
                    .copy(
                        quantity = if (custom) 1 else simpleQuantity.value,
                        notes = if (custom) "" else simpleNotes.value,
                    )
        }
        return selection
    }
}
