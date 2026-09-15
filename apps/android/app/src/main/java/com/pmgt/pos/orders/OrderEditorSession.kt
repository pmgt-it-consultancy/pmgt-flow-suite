package com.pmgt.pos.orders

import com.pmgt.pos.browse.ItemModifier
import com.pmgt.pos.browse.OrderLine
import com.pmgt.pos.catalog.ProductChoice
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex

data class EditorRoute(
    val storeId: String,
    val tableId: String? = null,
    val tableName: String = "",
    val orderId: String? = null,
    val takeout: Boolean = false,
)

data class DraftLine(val id: String, val choice: ProductChoice, val quantity: Double)

data class CartDisplayLine(val item: OrderLine, val total: Double = item.lineTotal)

data class EditorState(
    val orderId: String?,
    val tableName: String,
    val cart: OrderCart? = null,
    val drafts: List<DraftLine> = emptyList(),
    val category: String = "takeout",
    val marker: String = "",
    val customer: String = "",
    val busy: Set<String> = emptySet(),
    val needsRecalculation: Boolean = false,
    val quantityErrors: Int = 0,
) {
    val draftMode
        get() = orderId == null

    val lines: List<CartDisplayLine>
        get() =
            if (!draftMode) cart?.lines.orEmpty().map(::CartDisplayLine)
            else
                drafts.map { draft ->
                    val choice = draft.choice
                    val price =
                        (choice.customPrice ?: choice.product.price) +
                            choice.modifiers.fold(0.0) { sum, mod -> sum + mod.priceAdjustment }
                    CartDisplayLine(
                        OrderLine(
                            draft.id,
                            choice.product.id,
                            choice.product.name,
                            price,
                            draft.quantity,
                            choice.notes,
                            false,
                            false,
                            "dine_in",
                            true,
                            choice.modifiers.map {
                                ItemModifier(
                                    it.modifierGroupName,
                                    it.modifierOptionName,
                                    it.priceAdjustment,
                                )
                            },
                        ),
                        price * draft.quantity,
                    )
                }

    val count
        get() = lines.fold(0.0) { sum, line -> sum + line.item.quantity }

    val subtotal
        get() = lines.fold(0.0) { sum, line -> sum + line.total }
}

/** Screen-owned memory; only persisted identities may cross process restart. */
class OrderEditorSession(
    val route: EditorRoute,
    private val repository: OrderEntryRepository,
    scope: CoroutineScope,
    onQuantityError: () -> Unit,
) {
    private val mutable = MutableStateFlow(EditorState(route.orderId, route.tableName))
    val state = mutable.asStateFlow()
    val dialogs = OrderEditorDialogs()
    val edits =
        CartQuantityEdits(scope) {
            mutable.update { it.copy(quantityErrors = it.quantityErrors + 1) }
            onQuantityError()
        }
    private val locks = mutableMapOf<String, Mutex>()
    private var nextDraft = 0
    private var lastCustomer: String? = null
    private var pendingKitchen: KitchenRequest? = null

    private data class PendingAdd(
        val orderId: String,
        val itemId: String,
        val intent: String,
        val choice: ProductChoice,
    )

    private var pendingAdd: PendingAdd? = null
    private var tabRequest: String? = null
    private var initialized = false
    private var pendingCancellation: CancelCommit? = null
    private var cancellationStarted = false

    fun loaded(cart: OrderCart?) {
        mutable.update { current ->
            val customer =
                if (cart?.customerName != lastCustomer && !cart?.customerName.isNullOrEmpty())
                    cart!!.customerName!!
                else current.customer
            current.copy(cart = cart, customer = customer)
        }
        lastCustomer = cart?.customerName
        cart?.lines?.forEach { edits.acknowledge(it.id) }
    }

    suspend fun initialize() {
        if (initialized) return
        initialized = true
        if (route.takeout) repository.customer(requireNotNull(route.orderId), category = "takeout")
    }

    suspend fun add(choice: ProductChoice, intent: String = "current") =
        operation("add") {
            pendingAdd?.let { pending ->
                if (pending.intent == intent) {
                    check(pending.choice == choice) {
                        "This item was already saved. Restore its original selections and retry, or close this sheet to finish saving it."
                    }
                    finishPendingAdd()
                    return@operation Unit
                }
                finishPendingAdd()
            }
            val id = state.value.orderId
            if (id == null)
                mutable.update {
                    it.copy(
                        drafts =
                            it.drafts +
                                DraftLine(
                                    "draft-${++nextDraft}",
                                    choice,
                                    choice.quantity.toDouble(),
                                )
                    )
                }
            else
                repository.addItem(id, choice.input()) { itemId ->
                    pendingAdd = PendingAdd(id, itemId, intent, choice)
                }
            pendingAdd = null
            Unit
        }

    fun setQuantity(id: String, quantity: Double) {
        edits.enqueue(id, quantity) { saved ->
            if (state.value.draftMode)
                mutable.update { current ->
                    current.copy(
                        drafts =
                            current.drafts.map {
                                if (it.id == id) it.copy(quantity = saved) else it
                            }
                    )
                }
            else repository.quantity(id, saved)
        }
    }

    fun changeQuantity(id: String, delta: Double): Boolean {
        val item = state.value.lines.firstOrNull { it.item.id == id }?.item ?: return false
        val next = edits.currentQuantity(id, item.quantity) + delta
        if (next < 1) return false
        setQuantity(id, next)
        return true
    }

    suspend fun remove(id: String, reason: String? = null) =
        operation("remove") {
            if (state.value.draftMode)
                mutable.update { it.copy(drafts = it.drafts.filterNot { line -> line.id == id }) }
            else {
                edits.flush()
                repository.remove(id, reason)
            }
            edits.discard(id)
        }

    suspend fun changeService(id: String, type: String) =
        operation("service:$id") {
            // RN draft handler attempts an unavailable persisted ID; its caught failure leaves DINE
            // IN.
            if (!state.value.draftMode) repository.serviceType(id, type)
        }

    fun customerText(value: String) {
        mutable.update { it.copy(customer = value) }
    }

    fun markerText(value: String) {
        mutable.update { it.copy(marker = value) }
    }

    suspend fun saveCustomer() {
        state.value.orderId?.let {
            repository.customer(it, name = state.value.customer.trim().takeIf(String::isNotEmpty))
        }
    }

    suspend fun saveMarker() {
        state.value.orderId?.let {
            repository.customer(it, marker = state.value.marker.takeIf(String::isNotEmpty))
        }
    }

    suspend fun category(value: String) {
        mutable.update { it.copy(category = value) }
        state.value.orderId?.let { repository.customer(it, category = value) }
    }

    suspend fun updatePax(value: Double) =
        operation("pax") { repository.pax(requireNotNull(state.value.orderId), value) }

    suspend fun updateTab(value: String) =
        operation("tab") { repository.tabName(requireNotNull(state.value.orderId), value) }

    suspend fun transfer(tableId: String, name: String) =
        operation("transfer") {
            repository.transfer(requireNotNull(state.value.orderId), tableId)
            mutable.update { it.copy(tableName = name) }
            // Source retains route.tableId after transfer; checkout/New Tab still use that route
            // value.
        }

    suspend fun newTab(): String? =
        operation("newTab") {
            val request = tabRequest ?: uid().also { tabRequest = it }
            repository
                .createOrder(NewOrder(route.storeId, tableId = route.tableId, requestId = request))
                .also { tabRequest = null }
        }

    suspend fun finishPendingAdd() {
        pendingAdd?.let {
            repository.recalculate(it.orderId)
            pendingAdd = null
        }
    }

    suspend fun leave() {
        if (state.value.needsRecalculation) {
            repository.recalculate(requireNotNull(state.value.orderId))
            mutable.update { it.copy(needsRecalculation = false) }
        }
        pendingCancellation?.let {
            repository.finishCancellation(it)
            pendingCancellation = null
            cancellationStarted = false
            edits.discard()
        }
        edits.flush()
        finishPendingAdd()
    }

    suspend fun discard() =
        operation("cancel") {
            if (route.takeout && state.value.cart?.status == "draft")
                repository.discardDraft(requireNotNull(state.value.orderId))
            else if (!state.value.draftMode) {
                val pending = pendingCancellation
                if (pending != null) repository.finishCancellation(pending)
                else {
                    check(cancellationStarted || state.value.cart?.status != "voided") {
                        "This order is already cancelled. Return to the order list."
                    }
                    cancellationStarted = true
                    repository.cancel(requireNotNull(state.value.orderId)) {
                        pendingCancellation = it
                    }
                }
                pendingCancellation = null
                cancellationStarted = false
            }
            edits.discard()
        }

    suspend fun send(pax: Double?): KitchenRequest? =
        operation("send") {
            val saved = edits.flush()
            val current = state.value
            if (current.needsRecalculation) {
                repository.recalculate(requireNotNull(current.orderId))
                mutable.update { it.copy(needsRecalculation = false) }
                return@operation pendingKitchen
            }
            val captured =
                current.lines
                    .filter { !it.item.isSentToKitchen }
                    .map { it.item.copy(quantity = saved[it.item.id] ?: it.item.quantity) }
            if (current.draftMode) {
                require(pax != null && pax >= 1) { "Guest count is required" }
                require(captured.isNotEmpty()) { "No items to send" }
                repository.createAndSend(
                    NewOrder(route.storeId, tableId = route.tableId, pax = pax),
                    current.drafts.map {
                        it.choice.input().copy(quantity = saved[it.id] ?: it.quantity)
                    },
                ) { created ->
                    pendingKitchen =
                        KitchenRequest(
                            created.orderId,
                            created.orderNumber,
                            current.tableName,
                            pax,
                            captured,
                            null,
                            current.tableName,
                        )
                    mutable.update {
                        it.copy(
                            orderId = created.orderId,
                            drafts = emptyList(),
                            needsRecalculation = true,
                        )
                    }
                }
                mutable.update { it.copy(needsRecalculation = false) }
                pendingKitchen
            } else {
                val cart = requireNotNull(current.cart) { "Order data not loaded" }
                if (route.takeout && cart.status == "draft") repository.submitDraft(cart.id)
                repository.send(cart.id)
                KitchenRequest(
                    cart.id,
                    cart.orderNumber,
                    current.tableName,
                    cart.pax,
                    captured,
                    if (route.takeout) current.category else cart.orderCategory,
                    if (route.takeout) current.marker else current.tableName,
                )
            }
        }

    suspend fun checkout(): CheckoutRoute? =
        operation("checkout") {
            val current = state.value
            if (current.orderId == null || current.lines.isEmpty()) return@operation null
            edits.flush()
            if (current.needsRecalculation) {
                repository.recalculate(current.orderId)
                mutable.update { it.copy(needsRecalculation = false) }
            }
            if (route.takeout && current.cart?.status == "draft")
                repository.submitDraft(current.orderId)
            CheckoutRoute(
                current.orderId,
                if (route.takeout) "takeout" else "dine_in",
                route.tableId,
                current.tableName,
                if (route.takeout) current.category else null,
                if (route.takeout) current.marker else null,
            )
        }

    private suspend fun <T> operation(name: String, block: suspend () -> T): T? {
        val lock = synchronized(locks) { locks.getOrPut(name) { Mutex() } }
        if (!lock.tryLock()) return null
        mutable.update { it.copy(busy = it.busy + name) }
        try {
            return block()
        } finally {
            mutable.update { it.copy(busy = it.busy - name) }
            lock.unlock()
        }
    }
}
