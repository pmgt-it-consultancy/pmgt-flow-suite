package com.pmgt.pos.auth

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class AuthWorkflowTest {
    private fun MockWebServer.success(value: String) = enqueue(MockResponse().setBody("""{"status":"success","value":$value}"""))

    @Test fun `server revoked session returns to login`() = runTest {
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

    @Test fun `delayed reload cannot restore a signed out session`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage().apply { write(SessionTokens("access", "refresh")) }
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            server.success("""{"_id":"cashier","role":null}"""); auth.restore()
            server.enqueue(MockResponse().setBodyDelay(500, java.util.concurrent.TimeUnit.MILLISECONDS).setBody("""{"status":"success","value":{"_id":"cashier","role":null}}"""))
            server.success("null")
            val reload = async { runCatching { auth.reloadUser() } }
            delay(50); auth.signOut(); reload.await()
            assertFalse(auth.state.value.isAuthenticated)
            assertNull(storage.read())
        }
    }

    @Test fun `delayed reload from session A cannot overwrite newly signed in session B`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage().apply { write(SessionTokens("access-a", "refresh-a")) }
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            server.success("""{"_id":"a","name":"A","role":null}"""); auth.restore()
            server.enqueue(MockResponse().setBodyDelay(500, java.util.concurrent.TimeUnit.MILLISECONDS).setBody("""{"status":"success","value":{"_id":"a","name":"A","role":null}}"""))
            server.success("""{"tokens":{"token":"access-b","refreshToken":"refresh-b"}}""")
            server.success("""{"_id":"b","name":"B","role":null}""")
            val stale = async { auth.reloadUser() }
            delay(50); auth.signIn("b@example.com", "password"); stale.await()
            assertEquals("b", auth.state.value.user?.id)
            assertEquals("access-b", storage.read()?.token)
        }
    }

    @Test fun `cancelled logout still revokes and durably clears session`() = runTest {
        MockWebServer().use { server ->
            val storage = SuspendingSessionStorage(SessionTokens("access", "refresh"))
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            server.success("""{"_id":"cashier","role":null}"""); auth.restore(); server.success("null")
            val logout = launch(start = CoroutineStart.UNDISPATCHED) { auth.signOut() }; logout.cancelAndJoin()
            assertFalse(auth.state.value.isAuthenticated)
            assertNull(storage.value)
            server.takeRequest()
            assertEquals("auth:signOut", Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject["path"]?.jsonPrimitive?.content)
        }
    }

    @Test fun `refresh rotates durable credentials and sign out clears them when server is down`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage()
            storage.write(SessionTokens("access", "refresh"))
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, storage)
            server.success("""{"_id":"cashier","role":null}""")
            auth.restore()
            server.success("""{"tokens":{"token":"rotated-access","refreshToken":"rotated-refresh"}}""")
            assertEquals("rotated-access", auth.freshAccessToken(forceRefresh = true))
            assertEquals("rotated-refresh", storage.read()?.refreshToken)
            server.takeRequest()
            val refresh = server.takeRequest()
            assertNull(refresh.getHeader("Authorization"))
            assertEquals("refresh", Json.parseToJsonElement(refresh.body.readUtf8()).jsonObject["args"]!!.jsonObject["refreshToken"]!!.jsonPrimitive.content)
            server.enqueue(MockResponse().setResponseCode(503))
            runCatching { auth.signOut() }
            assertFalse(auth.state.value.isAuthenticated)
            assertNull(storage.read())
            assertEquals("Bearer rotated-access", server.takeRequest().getHeader("Authorization"))
        }
    }

    @Test fun `offline cold start never grants cached identity or permissions`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage()
            storage.write(SessionTokens("access", "refresh"))
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            server.enqueue(MockResponse().setResponseCode(503))
            auth.restore()
            assertFalse(auth.state.value.isAuthenticated)
            assertFalse(auth.hasPermission("orders.create"))
        }
    }

    @Test fun `invalid credentials produce RN friendly error`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(560).setBody("""{"status":"error","errorMessage":"InvalidSecret"}"""))
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), MemorySessionStorage())
            runCatching { auth.signIn("cashier@example.com", "wrong") }
            assertEquals("Invalid email or password.", auth.state.value.error)
            assertFalse(auth.state.value.isAuthenticated)
        }
    }

    @Test fun `server role updates remove permissions from an open session`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage()
            storage.write(SessionTokens("access", "refresh"))
            val auth = AuthRepository(ConvexHttp(server.url("/").toString()), storage)
            server.success("""{"_id":"cashier","role":{"_id":"role","name":"Manager","scopeLevel":"branch","permissions":["discounts.approve"]}}""")
            auth.restore()
            assertTrue(auth.hasPermission("discounts.approve"))
            server.success("""{"_id":"cashier","role":null}""")
            auth.reloadUser()
            assertFalse(auth.hasPermission("discounts.approve"))
        }
    }

    @Test fun `expired refresh credentials clear session even for Convex action HTTP error`() = runTest {
        MockWebServer().use { server ->
            val storage = MemorySessionStorage()
            storage.write(SessionTokens("access", "refresh"))
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, storage)
            server.success("""{"_id":"cashier","role":null}""")
            auth.restore()
            server.enqueue(MockResponse().setResponseCode(560).setBody("""{"status":"error","errorMessage":"Invalid refresh token"}"""))
            runCatching { auth.freshAccessToken(forceRefresh = true) }
            assertFalse(auth.state.value.isAuthenticated)
            assertNull(http.token)
            assertNull(storage.read())
        }
    }
    @Test fun `cashier signs in and receives only server granted permissions`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"status":"success","value":{"tokens":{"token":"access","refreshToken":"refresh"}}}"""))
            server.enqueue(MockResponse().setBody("""{"status":"success","value":{"_id":"cashier","name":"Cashier","storeId":"store","role":{"_id":"role","name":"Cashier","scopeLevel":"branch","permissions":["orders.create"]}}}"""))
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
    override suspend fun read(): SessionTokens? { yield(); return value }
    override suspend fun write(tokens: SessionTokens?) { yield(); value = tokens }
}
