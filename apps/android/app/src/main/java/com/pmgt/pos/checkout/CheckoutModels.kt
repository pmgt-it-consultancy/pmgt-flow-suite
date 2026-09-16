package com.pmgt.pos.checkout

import com.pmgt.pos.orders.*
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable

@Serializable data class CheckoutOwner(val userId: String, val storeId: String)

@Serializable
data class CheckoutDiscount(
    val id: String,
    val itemId: String?,
    val type: String,
    val customerName: String,
    val customerId: String,
    val itemName: String?,
    val amount: Double,
    val approvedBy: String?,
)

@Serializable
data class CheckoutStore(
    val name: String,
    val address1: String?,
    val address2: String?,
    val tin: String?,
    val contactNumber: String?,
    val telephone: String?,
    val email: String?,
    val website: String?,
    val footer: String?,
)

@Serializable
data class CheckoutView(
    val cart: OrderCart,
    val discounts: List<CheckoutDiscount>,
    val store: CheckoutStore,
)

/** Immutable local completion; neither delivery nor printing is implied. Task11 consumes this. */
@Serializable
data class CompletedCheckout(
    val view: CheckoutView,
    val route: CheckoutRoute,
    val cashierName: String,
    val lines: List<PaymentLine>,
    val payments: List<BuiltPayment>,
    val transactionAt: Long,
    val displayChange: Double,
) {
    val paymentMethod
        get() =
            if (lines.size == 1 && lines.first().paymentMethod == "card_ewallet") "card_ewallet"
            else "cash"
}

@Serializable
data class DiscountInput(
    val type: String,
    val itemIds: List<String>,
    val customerName: String,
    val customerId: String,
)

data class ManagerAccount(val id: String, val name: String, val roleName: String)

class CheckoutApproval
internal constructor(
    val owner: CheckoutOwner,
    val orderId: String,
    val actionId: String,
    val managerId: String,
    internal val isCurrent: () -> Boolean = { true },
)

enum class FinancialActionState {
    Recoverable,
    Conflicted,
    Unreadable,
}

data class PendingFinancialAction(
    val orderId: String?,
    val kind: String?,
    val state: FinancialActionState,
)

interface CheckoutRepository {
    /** Read-only, same-cashier route for a paid order hidden from active-order navigation. */
    suspend fun recoverablePayment(owner: CheckoutOwner, orderId: String): CheckoutRoute?

    fun pendingActions(storeId: String): Flow<List<PendingFinancialAction>>

    fun observe(owner: CheckoutOwner, orderId: String): Flow<CheckoutView?>

    suspend fun settle(
        owner: CheckoutOwner,
        route: CheckoutRoute,
        lines: List<PaymentLine>,
        cashierName: String,
    ): CompletedCheckout

    suspend fun resume(owner: CheckoutOwner, orderId: String): CompletedCheckout?

    suspend fun refreshTotals(owner: CheckoutOwner, orderId: String)

    suspend fun apply(
        owner: CheckoutOwner,
        orderId: String,
        actionId: String,
        input: DiscountInput,
        approval: CheckoutApproval,
    )

    suspend fun remove(
        owner: CheckoutOwner,
        orderId: String,
        actionId: String,
        discountId: String,
        approval: CheckoutApproval,
    )
}
