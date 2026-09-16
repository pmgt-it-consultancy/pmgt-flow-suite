package com.pmgt.pos.transport

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ConvexException(val statusCode: Int, message: String) : IOException(message)

/**
 * Stock OkHttp defaults give every request ten seconds, which a 1500-row pull page over tablet
 * Wi-Fi routinely exceeds; the request then fails and, because adoption treats one failure as
 * terminal, the till stalls. These budgets are sized for that page rather than a small function
 * call, and the call timeout exists so a stalled request cannot hang for the whole service.
 */
object ConvexClients {
    fun default(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(180, TimeUnit.SECONDS)
        .build()
}

/** Shared authenticated HTTP boundary for functions and the existing /sync HTTP actions. */
class ConvexHttp(
    private val deploymentUrl: String,
    private val client: OkHttpClient = ConvexClients.default(),
    private val siteUrl: String = deploymentUrl.replace(".convex.cloud", ".convex.site"),
) {
    @Volatile var token: String? = null
    var freshToken: (suspend () -> String?)? = null
    suspend fun query(path: String, args: JsonObject = buildJsonObject {}): JsonElement {
        val retryDelays = listOf(250L, 500L)
        for (attempt in 0..retryDelays.size) {
            try {
                return function("query", path, args)
            } catch (failure: ConvexException) {
                if (failure.statusCode !in 500..599 || attempt == retryDelays.size) throw failure
                delay(retryDelays[attempt])
            }
        }
        error("unreachable")
    }
    suspend fun mutation(path: String, args: JsonObject = buildJsonObject {}) = function("mutation", path, args)
    suspend fun action(path: String, args: JsonObject = buildJsonObject {}) = function("action", path, args)
    suspend fun unauthenticatedAction(path: String, args: JsonObject) = function("action", path, args, false)

    suspend fun httpAction(path: String, args: JsonObject, headers: Map<String, String> = emptyMap()): JsonElement {
        require(path.startsWith("/") && !path.startsWith("//"))
        return post(siteUrl.trimEnd('/') + path, args, freshToken?.invoke() ?: token, headers)
    }

    private suspend fun function(kind: String, path: String, args: JsonObject, authenticated: Boolean = true): JsonElement {
        val bearer = if (authenticated) freshToken?.invoke() ?: token else null
        val envelope = post(deploymentUrl.trimEnd('/') + "/api/$kind", buildJsonObject {
            put("path", path); put("args", args); put("format", "json")
        }, bearer).jsonObject
        if (envelope["status"]?.jsonPrimitive?.content != "success") {
            throw ConvexException(200, envelope["errorMessage"]?.jsonPrimitive?.content ?: "Convex request failed")
        }
        return envelope["value"] ?: JsonNull
    }

    private suspend fun post(url: String, body: JsonObject, bearer: String?, headers: Map<String, String> = emptyMap()): JsonElement {
        val request = Request.Builder().url(url).post(body.toString().toRequestBody("application/json".toMediaType()))
        headers.forEach { (name, value) -> request.header(name, value) }
        if (bearer != null) request.header("Authorization", "Bearer $bearer")
        return suspendCancellableCoroutine { continuation ->
            val call = client.newCall(request.build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        try {
                            val text = it.body?.string().orEmpty()
                            if (!it.isSuccessful) throw ConvexException(it.code, runCatching {
                                val error = Json.parseToJsonElement(text).jsonObject
                                error["errorMessage"]?.jsonPrimitive?.contentOrNull
                                    ?: error["message"]?.jsonPrimitive?.contentOrNull
                            }.getOrNull() ?: "Server request failed (${it.code})")
                            val result = Json.parseToJsonElement(text)
                            if (continuation.isActive) continuation.resume(result)
                        } catch (e: Exception) { if (continuation.isActive) continuation.resumeWithException(e) }
                    }
                }
            })
        }
    }
}
