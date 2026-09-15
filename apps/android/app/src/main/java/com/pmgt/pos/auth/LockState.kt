package com.pmgt.pos.auth

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable data class StoredLockRoute(val name: String, val params: JsonObject? = null)

@Serializable
data class LockSnapshot(
    val isLocked: Boolean = false,
    val lockedAt: Long? = null,
    val lockedUserId: String? = null,
    val lockedUserName: String? = null,
    val lockedUserRole: String? = null,
    val routeHistory: List<StoredLockRoute> = emptyList(),
)

data class LockUiState(
    val snapshot: LockSnapshot = LockSnapshot(),
    val failedAttempts: Int = 0,
    val cooldownUntil: Long? = null,
    val showIdleWarning: Boolean = false,
)

interface LockStorage {
    fun read(): LockSnapshot

    fun write(snapshot: LockSnapshot)
}

class LockState(
    private val storage: LockStorage,
    private val http: ConvexHttp,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutableState = MutableStateFlow(LockUiState(storage.read()))
    val state = mutableState.asStateFlow()
    var userHasPin = false
        private set

    var timeoutMs: Long? = null
        private set

    private var lastActivity = now()
    private var timerStartedAt = now()
    private var backgroundAt: Long? = null
    private var route = "HomeScreen"

    suspend fun configure(user: SignedInUser) {
        userHasPin =
            http
                .query("screenLock:getUserHasPin", buildJsonObject { put("userId", user.id) })
                .jsonPrimitive
                .boolean
        timeoutMs =
            user.storeId?.let { storeId ->
                http
                    .query(
                        "screenLock:getAutoLockTimeout",
                        buildJsonObject { put("storeId", storeId) },
                    )
                    .jsonPrimitive
                    .double
                    .takeIf { it > 0 }
                    ?.let { (it * 60_000).toLong() }
            }
        resetActivity()
    }

    fun setRouteHistory(routes: List<StoredLockRoute>) {
        save(state.value.snapshot.copy(routeHistory = routes))
        setCurrentRoute(routes.lastOrNull()?.name ?: "HomeScreen")
    }

    fun setCurrentRoute(name: String) {
        route = name
        resetActivity()
    }

    fun resetActivity() {
        lastActivity = now()
        timerStartedAt = now()
        mutableState.value = state.value.copy(showIdleWarning = false)
    }

    fun onBackground() {
        backgroundAt = now()
    }

    suspend fun onForeground(user: SignedInUser?) {
        if (
            user != null &&
                backgroundAt != null &&
                timeoutMs != null &&
                now() - lastActivity >= timeoutMs!! &&
                !state.value.snapshot.isLocked &&
                userHasPin
        )
            lock(user, "idle_timeout")
        backgroundAt = null
        timerStartedAt = now()
    }

    suspend fun tick(user: SignedInUser) {
        if (
            backgroundAt != null ||
                route == "CheckoutScreen" ||
                state.value.snapshot.isLocked ||
                !userHasPin
        )
            return
        val timeout = timeoutMs ?: return
        val elapsed = now() - timerStartedAt
        if (elapsed >= timeout) lock(user, "idle_timeout")
        else
            mutableState.value =
                state.value.copy(showIdleWarning = timeout > 30_000 && elapsed >= timeout - 30_000)
    }

    suspend fun lock(user: SignedInUser, trigger: String = "manual") {
        if (!userHasPin || state.value.snapshot.isLocked) return
        save(
            state.value.snapshot.copy(
                isLocked = true,
                lockedAt = now(),
                lockedUserId = user.id,
                lockedUserName = user.name,
                lockedUserRole = user.role?.name ?: "Staff",
            )
        )
        mutableState.value = LockUiState(state.value.snapshot)
        user.storeId?.let { store ->
            try {
                http.mutation(
                    "screenLock:screenLock",
                    buildJsonObject {
                        put("storeId", store)
                        put("trigger", trigger)
                    },
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {}
        }
    }

    fun cooldownSeconds(): Int =
        ((state.value.cooldownUntil?.minus(now()) ?: 0).coerceAtLeast(0) + 999).div(1000).toInt()

    fun lockDeadline(): Long? = timeoutMs?.let { timerStartedAt + it }

    suspend fun unlock(storeId: String, pin: String, managerId: String? = null): String? {
        if (managerId == null && cooldownSeconds() > 0)
            return "Please wait ${cooldownSeconds()} seconds before trying again."
        val userId = state.value.snapshot.lockedUserId ?: return "No locked user"
        val result =
            http
                .action(
                    if (managerId == null) "screenLockActions:screenUnlock"
                    else "screenLockActions:screenUnlockOverride",
                    buildJsonObject {
                        put("storeId", storeId)
                        if (managerId == null) {
                            put("userId", userId)
                            put("pin", pin)
                        } else {
                            put("lockedUserId", userId)
                            put("managerId", managerId)
                            put("managerPin", pin)
                        }
                    },
                )
                .jsonObject
        if (result["success"]?.jsonPrimitive?.boolean == true) {
            clearLock()
            return null
        }
        if (managerId == null) {
            val attempts = state.value.failedAttempts + 1
            mutableState.value =
                state.value.copy(
                    failedAttempts = if (attempts >= 5) 0 else attempts,
                    cooldownUntil = if (attempts >= 5) now() + 30_000 else null,
                )
        }
        return result.optionalString("error") ?: "Invalid PIN"
    }

    fun clearLock() {
        save(LockSnapshot(routeHistory = state.value.snapshot.routeHistory))
        mutableState.value = LockUiState(state.value.snapshot)
        resetActivity()
    }

    private fun save(snapshot: LockSnapshot) {
        storage.write(snapshot)
        mutableState.value = state.value.copy(snapshot = snapshot)
    }
}
