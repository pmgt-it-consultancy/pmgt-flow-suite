package com.pmgt.pos.checkout

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.json.*

data class ApprovalState(
    val managers: List<ManagerAccount>? = null,
    val selectedId: String? = null,
    val pin: String = "",
    val verifying: Boolean = false,
    val error: CheckoutAlert? = null,
)

data class CheckoutAlert(
    val title: String,
    val message: String,
    val occurrence: Long = System.nanoTime(),
)

class ManagerApprovalSession(
    private val http: ConvexHttp,
    private val owner: CheckoutOwner,
    private val orderId: String,
    private val actionId: String,
    private val isCurrent: () -> Boolean,
) {
    private val mutable = MutableStateFlow(ApprovalState())
    val state = mutable.asStateFlow()
    private var generation = 0L
    private var closed = false
    private val flight = Mutex()

    suspend fun load() {
        val epoch = generation
        try {
            val rows =
                http
                    .query(
                        "helpers/usersHelpers:listManagers",
                        buildJsonObject { put("storeId", owner.storeId) },
                    )
                    .jsonArray
            if (epoch != generation || closed || !isCurrent()) return
            mutable.value =
                mutable.value.copy(
                    managers =
                        rows.map { row ->
                            val m = row.jsonObject
                            ManagerAccount(
                                m.getValue("_id").jsonPrimitive.content,
                                m.getValue("name").jsonPrimitive.content,
                                m.getValue("roleName").jsonPrimitive.content,
                            )
                        }
                )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (epoch == generation && !closed && isCurrent())
                mutable.value =
                    mutable.value.copy(error = CheckoutAlert("Error", "Failed to load managers"))
        }
    }

    fun select(id: String) {
        mutable.value = mutable.value.copy(selectedId = id)
    }

    fun pin(value: String) {
        mutable.value = mutable.value.copy(pin = value.take(6))
    }

    fun dismissError() {
        mutable.value = mutable.value.copy(error = null)
    }

    fun close() {
        generation++
        closed = true
        mutable.value = ApprovalState()
    }

    suspend fun verify(): CheckoutApproval? {
        if (!flight.tryLock()) return null
        val epoch = generation
        try {
            val selected = mutable.value.selectedId
            val pin = mutable.value.pin
            if (
                closed ||
                    !isCurrent() ||
                    pin.isEmpty() ||
                    mutable.value.managers.orEmpty().none { it.id == selected }
            )
                return null
            mutable.value = mutable.value.copy(verifying = true, error = null)
            val result =
                http
                    .action(
                        "users:verifyPin",
                        buildJsonObject {
                            put("userId", selected)
                            put("pin", pin)
                        },
                    )
                    .jsonObject
            if (epoch != generation || closed || !isCurrent()) return null
            if (result["success"]?.jsonPrimitive?.booleanOrNull == true) {
                mutable.value = mutable.value.copy(pin = "", selectedId = null)
                return CheckoutApproval(owner, orderId, actionId, selected!!) {
                    epoch == generation && !closed && isCurrent()
                }
            }
            mutable.value =
                mutable.value.copy(
                    error =
                        CheckoutAlert(
                            "Invalid PIN",
                            result["error"]?.jsonPrimitive?.contentOrNull?.takeIf {
                                it.isNotEmpty()
                            } ?: "The PIN entered is incorrect",
                        )
                )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (epoch == generation && !closed && isCurrent())
                mutable.value =
                    mutable.value.copy(error = CheckoutAlert("Error", "Failed to verify PIN"))
        } finally {
            if (epoch == generation) mutable.value = mutable.value.copy(verifying = false)
            flight.unlock()
        }
        return null
    }
}
