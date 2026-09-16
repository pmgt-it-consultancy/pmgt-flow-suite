package com.pmgt.pos.checkout

import kotlinx.serialization.Serializable

@Serializable
data class CorrectionInput(
    val kind: String,
    val reason: String,
    val itemIds: List<String> = emptyList(),
    val refundMethod: String? = null,
)

@Serializable
data class CompletedCorrection(
    val orderId: String,
    val voidId: String,
    val replacementOrderId: String?,
    val refundAmount: Double,
)

interface CorrectionRepository {
    suspend fun correct(
        owner: CheckoutOwner,
        orderId: String,
        actionId: String,
        input: CorrectionInput,
        approval: CheckoutApproval,
    ): CompletedCorrection

    suspend fun saved(owner: CheckoutOwner, orderId: String): SavedCorrection?

    suspend fun resume(
        owner: CheckoutOwner,
        orderId: String,
        expectedActionId: String? = null,
    ): CompletedCorrection
}

data class SavedCorrectionItem(val name: String, val quantity: Double)

data class SavedCorrection(
    val actionId: String,
    val input: CorrectionInput,
    val items: List<SavedCorrectionItem>,
)
