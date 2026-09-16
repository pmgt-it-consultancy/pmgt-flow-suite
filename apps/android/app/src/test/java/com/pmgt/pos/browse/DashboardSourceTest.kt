package com.pmgt.pos.browse

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test

class DashboardSourceTest {
    @Test
    fun malformedDashboardCountsAreRejectedWithoutTruncation() = runBlocking {
        MockWebServer().use { server ->
            for (encoded in listOf("1.5", "\"1\"", "2147483648")) {
                server.enqueue(
                    MockResponse()
                        .setBody(
                            """{"status":"success","value":{"totalOrdersToday":$encoded,"todayRevenue":0.0}}"""
                        )
                )
            }
            server.start()
            val source = DashboardSource(ConvexHttp(server.url("/").toString()))

            repeat(3) {
                val result = withTimeoutOrNull(500) { source.observe("store").first() }
                assertNull(result)
            }
        }
    }

    @Test
    fun integralConvexDoubleCountIsAcceptedWithoutRounding() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setBody(
                        """{"status":"success","value":{"totalOrdersToday":0.0,"todayRevenue":0.0}}"""
                    )
            )
            server.start()

            val result =
                withTimeoutOrNull(5_000) {
                    DashboardSource(ConvexHttp(server.url("/").toString()))
                        .observe("store")
                        .first()
                }

            assertEquals(DashboardSummary(0, 0.0), result)
        }
    }

    @Test
    fun summaryComesOnlyFromServerAndRefreshesAfterSync() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setBody(
                        """{"status":"success","value":{"totalOrdersToday":999,"todayRevenue":123456}}"""
                    )
            )
            server.enqueue(
                MockResponse()
                    .setBody(
                        """{"status":"success","value":{"totalOrdersToday":1000,"todayRevenue":123999}}"""
                    )
            )
            server.start()
            val http = ConvexHttp(server.url("/").toString())
            val signals = MutableSharedFlow<Long?>()
            val results = mutableListOf<DashboardSummary?>()
            val job = launch {
                DashboardSource(http).observe("store", signals).collect { results += it }
            }
            withTimeout(5_000) { while (results.size < 1) delay(10) }
            assertEquals(DashboardSummary(999, 123456.0), results.first())
            signals.emit(123)
            withTimeout(5_000) { while (results.size < 2) delay(10) }
            assertEquals(DashboardSummary(1000, 123999.0), results.last())
            val request = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
            assertEquals("orders:getDashboardSummary", request["path"]!!.jsonPrimitive.content)
            assertEquals("store", request["args"]!!.jsonObject["storeId"]!!.jsonPrimitive.content)
            job.cancelAndJoin()
        }
    }
}
