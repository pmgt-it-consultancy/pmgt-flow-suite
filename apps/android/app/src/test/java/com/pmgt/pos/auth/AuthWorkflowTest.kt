package com.pmgt.pos.auth

import com.pmgt.pos.transport.ConvexHttp
import java.util.Base64
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class AuthWorkflowTest {
    private val expiredToken = "eyJhbGciOiJub25lIn0.eyJleHAiOjB9."

    private fun MockWebServer.success(value: String) =
        enqueue(MockResponse().setBody("""{"status":"success","value":$value}"""))

    private fun jwt(expirySeconds: Long): String {
        val encoder = Base64.getUrlEncoder().withoutPadding()
        return "${encoder.encodeToString("{}".toByteArray())}.${encoder.encodeToString("""{"exp":$expirySeconds}""".toByteArray())}.signature"
    }

    /**
     * A till that is already signed in must never flash the login form on a cold start. Until
     * restore has decided, "no user yet" is not the same as "signed out", and only the repository
     * can tell them apart.
     */
    @Test
    fun `session is undecided until restore finishes`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage().apply { write(SessionTokens("access", "refresh")) }
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            assertFalse("a fresh repository has not decided yet", auth.state.value.restored)
            server.success("""{"_id":"cashier","name":"Cashier","role":null}""")
            auth.restore()
            assertTrue(auth.state.value.restored)
            assertEquals("cashier", auth.state.value.user?.id)
        }
    }

    @Test
    fun `restore decides even when there is no stored session`() = runTest {
        MockWebServer().use { server ->
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), MemorySessionStorage())
            auth.restore()
            assertTrue(auth.state.value.restored)
            assertNull(auth.state.value.user)
        }
    }

    @Test
    fun `restore decides even when the server cannot be reached`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage().apply { write(SessionTokens("access", "refresh")) }
            repeat(3) { server.enqueue(MockResponse().setResponseCode(503)) }
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            auth.restore()
            assertTrue("an unreachable server must not leave the till on a splash", auth.state.value.restored)
            assertEquals("read-only auth lookup retries transient server failures", 3, server.requestCount)
        }
    }

    @Test
    fun `signing in never returns the till to the undecided state`() = runTest {
        MockWebServer().use { server ->
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), MemorySessionStorage())
            auth.restore()
            server.enqueue(MockResponse().setResponseCode(401))
            runCatching { auth.signIn("cashier@test.com", "wrong") }
            assertTrue("a failed sign-in stays on the login form", auth.state.value.restored)
        }
    }

    @Test
    fun `server revoked session returns to login`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage()
            storage.write(SessionTokens("access", "refresh"))
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, storage)
            server.success("""{"_id":"cashier","role":null}""")
            auth.restore()
            server.enqueue(MockResponse().setResponseCode(401))
            runCatching { auth.reloadUser() }
            assertFalse(auth.state.value.isAuthenticated)
            assertNull(http.token)
        }
    }

    @Test
    fun `cold restore publishes user after expired token refresh`() = runTest {
        MockWebServer().use { server ->
            val storage =
                MemorySessionStorage().apply { write(SessionTokens(expiredToken, "refresh")) }
            server.success("""{"tokens":{"token":"fresh-access","refreshToken":"fresh-refresh"}}""")
            server.success("""{"_id":"cashier","name":"Cashier","role":null}""")
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            auth.restore()
            assertEquals("cashier", auth.state.value.user?.id)
            assertFalse(auth.state.value.loading)
            assertEquals("fresh-access", storage.read()?.token)
        }
    }

    @Test
    fun `sign out clears session when expired token refreshes during revocation`() = runTest {
        MockWebServer().use { server ->
            var now = 1_000_000L
            val storage =
                MemorySessionStorage().apply { write(SessionTokens(expiredToken, "refresh")) }
            val restoredToken = jwt(expirySeconds = 2_000)
            val logoutToken = jwt(expirySeconds = 4_000)
            server.success(
                """{"tokens":{"token":"$restoredToken","refreshToken":"fresh-refresh"}}"""
            )
            server.success("""{"_id":"cashier","name":"Cashier","role":null}""")
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage) { now }
            auth.restore()
            now = 2_000_000L
            server.success(
                """{"tokens":{"token":"$logoutToken","refreshToken":"logout-refresh"}}"""
            )
            server.success("null")
            auth.signOut()
            assertNull(storage.read())
            assertFalse(auth.state.value.isAuthenticated)
            val paths =
                List(4) {
                    Json.parseToJsonElement(server.takeRequest().body.readUtf8())
                        .jsonObject["path"]!!
                        .jsonPrimitive
                        .content
                }
            assertEquals(
                listOf("auth:signIn", "sessions:getCurrentUser", "auth:signIn", "auth:signOut"),
                paths,
            )
        }
    }

    @Test
    fun `delayed reload cannot restore a signed out session`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage().apply { write(SessionTokens("access", "refresh")) }
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            server.success("""{"_id":"cashier","role":null}""")
            auth.restore()
            server.enqueue(
                MockResponse()
                    .setBodyDelay(500, java.util.concurrent.TimeUnit.MILLISECONDS)
                    .setBody("""{"status":"success","value":{"_id":"cashier","role":null}}""")
            )
            server.success("null")
            val reload = async { runCatching { auth.reloadUser() } }
            delay(50)
            auth.signOut()
            reload.await()
            assertFalse(auth.state.value.isAuthenticated)
            assertNull(storage.read())
        }
    }

    @Test
    fun `delayed reload from session A cannot overwrite newly signed in session B`() = runTest {
        MockWebServer().use { server ->
            val storage =
                MemorySessionStorage().apply { write(SessionTokens("access-a", "refresh-a")) }
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            server.success("""{"_id":"a","name":"A","role":null}""")
            auth.restore()
            server.takeRequest()
            server.enqueue(
                MockResponse()
                    .setBodyDelay(500, java.util.concurrent.TimeUnit.MILLISECONDS)
                    .setBody("""{"status":"success","value":{"_id":"a","name":"A","role":null}}""")
            )
            server.success("""{"tokens":{"token":"access-b","refreshToken":"refresh-b"}}""")
            server.success("""{"_id":"b","name":"B","role":null}""")
            val stale = async { auth.reloadUser() }
            withContext(Dispatchers.IO) { server.takeRequest() }
            auth.signIn("b@example.com", "password")
            stale.await()
            assertEquals("b", auth.state.value.user?.id)
            assertEquals("access-b", storage.read()?.token)
        }
    }

    @Test
    fun `cancelled logout still revokes and durably clears session`() = runTest {
        MockWebServer().use { server ->
            val storage = SuspendingSessionStorage(SessionTokens("access", "refresh"))
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            server.success("""{"_id":"cashier","role":null}""")
            auth.restore()
            server.success("null")
            val logout = launch(start = CoroutineStart.UNDISPATCHED) { auth.signOut() }
            logout.cancelAndJoin()
            assertFalse(auth.state.value.isAuthenticated)
            assertNull(storage.value)
            server.takeRequest()
            assertEquals(
                "auth:signOut",
                Json.parseToJsonElement(server.takeRequest().body.readUtf8())
                    .jsonObject["path"]
                    ?.jsonPrimitive
                    ?.content,
            )
        }
    }

    @Test
    fun `refresh rotates durable credentials and sign out clears them when server is down`() =
        runTest {
            MockWebServer().use { server ->
                val storage = MemorySessionStorage()
                storage.write(SessionTokens("access", "refresh"))
                val http = ConvexHttp(server.url("/").toString())
                val auth = AuthRepository(http, storage)
                server.success("""{"_id":"cashier","role":null}""")
                auth.restore()
                server.success(
                    """{"tokens":{"token":"rotated-access","refreshToken":"rotated-refresh"}}"""
                )
                assertEquals("rotated-access", auth.freshAccessToken(forceRefresh = true))
                assertEquals("rotated-refresh", storage.read()?.refreshToken)
                server.takeRequest()
                val refresh = server.takeRequest()
                assertNull(refresh.getHeader("Authorization"))
                assertEquals(
                    "refresh",
                    Json.parseToJsonElement(refresh.body.readUtf8())
                        .jsonObject["args"]!!
                        .jsonObject["refreshToken"]!!
                        .jsonPrimitive
                        .content,
                )
                server.enqueue(MockResponse().setResponseCode(503))
                runCatching { auth.signOut() }
                assertFalse(auth.state.value.isAuthenticated)
                assertNull(storage.read())
                assertEquals(
                    "Bearer rotated-access",
                    server.takeRequest().getHeader("Authorization"),
                )
            }
        }

    @Test
    fun `offline cold start never grants cached identity or permissions`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage()
            storage.write(SessionTokens("access", "refresh"))
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            repeat(3) { server.enqueue(MockResponse().setResponseCode(503)) }
            auth.restore()
            assertFalse(auth.state.value.isAuthenticated)
            assertFalse(auth.hasPermission("orders.create"))
            assertEquals("identity lookup exhausts safe retries before denying the session", 3, server.requestCount)
        }
    }

    @Test
    fun `invalid credentials produce RN friendly error`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setResponseCode(560)
                    .setBody("""{"status":"error","errorMessage":"InvalidSecret"}""")
            )
            val auth =
                AuthRepository(ConvexHttp(server.url("/").toString()), MemorySessionStorage())
            runCatching { auth.signIn("cashier@example.com", "wrong") }
            assertEquals("Invalid email or password.", auth.state.value.error)
            assertFalse(auth.state.value.isAuthenticated)
        }
    }

    @Test
    fun `server role updates remove permissions from an open session`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage()
            storage.write(SessionTokens("access", "refresh"))
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            server.success(
                """{"_id":"cashier","role":{"_id":"role","name":"Manager","scopeLevel":"branch","permissions":["discounts.approve"]}}"""
            )
            auth.restore()
            assertTrue(auth.hasPermission("discounts.approve"))
            server.success("""{"_id":"cashier","role":null}""")
            auth.reloadUser()
            assertFalse(auth.hasPermission("discounts.approve"))
        }
    }

    @Test
    fun `expired refresh credentials clear session even for Convex action HTTP error`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage()
            storage.write(SessionTokens("access", "refresh"))
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, storage)
            server.success("""{"_id":"cashier","role":null}""")
            auth.restore()
            server.enqueue(
                MockResponse()
                    .setResponseCode(560)
                    .setBody("""{"status":"error","errorMessage":"Invalid refresh token"}""")
            )
            runCatching { auth.freshAccessToken(forceRefresh = true) }
            assertFalse(auth.state.value.isAuthenticated)
            assertNull(http.token)
            assertNull(storage.read())
        }
    }

    @Test
    fun `cashier signs in and receives only server granted permissions`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setBody(
                        """{"status":"success","value":{"tokens":{"token":"access","refreshToken":"refresh"}}}"""
                    )
            )
            server.enqueue(
                MockResponse()
                    .setBody(
                        """{"status":"success","value":{"_id":"cashier","name":"Cashier","storeId":"store","role":{"_id":"role","name":"Cashier","scopeLevel":"branch","permissions":["orders.create"]}}}"""
                    )
            )
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, MemorySessionStorage())
            auth.signIn("cashier@example.com", "password")
            assertEquals("cashier", auth.state.value.user?.id)
            assertTrue(auth.hasPermission("orders.create"))
            assertFalse(auth.hasPermission("discounts.approve"))
            assertEquals("access", http.token)
            assertTrue(server.takeRequest().body.readUtf8().contains("auth:signIn"))
            assertEquals("Bearer access", server.takeRequest().getHeader("Authorization"))
        }
    }
}

private class SuspendingSessionStorage(initial: SessionTokens?) : SessionStorage {
    var value = initial

    override suspend fun read(): SessionTokens? {
        yield()
        return value
    }

    override suspend fun write(tokens: SessionTokens?) {
        yield()
        value = tokens
    }
}
