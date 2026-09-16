package com.pmgt.pos.checkout

import com.pmgt.pos.browse.money
import com.pmgt.pos.transport.ConvexHttp
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class CorrectionUiState(
    val input: CorrectionInput? = null,
    val approvalVisible: Boolean = false,
    val busy: Boolean = false,
    val alert: CheckoutAlert? = null,
    val completed: CompletedCorrection? = null,
    val saved: SavedCorrection? = null,
)

/** Memory belongs to the auth epoch above lock; saved intent belongs to actual cashier/store. */
class CorrectionSession(
    val owner: CheckoutOwner,
    val orderId: String,
    private val repository: CorrectionRepository,
    private val http: ConvexHttp,
    parentScope: CoroutineScope,
    private val isCurrent: () -> Boolean,
) {
    private val job = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + job)
    private val mutable = MutableStateFlow(CorrectionUiState())
    val state = mutable.asStateFlow()
    var approval: ManagerApprovalSession? = null
        private set

    private var actionId = ""
    private var approvedInput: CorrectionInput? = null
    var lastKind = "void"
        private set

    fun open(kind: String) {
        if (state.value.busy || state.value.approvalVisible || !isCurrent()) return
        lastKind = kind
        runAction {
            val saved = repository.saved(owner, orderId)
            if (saved != null) {
                lastKind = saved.input.kind
                mutable.value = state.value.copy(saved = saved, input = null, alert = null)
            } else
                mutable.value =
                    state.value.copy(
                        input =
                            CorrectionInput(
                                kind,
                                "",
                                refundMethod = if (kind == "refund") "cash" else null,
                            ),
                        alert = null,
                    )
        }
    }

    fun change(update: (CorrectionInput) -> CorrectionInput) {
        if (!state.value.busy)
            state.value.input?.let { mutable.value = state.value.copy(input = update(it)) }
    }

    fun closeInput() {
        mutable.value = state.value.copy(input = null)
    }

    fun later() {
        mutable.value = state.value.copy(saved = null)
    }

    fun resumeSaved() {
        val saved = state.value.saved ?: return
        runAction {
            complete(repository.resume(owner, orderId, saved.actionId))
            mutable.value = state.value.copy(saved = null)
        }
    }

    fun requestApproval() {
        val input = state.value.input ?: return
        if (
            state.value.busy ||
                input.reason.trim().isEmpty() ||
                input.kind == "refund" && input.itemIds.isEmpty()
        )
            return
        approvedInput = input.copy(reason = input.reason.trim(), itemIds = input.itemIds.toList())
        actionId = UUID.randomUUID().toString()
        approval?.close()
        approval = ManagerApprovalSession(http, owner, orderId, actionId, isCurrent)
        mutable.value = state.value.copy(input = null, approvalVisible = true)
    }

    fun closeApproval() {
        approval?.close()
        approval = null
        approvedInput = null
        mutable.value = state.value.copy(approvalVisible = false)
    }

    fun approve() {
        if (state.value.busy || !state.value.approvalVisible) return
        val session = approval ?: return
        scope.launch {
            val permit = session.verify() ?: return@launch
            if (
                session !== approval ||
                    !isCurrent() ||
                    state.value.busy ||
                    !state.value.approvalVisible
            )
                return@launch
            val input = approvedInput ?: return@launch
            mutable.value = state.value.copy(approvalVisible = false)
            runAction { complete(repository.correct(owner, orderId, actionId, input, permit)) }
        }
    }

    private fun complete(result: CompletedCorrection) {
        val alert =
            if (lastKind == "void") CheckoutAlert("Success", "Order has been voided")
            else
                CheckoutAlert(
                    "Refund Processed",
                    "Refund of ${money(result.refundAmount)} has been processed." +
                        if (result.replacementOrderId != null)
                            " A new order has been created with the remaining items."
                        else "",
                )
        mutable.value = state.value.copy(completed = result, alert = alert, input = null)
    }

    fun dismissAlert() {
        mutable.value = state.value.copy(alert = null)
    }

    private fun runAction(block: suspend () -> Unit) {
        if (state.value.busy || !isCurrent()) return
        mutable.value = state.value.copy(busy = true)
        scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                mutable.value =
                    state.value.copy(
                        alert = CheckoutAlert("Error", e.message ?: "Failed to process correction")
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

class CorrectionSessions(private val scope: CoroutineScope) {
    private val sessions = mutableMapOf<String, CorrectionSession>()
    var visibleOrderId: String? = null

    fun get(key: String, create: (CoroutineScope) -> CorrectionSession) =
        sessions.getOrPut(key) { create(scope) }

    fun remove(key: String) {
        sessions.remove(key)?.dispose()
        visibleOrderId = null
    }

    fun clear() {
        sessions.values.forEach { it.dispose() }
        sessions.clear()
        visibleOrderId = null
    }
}
