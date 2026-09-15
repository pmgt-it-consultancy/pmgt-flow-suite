package com.pmgt.pos.auth

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class LockWorkflowTest {
    private class Storage : LockStorage {
        var value = LockSnapshot()
        override fun read() = value
        override fun write(snapshot: LockSnapshot) { value = snapshot }
    }
    private val cashier = SignedInUser("cashier", "Alex", null, "store", UserRole("role", "Cashier", emptySet(), "branch"))
    private fun MockWebServer.success(value: String) = enqueue(MockResponse().setBody("""{"status":"success","value":$value}"""))

    @Test fun `returning to login clears background bookkeeping before later sign in`() = runTest {
        MockWebServer().use { server ->
            var now = 1_000L
            val lock = LockState(Storage(), ConvexHttp(server.url("/").toString())) { now }
            lock.onBackground(); lock.onForeground(null)
            server.success("true"); server.success("0.001"); lock.configure(cashier)
            now += 61; server.success("null"); lock.tick(cashier)
            assertTrue(lock.state.value.snapshot.isLocked)
        }
    }

    @Test fun `lock survives restart but cooldown does not and only server PIN success unlocks`() = runTest {
        MockWebServer().use { server ->
            val storage = Storage()
            val http = ConvexHttp(server.url("/").toString())
            val lock = LockState(storage, http) { 1_000 }
            server.success("true"); server.success("5")
            lock.configure(cashier)
            lock.setRouteHistory(listOf(StoredLockRoute("OrderScreen")))
            server.success("null")
            lock.lock(cashier)
            repeat(5) { server.success("""{"success":false,"error":"Invalid PIN"}"""); lock.unlock("store", "0000") }
            assertEquals(30, lock.cooldownSeconds())
            val restarted = LockState(storage, http) { 1_000 }
            assertEquals(0, restarted.cooldownSeconds())
            assertTrue(restarted.state.value.snapshot.isLocked)
            assertEquals("Alex", restarted.state.value.snapshot.lockedUserName)
            server.enqueue(MockResponse().setResponseCode(503))
            runCatching { restarted.unlock("store", "1234") }
            assertTrue(restarted.state.value.snapshot.isLocked)
            assertEquals(0, restarted.state.value.failedAttempts)
            server.success("""{"success":true}""")
            assertNull(restarted.unlock("store", "1234"))
            assertFalse(restarted.state.value.snapshot.isLocked)
            assertEquals("OrderScreen", restarted.state.value.snapshot.routeHistory.single().name)
        }
    }

    @Test fun `checkout suppresses idle lock and warning starts thirty seconds before timeout`() = runTest {
        MockWebServer().use { server ->
            var now = 0L
            val lock = LockState(Storage(), ConvexHttp(server.url("/").toString())) { now }
            server.success("true"); server.success("1")
            lock.configure(cashier)
            now = 30_000
            lock.tick(cashier)
            assertTrue(lock.state.value.showIdleWarning)
            lock.setCurrentRoute("CheckoutScreen")
            now = 100_000
            lock.tick(cashier)
            assertFalse(lock.state.value.snapshot.isLocked)
            assertFalse(lock.state.value.showIdleWarning)
            lock.setCurrentRoute("HomeScreen")
            now = 160_000
            server.success("null")
            lock.tick(cashier)
            assertTrue(lock.state.value.snapshot.isLocked)
        }
    }
}
