package com.pmgt.pos.auth

import com.pmgt.pos.transport.ConvexException
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.io.IOException
import java.util.Base64

data class UserRole(val id: String, val name: String, val permissions: Set<String>, val scopeLevel: String)
data class SignedInUser(val id: String, val name: String, val email: String?, val storeId: String?, val role: UserRole?)
data class AuthState(val user: SignedInUser? = null, val loading: Boolean = false, val error: String? = null) {
    val isAuthenticated get() = user != null
    val selectedStoreId get() = user?.storeId
}

class AuthRepository(private val http: ConvexHttp, private val storage: SessionStorage, private val now: () -> Long = System::currentTimeMillis) {
    private val mutableState = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = mutableState.asStateFlow()
    private val mutex = Mutex()
    private var tokens: SessionTokens? = null
    init { http.freshToken = { freshAccessToken() } }

    fun hasPermission(permission: String) = state.value.user?.role?.permissions?.contains(permission) == true

    suspend fun signIn(email: String, password: String) {
        mutableState.value = AuthState(loading = true)
        try {
            mutex.withLock {
                acceptTokens(http.unauthenticatedAction("auth:signIn", buildJsonObject {
                    put("provider", "password")
                    putJsonObject("params") { put("email", email); put("password", password); put("flow", "signIn") }
                }))
            }
            reloadUser()
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { mutableState.value = AuthState(error = authError(e)); throw e }
    }

    suspend fun restore() {
        mutableState.value = AuthState(loading = true)
        try {
            mutex.withLock { tokens = storage.read(); http.token = tokens?.token }
            if (tokens == null) { mutableState.value = AuthState(); return }
            reloadUser()
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { mutableState.value = AuthState(error = "Connect to the internet and sign in again.") }
    }

    suspend fun reloadUser() {
        val value = try { http.query("sessions:getCurrentUser") }
        catch (e: ConvexException) {
            if (e.statusCode == 401 || e.statusCode == 403 || e.message.orEmpty().contains("Authentication required")) mutex.withLock { clear() }
            throw e
        }
        if (value == JsonNull) { clear(); return }
        val user = value.jsonObject
        val role = (user["role"] as? JsonObject)?.let {
            UserRole(it.string("_id"), it.string("name"), it["permissions"]!!.jsonArray.map { p -> p.jsonPrimitive.content }.toSet(), it.string("scopeLevel"))
        }
        mutableState.value = AuthState(SignedInUser(user.string("_id"), user.optionalString("name") ?: "User", user.optionalString("email"), user.optionalString("storeId"), role))
    }

    suspend fun freshAccessToken(forceRefresh: Boolean = false): String? = mutex.withLock {
        val current = tokens ?: return@withLock null
        val expiration = runCatching {
            Json.parseToJsonElement(String(Base64.getUrlDecoder().decode(current.token.split('.')[1]))).jsonObject["exp"]!!.jsonPrimitive.long * 1000
        }.getOrNull()
        if (!forceRefresh && (expiration == null || expiration > now() + 30_000)) return@withLock current.token
        try {
            var response: JsonElement? = null
            for (attempt in 0..2) {
                try {
                    response = http.unauthenticatedAction("auth:signIn", buildJsonObject { put("refreshToken", current.refreshToken) })
                    break
                } catch (e: ConvexException) { throw e }
                catch (e: IOException) { if (attempt == 2) throw e; delay(250L * (attempt + 1)) }
            }
            acceptTokens(requireNotNull(response))
            tokens?.token
        } catch (e: ConvexException) {
            // A rejected refresh has no offline session fallback.
            if (e.statusCode < 500 || e.message.orEmpty().contains("refresh token", ignoreCase = true) || e.message.orEmpty().contains("Session expired")) clear()
            throw e
        }
    }

    suspend fun signOut() {
        // Clear locally even if the server is unreachable, matching Convex Auth's client.
        try { http.action("auth:signOut") } finally { mutex.withLock { clear() } }
    }

    private suspend fun acceptTokens(value: JsonElement) {
        val result = value.jsonObject["tokens"] as? JsonObject ?: throw ConvexException(401, "Session expired")
        val next = SessionTokens(result.string("token"), result.string("refreshToken"))
        storage.write(next) // Publish only after durable token rotation.
        tokens = next
        http.token = next.token
    }

    private suspend fun clear() { storage.write(null); tokens = null; http.token = null; mutableState.value = AuthState() }
}

internal fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.content
internal fun JsonObject.optionalString(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull
fun authError(error: Exception): String = when {
    error.message.orEmpty().contains("InvalidSecret") -> "Invalid email or password."
    error.message.orEmpty().contains("InvalidAccountId") || error.message.orEmpty().contains("account not found") -> "No account found with this email."
    error.message.orEmpty().contains("TooManyFailedAttempts") -> "Too many failed attempts. Please try again later."
    error.message.orEmpty().contains("EmailNotVerified") -> "Please verify your email before signing in."
    else -> "Authentication failed. Please check your credentials and try again."
}
