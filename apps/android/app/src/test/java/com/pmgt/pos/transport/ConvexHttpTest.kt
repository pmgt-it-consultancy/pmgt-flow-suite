package com.pmgt.pos.transport

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ConvexHttpTest {
    @Test fun aTransientServerFailureIsRetriedForAReadOnlyQuery() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setResponseCode(500)
                    .setBody("""{"message":"Temporary internal error"}"""),
            )
            server.enqueue(
                MockResponse().setBody("""{"status":"success","value":{"_id":"order-1"}}"""),
            )
            server.start()

            val result = ConvexHttp(server.url("/").toString()).query(
                "orders:get",
                buildJsonObject {},
            )

            assertEquals("order-1", result.jsonObject["_id"]!!.jsonPrimitive.content)
            assertEquals(2, server.requestCount)
        }
    }

    @Test fun aServerFailurePreservesTheConvexErrorMessage() = runBlocking {
        MockWebServer().use { server ->
            repeat(3) {
                server.enqueue(
                    MockResponse()
                        .setResponseCode(500)
                        .setBody(
                            """{"message":"Return value validation failed at .items[0].serviceType"}""",
                        ),
                )
            }
            server.start()

            val failure = assertThrows(ConvexException::class.java) {
                runBlocking {
                    ConvexHttp(server.url("/").toString()).query("orders:get", buildJsonObject {})
                }
            }

            assertTrue(failure.message, failure.message!!.contains(".items[0].serviceType"))
        }
    }

    /**
     * Stock OkHttp defaults give a request ten seconds, which a 1500-row pull page over tablet
     * Wi-Fi routinely exceeds. The budget is sized for that page, not for a small function call.
     */
    @Test fun theDefaultClientBudgetsForAFullPullPage() {
        val client = ConvexClients.default()
        assertEquals(15_000, client.connectTimeoutMillis)
        assertEquals(60_000, client.readTimeoutMillis)
        assertEquals(30_000, client.writeTimeoutMillis)
        assertEquals(180_000, client.callTimeoutMillis)
    }

    @Test fun aStalledResponseFailsAsATimeoutRatherThanHanging() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBodyDelay(1, TimeUnit.SECONDS).setBody("{}"))
            server.start()
            val http = ConvexHttp(
                server.url("/").toString(),
                OkHttpClient.Builder().readTimeout(100, TimeUnit.MILLISECONDS).build(),
            )
            try {
                http.query("orders:get", buildJsonObject {})
                fail("A stalled response must fail rather than hang")
            } catch (expected: IOException) {
                // Surfaces as an IOException, which is what the adoption retry path keys on.
            }
        }
    }
}
