package com.pmgt.pos.transport

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ConvexHttpTest {
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
