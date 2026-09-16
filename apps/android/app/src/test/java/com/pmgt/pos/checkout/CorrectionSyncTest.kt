package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import com.pmgt.pos.sync.*
import com.pmgt.pos.transport.ConvexHttp
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test

class CorrectionSyncTest {
    @Test
    fun concurrentSyncFirstPublishesFinalCorrectionAmountAndEvidence() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { CorrectionSyncContract.concurrentFirstPush(it, driver) }
    }

    @Test
    fun originalSavedEnvelopeReplaysAfterReopenAndLateAckPreservesCorrection() = runBlocking {
        val file = File.createTempFile("correction-saved-push-", ".sqlite")
        val payloads = CopyOnWriteArrayList<String>()
        val server = MockWebServer()
        var reject = true
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.path == "/sync/push") {
                        payloads += request.body.readUtf8()
                        return if (reject) MockResponse().setResponseCode(503)
                        else MockResponse().setBody("""{"success":true}""")
                    }
                    return MockResponse()
                        .setBody(
                            if (request.path == "/sync/registerDevice") """{"deviceCode":"01"}"""
                            else """{"changes":{},"cursors":{},"complete":true,"timestamp":100}"""
                        )
                }
            }
        server.start()
        val http = ConvexHttp(server.url("/").toString()).apply { freshToken = { "synthetic" } }
        var order = ""
        try {
            PosDatabase(
                    JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                        LegacySqlSchema.create(it)
                    }
                )
                .use { db ->
                    order = CorrectionDatabaseContract.seed(db)
                    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                    val sync =
                        SyncManager(
                            db,
                            http,
                            "device",
                            scope,
                            Dispatchers.IO,
                            MutableStateFlow(true),
                        )
                    try {
                        sync.start("s")
                        withTimeout(8000) {
                            while (sync.state.value.status != SyncStatus.Error) delay(10)
                        }
                    } finally {
                        sync.stop()
                        scope.cancel()
                    }
                }
            reject = false
            PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                val owner = CorrectionDatabaseContract.owner
                val result =
                    CorrectionDatabaseContract.repo(
                            db,
                            { error("Synthetic postcommit scheduler failure") },
                        )
                        .correct(
                            owner,
                            order,
                            "refund",
                            CorrectionDatabaseContract.input(db, order),
                            CheckoutApproval(owner, order, "refund", "manager"),
                        )
                assertTrue(db.pendingCount() > 0)
                val before = payloads.size
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val sync =
                    SyncManager(db, http, "device", scope, Dispatchers.IO, MutableStateFlow(true))
                try {
                    sync.start("s")
                    withTimeout(8000) { while (sync.state.value.lastPulledAt == null) delay(10) }
                    assertEquals(payloads.first(), payloads[before])
                    assertEquals("voided", db.get("orders", order)!!.string("status"))
                    assertTrue(db.get("orders", order)!!.string("_status") != "synced")
                    assertTrue(sync.syncForDelivery() is SyncOutcome.Delivered)
                    val final = payloads.last()
                    assertTrue(final.contains(result.voidId))
                    assertTrue(final.contains("refund_order"))
                    assertTrue(db.select("order_voids").all { it.string("_status") == "synced" })
                    assertTrue(db.select("orders").all { it.string("_status") == "synced" })
                    assertEquals(
                        1,
                        db.pendingCount(),
                    ) // adopted device/day number counter is local metadata
                } finally {
                    sync.stop()
                    scope.cancel()
                }
            }
        } finally {
            server.shutdown()
            file.delete()
        }
    }
}
