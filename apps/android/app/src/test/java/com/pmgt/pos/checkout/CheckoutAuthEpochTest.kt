package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.auth.*
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.CheckoutRoute
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test

class CheckoutAuthEpochTest {
    @Test
    fun sameCashierReauthenticationInvalidatesApprovalButReloadDoesNot() = runBlocking {
        MockWebServer().use { server ->
            fun success(value: String, delay: Long = 0) =
                server.enqueue(
                    MockResponse()
                        .setBody("""{"status":"success","value":$value}""")
                        .setBodyDelay(delay, java.util.concurrent.TimeUnit.MILLISECONDS)
                )
            val http = ConvexHttp(server.url("/").toString())
            val auth = AuthRepository(http, MemorySessionStorage())
            val user = """{"_id":"cashier","name":"Cashier","storeId":"s","role":null}"""
            fun signinResponses() {
                success("""{"tokens":{"token":"access","refreshToken":"refresh"}}""")
                success(user)
            }
            signinResponses()
            auth.signIn("synthetic", "synthetic")
            val epoch = auth.sessionEpoch.value
            assertTrue("New session must publish its epoch", epoch > 0)
            success(user)
            auth.reloadUser()
            assertEquals(epoch, auth.sessionEpoch.value)
            success("""{"tokens":{"token":"refreshed","refreshToken":"refresh-next"}}""")
            assertEquals("refreshed", auth.freshAccessToken(forceRefresh = true))
            assertEquals(epoch, auth.sessionEpoch.value)
            val session =
                ManagerApprovalSession(http, CheckoutOwner("cashier", "s"), "order", "action") {
                    auth.sessionEpoch.value == epoch
                }
            success("""[{"_id":"manager","name":"Manager","roleName":"Supervisor"}]""")
            session.load()
            session.select("manager")
            session.pin("1234")
            success("""{"success":true}""")
            val approved = session.verify()!!
            session.select("manager")
            session.pin("1234")
            repeat(6) { server.takeRequest() }
            success("""{"success":true}""", 400)
            val pending = async { session.verify() }
            withContext(Dispatchers.IO) { server.takeRequest() }
            success("null")
            auth.signOut()
            signinResponses()
            auth.signIn("synthetic", "synthetic")
            assertEquals("cashier", auth.state.value.user!!.id)
            assertNotEquals(epoch, auth.sessionEpoch.value)
            assertNull(pending.await())
            PosDatabase(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
                .use { db ->
                    val id = CheckoutDatabaseContract.seed(db)
                    val owner = CheckoutDatabaseContract.owner
                    val stale =
                        LocalCheckoutRepository(
                            db,
                            Dispatchers.Unconfined,
                            { owner.takeIf { auth.sessionEpoch.value == epoch } },
                        )
                    assertTrue(
                        runCatching {
                                stale.settle(
                                    owner,
                                    CheckoutRoute(id, "dine_in"),
                                    listOf(PaymentLine(cashReceived = "300")),
                                    "Cashier",
                                )
                            }
                            .isFailure
                    )
                    assertTrue(db.select("order_payments").isEmpty())
                    // Same identity values do not make a capability from the prior epoch current.
                    assertFalse(approved.isCurrent())
                }
        }
    }
}
