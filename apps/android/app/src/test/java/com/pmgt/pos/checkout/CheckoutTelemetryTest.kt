package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.CheckoutRoute
import com.pmgt.pos.telemetry.RecordingTelemetry
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CheckoutTelemetryTest {
    @get:Rule val telemetry = RecordingTelemetry()

    private val owner = CheckoutDatabaseContract.owner

    private fun database(driver: CheckoutFaultDriver) = PosDatabase(driver)

    private fun faultDriver() =
        CheckoutFaultDriver(JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) })

    /** A Convex stand-in that lists one manager and accepts any PIN. */
    private fun approvingServer() =
        MockWebServer().apply {
            dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val body = request.body.readUtf8()
                        return MockResponse()
                            .setBody(
                                if ("listManagers" in body)
                                    """{"status":"success","value":[{"_id":"manager","name":"Manager","roleName":"Supervisor"}]}"""
                                else """{"status":"success","value":{"success":true}}"""
                            )
                    }
                }
            start()
        }

    private suspend fun approve(approval: ManagerApprovalSession) {
        approval.load()
        approval.select("manager")
        approval.pin("123456")
    }

    private suspend fun idle(busy: () -> Boolean) = withTimeout(5000) { while (busy()) delay(10) }

    private suspend fun approvedVoid(session: CorrectionSession) {
        session.open("void")
        idle { session.state.value.busy }
        session.change { it.copy(reason = "Wrong order") }
        session.requestApproval()
        approve(session.approval!!)
        session.approve()
        idle { session.state.value.alert == null }
    }

    @Test
    fun `a settled order is logged once with its payment methods and never an amount`() = runBlocking {
        database(faultDriver()).use { db ->
            val id = CheckoutDatabaseContract.seed(db)
            val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
            val session =
                CheckoutSession(owner, CheckoutRoute(id, "dine_in"), repo, ConvexHttp("http://127.0.0.1"), "Cashier", this) { true }
            session.addLine(280.0)
            session.line("1") { it.copy(cashReceived = "100") }
            session.line("2") { it.copy(amount = "180", cardPaymentType = "GCash", cardReferenceNumber = "ref") }

            session.complete(280.0)
            idle { session.state.value.busy }

            assertNotNull(session.state.value.completed)
            assertEquals(
                listOf(
                    RecordingTelemetry.Event(
                        "order_settled",
                        mapOf(
                            "payment_method" to "card_ewallet+cash",
                            "order_type" to "dine_in",
                            "order_category" to "dine_in",
                        ),
                    )
                ),
                telemetry.events,
            )
            assertEquals(emptyList<String>(), telemetry.operations())
            session.dispose()
        }
    }

    @Test
    fun `a failed settlement is reported as a non-fatal and is not logged as settled`() = runBlocking {
        val driver = faultDriver()
        database(driver).use { db ->
            val id = CheckoutDatabaseContract.seed(db)
            val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
            val session =
                CheckoutSession(owner, CheckoutRoute(id, "dine_in"), repo, ConvexHttp("http://127.0.0.1"), "Cashier", this) { true }
            session.line("1") { it.copy(cashReceived = "300") }
            driver.failTable = "order_payments"

            session.complete(280.0)
            idle { session.state.value.busy }

            assertEquals("Error", session.state.value.alert?.title)
            assertEquals(listOf("checkout.settle"), telemetry.operations())
            assertEquals(emptyList<String>(), telemetry.eventNames())
            session.dispose()
        }
    }

    @Test
    fun `a tender the cashier must correct is shown but never reported with its amount`() = runBlocking {
        database(faultDriver()).use { db ->
            val id = CheckoutDatabaseContract.seed(db)
            val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
            val session =
                CheckoutSession(owner, CheckoutRoute(id, "dine_in"), repo, ConvexHttp("http://127.0.0.1"), "Cashier", this) { true }
            session.line("1") { it.copy(cashReceived = "100") }

            // The total changed after the screen computed it, so only the stored order rejects it.
            session.complete(100.0)
            idle { session.state.value.busy }

            assertTrue(session.state.value.alert!!.message.startsWith("Payment is short by"))
            assertEquals(emptyList<String>(), telemetry.operations())
            session.dispose()
        }
    }

    @Test
    fun `an approved discount is logged with its type`() = runBlocking {
        approvingServer().use { server ->
            database(faultDriver()).use { db ->
                val id = CheckoutDatabaseContract.seed(db)
                val item = db.select("order_items").single().string("id")!!
                val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                val session =
                    CheckoutSession(owner, CheckoutRoute(id, "dine_in"), repo, ConvexHttp(server.url("/").toString()), "Cashier", this) { true }
                session.openDiscount()
                session.discount { DiscountInput("pwd", listOf(item), "Customer", "ID") }
                session.requestApply()
                approve(session.approval!!)

                session.approve()
                idle { session.state.value.alert == null }

                assertEquals("Success", session.state.value.alert?.title)
                assertEquals(
                    listOf(RecordingTelemetry.Event("discount_applied", mapOf("discount_type" to "pwd"))),
                    telemetry.events,
                )
                session.dispose()
            }
        }
    }

    @Test
    fun `an approved void is logged and a failed one is reported`() = runBlocking {
        approvingServer().use { server ->
            val driver = faultDriver()
            database(driver).use { db ->
                val id = CorrectionDatabaseContract.seed(db)
                val repo = CorrectionDatabaseContract.repo(db)
                val session =
                    CorrectionSession(owner, id, repo, ConvexHttp(server.url("/").toString()), this) { true }
                driver.failTable = "order_voids"

                approvedVoid(session)

                assertEquals("Error", session.state.value.alert?.title)
                assertEquals(listOf("correction.void"), telemetry.operations())
                assertEquals(emptyList<String>(), telemetry.eventNames())
                session.dispose()
            }
        }
        approvingServer().use { server ->
            database(faultDriver()).use { db ->
                val id = CorrectionDatabaseContract.seed(db)
                val session =
                    CorrectionSession(owner, id, CorrectionDatabaseContract.repo(db), ConvexHttp(server.url("/").toString()), this) { true }

                approvedVoid(session)

                assertEquals("Order has been voided", session.state.value.alert?.message)
                assertEquals(
                    listOf(RecordingTelemetry.Event("order_voided", mapOf("source" to "correction"))),
                    telemetry.events,
                )
                session.dispose()
            }
        }
    }
}
