package com.pmgt.pos.orders

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.pmgt.pos.catalog.ProductOptionsMemory
import com.pmgt.pos.catalog.SelectedProduct

/** Typed memory state only. Dialog windows remain owned by the visible screen composition. */
class OrderEditorDialogs {
    var error by mutableStateOf<Pair<String, String>?>(null)
    var success by mutableStateOf(false)
    private var product by mutableStateOf<SelectedProduct?>(null)
    var options: ProductOptionsMemory? = null
        private set

    var selected: SelectedProduct?
        get() = product
        set(value) {
            product = value
            options = value?.let(::ProductOptionsMemory)
        }

    var selectedIntent by mutableStateOf("")
    var modal by mutableStateOf<String?>(null)
    var voiding by mutableStateOf<CartDisplayLine?>(null)
    var removing by mutableStateOf<CartDisplayLine?>(null)
    var cancelling by mutableStateOf(false)
    var input by mutableStateOf("")
}
