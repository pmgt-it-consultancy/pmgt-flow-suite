package com.pmgt.pos.checkout

import com.pmgt.pos.orders.*
import com.pmgt.pos.telemetry.Telemetry
import com.pmgt.pos.transport.ConvexHttp
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class CheckoutUiState(
    val lines: List<PaymentLine> = listOf(PaymentLine()),
    val busy: Boolean = false,
    val discount: DiscountInput = DiscountInput("", emptyList(), "", ""),
    val discountVisible: Boolean = false,
    val approvalVisible: Boolean = false,
    val removing: String? = null,
    val alert: CheckoutAlert? = null,
    val completed: CompletedCheckout? = null,
    val needsResume: Boolean = false,
)

/** Screen inputs live above the lock composition. Only durable business intent reaches disk. */
class CheckoutSession(
    val owner: CheckoutOwner,
    val route: CheckoutRoute,
    private val repository: CheckoutRepository,
    private val http: ConvexHttp,
    private val cashierName: String,
    parentScope: CoroutineScope,
    private val isCurrent: () -> Boolean,
) {
    private val job = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + job)
    private val mutable = MutableStateFlow(CheckoutUiState())
    val state = mutable.asStateFlow()
    var approval: ManagerApprovalSession? = null
        private set

    private var actionId = ""
    private var removeId: String? = null
    private var approvalInput: DiscountInput? = null
    private var opened = false
    private var nextLine = 2
    var lastView: CheckoutView? = null

    fun open() {
        if (opened) return
        opened = true
        runAction("checkout.open") {
            val completed = repository.resume(owner, route.orderId)
            mutable.value = mutable.value.copy(completed = completed)
            if (completed == null) {
                try {
                    repository.refreshTotals(owner, route.orderId)
                } catch (e: CancellationException) {
                    throw e
                } catch (failure: Exception) {
                    /* Source warm recalc has no alert. */
                    Telemetry.nonFatal("checkout.refresh_totals", failure)
                }
            }
        }
    }

    private fun editable() =
        !state.value.busy && !state.value.needsResume && state.value.completed == null

    fun line(id: String, update: (PaymentLine) -> PaymentLine) {
        if (editable())
            mutable.value =
                state.value.copy(
                    lines = state.value.lines.map { if (it.id == id) update(it) else it }
                )
    }

    fun addLine(due: Double) {
        if (editable())
            mutable.value =
                state.value.copy(
                    lines =
                        state.value.lines +
                            PaymentLine(
                                (nextLine++).toString(),
                                "card_ewallet",
                                amount =
                                    PaymentMath.prefill(
                                        PaymentMath.coverage(state.value.lines, due).remaining
                                    ),
                            )
                )
    }

    fun removeLine(id: String) {
        if (editable() && state.value.lines.size > 1)
            mutable.value = state.value.copy(lines = state.value.lines.filter { it.id != id })
    }

    fun openDiscount() {
        if (editable())
            mutable.value =
                state.value.copy(
                    discountVisible = true,
                    discount = DiscountInput("", emptyList(), "", ""),
                )
    }

    fun discount(update: (DiscountInput) -> DiscountInput) {
        if (editable()) mutable.value = state.value.copy(discount = update(state.value.discount))
    }

    fun closeDiscount() {
        mutable.value = state.value.copy(discountVisible = false)
    }

    fun validDiscount() =
        state.value.discount.let {
            it.type.isNotEmpty() &&
                it.itemIds.isNotEmpty() &&
                it.customerId.trim().isNotEmpty() &&
                it.customerName.trim().isNotEmpty()
        }

    fun requestApply() {
        if (editable() && validDiscount()) startApproval(null)
    }

    fun requestRemoval(id: String) {
        if (editable()) mutable.value = state.value.copy(removing = id)
    }

    fun confirmRemoval() {
        val id = state.value.removing ?: return
        startApproval(id)
    }

    fun cancelRemoval() {
        mutable.value = state.value.copy(removing = null)
    }

    private fun startApproval(id: String?) {
        actionId = UUID.randomUUID().toString()
        removeId = id
        approvalInput = state.value.discount.copy(itemIds = state.value.discount.itemIds.toList())
        approval?.close()
        approval = ManagerApprovalSession(http, owner, route.orderId, actionId, isCurrent)
        mutable.value =
            state.value.copy(discountVisible = false, removing = null, approvalVisible = true)
    }

    fun closeApproval() {
        approval?.close()
        approval = null
        mutable.value = state.value.copy(approvalVisible = false)
    }

    fun approve() {
        val selected = approval ?: return
        scope.launch {
            val permit = selected.verify() ?: return@launch
            if (selected !== approval || !isCurrent()) return@launch
            mutable.value = state.value.copy(approvalVisible = false)
            val input = requireNotNull(approvalInput)
            val remove = removeId
            runAction(if (remove == null) "checkout.discount" else "checkout.remove_discount") {
                if (remove == null) {
                    repository.apply(owner, route.orderId, actionId, input, permit)
                    Telemetry.event("discount_applied", "discount_type" to input.type)
                    mutable.value =
                        state.value.copy(
                            alert =
                                CheckoutAlert(
                                    "Success",
                                    "Discount applied to ${input.itemIds.size} item${if (input.itemIds.size > 1) "s" else ""}",
                                )
                        )
                } else repository.remove(owner, route.orderId, actionId, remove, permit)
            }
        }
    }

    val approvalTitle
        get() = if (removeId == null) "Approve Discount" else "Approve Removal"

    fun complete(due: Double) {
        if (state.value.completed != null || state.value.busy) return
        if (state.value.needsResume) {
            retry()
            return
        }
        PaymentMath.validation(state.value.lines, due)?.let {
            mutable.value = state.value.copy(alert = CheckoutAlert("Error", it))
            return
        }
        val lines = state.value.lines.toList()
        runAction("checkout.settle") {
            val completed = repository.settle(owner, route, lines, cashierName)
            logSettled(completed)
            mutable.value = state.value.copy(completed = completed)
        }
    }

    fun retry() = runAction("checkout.resume") {
        val completed = repository.resume(owner, route.orderId)
        // Only a resumed payment returns a completion, and the settle that left it was never logged.
        completed?.let(::logSettled)
        mutable.value = state.value.copy(completed = completed, needsResume = false)
    }

    /** Usage only: which tenders and service mode, never amounts. */
    private fun logSettled(completed: CompletedCheckout) =
        Telemetry.event(
            "order_settled",
            "payment_method" to completed.lines.map { it.paymentMethod }.distinct().sorted().joinToString("+"),
            "order_type" to completed.route.orderType,
            // Counter orders choose dine-in or takeout; a table order is dine-in by its type.
            "order_category" to (completed.route.orderCategory ?: completed.route.orderType),
        )

    fun dismissAlert() {
        mutable.value = state.value.copy(alert = null)
    }

    private fun runAction(operation: String, action: suspend () -> Unit) {
        if (state.value.busy || !isCurrent()) return
        mutable.value = state.value.copy(busy = true)
        scope.launch {
            try {
                action()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                if (error !is PaymentInvalid) Telemetry.nonFatal(operation, error)
                val pending =
                    repository.pendingActions(owner.storeId).first().any {
                        it.orderId == route.orderId || it.state == FinancialActionState.Unreadable
                    }
                mutable.value =
                    state.value.copy(
                        needsResume = pending,
                        alert = CheckoutAlert("Error", error.message ?: "Payment failed"),
                    )
            } finally {
                mutable.value = state.value.copy(busy = false)
            }
        }
    }

    fun dispose() {
        approval?.close()
        job.cancel()
    }
}

class CheckoutSessions(private val scope: CoroutineScope) {
    private val sessions = mutableMapOf<String, CheckoutSession>()
    val deferredRecovery = mutableSetOf<String>()

    fun get(key: String, create: (CoroutineScope) -> CheckoutSession) =
        sessions.getOrPut(key) { create(scope) }

    fun remove(key: String) {
        sessions.remove(key)?.dispose()
    }

    fun clear() {
        sessions.values.forEach { it.dispose() }
        sessions.clear()
        deferredRecovery.clear()
    }
}
