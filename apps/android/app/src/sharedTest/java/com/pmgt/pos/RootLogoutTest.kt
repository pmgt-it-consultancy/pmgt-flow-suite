package com.pmgt.pos

import com.pmgt.pos.auth.*
import com.pmgt.pos.transport.ConvexHttp
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test

class RootLogoutTest {
    @Test
    fun cancellationKeepsCleanupAndReleasesGuardForNextSuccessfulSession() = runBlocking {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val revocations = AtomicInteger()
        val cleared = AtomicInteger()
        val uncaught = CopyOnWriteArrayList<Throwable>()
        val scope =
            CoroutineScope(
                SupervisorJob() +
                    Dispatchers.Unconfined +
                    CoroutineExceptionHandler { _, error -> uncaught.add(error) }
            )
        MockWebServer().use { server ->
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val path =
                            Json.parseToJsonElement(request.body.readUtf8())
                                .jsonObject["path"]!!
                                .jsonPrimitive
                                .content
                        val value =
                            when (path) {
                                "auth:signIn" ->
                                    """{"tokens":{"token":"test-access","refreshToken":"test-refresh"}}"""
                                "sessions:getCurrentUser" ->
                                    """{"_id":"user","name":"Cashier","storeId":"store","role":{"_id":"role","name":"Cashier","scopeLevel":"branch","permissions":[]}}"""
                                "auth:signOut" -> {
                                    if (revocations.incrementAndGet() == 1) {
                                        entered.countDown()
                                        check(release.await(10, TimeUnit.SECONDS))
                                    }
                                    "null"
                                }
                                else -> error("Unexpected endpoint $path")
                            }
                        return MockResponse().setBody("""{"status":"success","value":$value}""")
                    }
                }
            server.start()
            val http = ConvexHttp(server.url("/").toString())
            val storage = MemorySessionStorage()
            val auth = AuthRepository(http, storage)
            val logout = RootLogout(auth, scope)
            try {
                auth.signIn("cashier@example.com", "test-password")
                val cancelled = logout { cleared.incrementAndGet() }
                assertTrue(entered.await(5, TimeUnit.SECONDS))
                cancelled.cancel()
                assertFalse(
                    "Auth cleanup must finish before releasing the guard",
                    cancelled.isCompleted,
                )
                logout { cleared.incrementAndGet() }.join()
                assertEquals(1, cleared.get())
                release.countDown()
                cancelled.join()
                assertTrue(cancelled.isCancelled)
                assertNull(storage.read())
                assertNull(http.token)
                assertNull(auth.state.value.user)
                auth.signIn("cashier@example.com", "test-password")
                val success = logout { cleared.incrementAndGet() }
                success.join()
                assertFalse(success.isCancelled)
                assertEquals(2, cleared.get())
                assertEquals(2, revocations.get())
                assertNull(storage.read())
                assertNull(auth.state.value.user)
                assertTrue(uncaught.isEmpty())
            } finally {
                release.countDown()
                scope.cancel()
            }
        }
    }
}
