package com.pmgt.pos.checkout

import com.pmgt.pos.db.*
import com.pmgt.pos.sync.*
import com.pmgt.pos.transport.ConvexHttp
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*

object CorrectionSyncContract {
    suspend fun concurrentFirstPush(db: PosDatabase, driver: CheckoutFaultDriver) = coroutineScope {
        val order = CorrectionDatabaseContract.seed(db)
        db.acknowledge(db.pendingChanges(), emptySet())
        val owner = CorrectionDatabaseContract.owner
        val selected = CorrectionDatabaseContract.input(db, order)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val payloads = CopyOnWriteArrayList<JsonObject>()
        val server = MockWebServer()
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.path == "/sync/push")
                        payloads += Json.parseToJsonElement(request.body.readUtf8()).jsonObject
                    return MockResponse()
                        .setBody(
                            when (request.path) {
                                "/sync/registerDevice" -> """{"deviceCode":"01"}"""
                                "/sync/push" -> """{"success":true}"""
                                else ->
                                    """{"changes":{},"cursors":{},"complete":true,"timestamp":100}"""
                            }
                        )
                }
            }
        server.start()
        val syncScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val sync =
            SyncManager(
                db,
                ConvexHttp(server.url("/").toString()).apply { freshToken = { "synthetic" } },
                "device",
                syncScope,
                Dispatchers.IO,
                MutableStateFlow(true),
            )
        try {
            driver.afterModelWrite = {
                entered.countDown()
                check(release.await(5, TimeUnit.SECONDS))
            }
            val correction =
                async(Dispatchers.IO) {
                    CorrectionDatabaseContract.repo(db)
                        .correct(
                            owner,
                            order,
                            "concurrent",
                            selected,
                            CheckoutApproval(owner, order, "concurrent", "manager"),
                        )
                }
            assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
            sync.start("s")
            delay(100)
            assertTrue(
                "No partially corrected envelope may leave the transaction",
                payloads.isEmpty(),
            )
            release.countDown()
            val result = correction.await()
            withTimeout(8000) {
                while (payloads.isEmpty() || sync.state.value.lastPushedAt == null) delay(10)
            }
            val changes = payloads.first().getValue("changes").jsonObject
            fun rows(table: String): List<JsonObject> =
                changes.getValue(table).jsonObject.let { bucket ->
                    (bucket["created"]?.jsonArray.orEmpty() +
                            bucket["updated"]?.jsonArray.orEmpty())
                        .map { it.jsonObject }
                }
            val void = rows("orderVoids").single()
            assertEquals(result.refundAmount, void.getValue("amount").jsonPrimitive.double, 0.0)
            assertEquals(result.voidId, void.getValue("id").jsonPrimitive.content)
            val replacement =
                rows("orders").single {
                    it["id"]?.jsonPrimitive?.content == result.replacementOrderId
                }
            assertEquals("paid", replacement.getValue("status").jsonPrimitive.content)
            assertEquals(
                replacement.getValue("netSales").jsonPrimitive.double,
                rows("orderPayments").single().getValue("amount").jsonPrimitive.double,
                0.0,
            )
            assertEquals(
                "cash",
                rows("orderPayments").single().getValue("paymentMethod").jsonPrimitive.content,
            )
            assertEquals(
                "refund_order",
                rows("auditLogs").single().getValue("action").jsonPrimitive.content,
            )
        } finally {
            release.countDown()
            driver.afterModelWrite = null
            sync.stop()
            syncScope.cancel()
            server.shutdown()
        }
    }
}
