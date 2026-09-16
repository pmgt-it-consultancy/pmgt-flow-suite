package com.pmgt.pos.orders

import com.pmgt.pos.browse.OrderLine
import com.pmgt.pos.catalog.ModifierSnapshot
import com.pmgt.pos.catalog.ProductChoice
import com.pmgt.pos.money.OrderTotals
import kotlinx.coroutines.flow.Flow

data class ItemInput(
    val productId: String,
    val quantity: Double,
    val notes: String? = null,
    val modifiers: List<ModifierSnapshot> = emptyList(),
    val customPrice: Double? = null,
)

fun ProductChoice.input() =
    ItemInput(product.id, quantity.toDouble(), notes, modifiers, customPrice)

data class NewOrder(
    val storeId: String,
    val orderType: String = "dine_in",
    val tableId: String? = null,
    val customerName: String? = null,
    val pax: Double = 1.0,
    val requestId: String? = null,
)

data class CreatedOrder(
    val orderId: String,
    val orderNumber: String,
    val sentItemIds: List<String>,
)

data class CancelCommit(val orderId: String, val voidId: String, val tableId: String?)

data class TransferTable(val id: String, val name: String, val capacity: Double)

@kotlinx.serialization.Serializable
data class CartDiscount(
    val id: String,
    val itemId: String?,
    val type: String,
    val quantity: Double,
    val amount: Double,
    val vatExemptAmount: Double,
)

@kotlinx.serialization.Serializable
data class OrderCart(
    val id: String,
    val storeId: String,
    val orderType: String,
    val status: String,
    val orderNumber: String,
    val tableId: String?,
    val tableName: String?,
    val customerName: String?,
    val orderCategory: String?,
    val tableMarker: String?,
    val pax: Double?,
    val tabNumber: Double?,
    val tabName: String?,
    val lines: List<OrderLine>,
    val discounts: List<CartDiscount>,
    val totals: OrderTotals,
    val vatRate: Double,
    val takeoutStatus: String = "pending",
)

/** Durable identity is delivered synchronously at the known local commit boundary. */
interface OrderEntryRepository {
    fun cart(storeId: String, orderId: String): Flow<OrderCart?>

    fun availableTables(storeId: String): Flow<List<TransferTable>>

    suspend fun createOrder(input: NewOrder): String

    suspend fun createDraft(storeId: String, label: String? = null): String

    suspend fun createAndSend(
        input: NewOrder,
        items: List<ItemInput>,
        committed: (CreatedOrder) -> Unit,
    ): CreatedOrder

    suspend fun addItem(orderId: String, item: ItemInput, committed: (String) -> Unit = {})

    suspend fun quantity(itemId: String, quantity: Double)

    suspend fun remove(itemId: String, reason: String? = null)

    suspend fun serviceType(itemId: String, type: String)

    suspend fun pax(orderId: String, pax: Double)

    suspend fun tabName(orderId: String, name: String)

    suspend fun customer(
        orderId: String,
        name: String? = null,
        category: String? = null,
        marker: String? = null,
    )

    suspend fun send(orderId: String)

    suspend fun transfer(orderId: String, tableId: String)

    suspend fun discardDraft(orderId: String)

    suspend fun submitDraft(orderId: String)

    suspend fun advanceTakeout(orderId: String, status: String)

    suspend fun recalculate(orderId: String)

    suspend fun cancel(orderId: String, committed: (CancelCommit) -> Unit = {})

    suspend fun finishCancellation(commit: CancelCommit)

    /** Consumes a device/day/type reservation; deliberately separate from later order writes. */
    suspend fun reserveOrderNumber(orderType: String): String
}

/** Later payment/printing owners receive real persisted identities and captured print lines. */
@kotlinx.serialization.Serializable
data class CheckoutRoute(
    val orderId: String,
    val orderType: String,
    val tableId: String? = null,
    val tableName: String? = null,
    val orderCategory: String? = null,
    val tableMarker: String? = null,
)

data class KitchenRequest(
    val orderId: String,
    val orderNumber: String,
    val tableName: String?,
    val pax: Double?,
    val lines: List<OrderLine>,
    val orderCategory: String?,
    val tableMarker: String?,
    val customerName: String?,
    /** Selects the source's dine-in versus takeout ticket header and item service defaults. */
    val takeout: Boolean,
)
