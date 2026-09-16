package com.pmgt.pos.closing

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test

class HttpClosingRepositoryTest {
    @Test
    fun `business date schedule and immutable report values come only from typed server responses`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(success("\"2026-09-15\""))
            server.enqueue(success(storeJson))
            server.enqueue(success(reportJson))
            server.start()
            val repository = HttpClosingRepository(ConvexHttp(server.url("/").toString()))

            assertEquals("2026-09-15", repository.currentBusinessDate("store"))
            assertEquals(ScheduleSlot("18:00", "03:00"), repository.getStore("store").schedule?.tuesday)
            val report = repository.getReport("store", "2026-09-15")!!
            assertEquals(2, report.voidCount)
            assertEquals(12, report.transactionCount)
            assertEquals(1234.56, report.grossSales, 0.0)
            assertEquals(1200.885, report.netSales, 0.0)

            assertRequest(server, "reports:getCurrentBusinessDate", "store", null)
            assertRequest(server, "stores:get", "store", null)
            assertRequest(server, "reports:getDailyReport", "store", "2026-09-15")
        }
    }

    @Test
    fun `integral lexical doubles are accepted for counts but fractional counts are rejected`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(success(reportJson.replace("\"voidCount\":2.0", "\"voidCount\":1.5")))
            server.start()
            val failure = runCatching {
                HttpClosingRepository(ConvexHttp(server.url("/").toString())).getReport("store", "2026-09-15")
            }.exceptionOrNull()
            assertNotNull(failure)
            assertTrue(failure!!.message.orEmpty().contains("voidCount"))
        }
    }

    @Test
    fun `attention preserves pending failed and divergent evidence from exact closing endpoints`() = runTest {
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val path = Json.parseToJsonElement(request.body.readUtf8()).jsonObject["path"]!!.jsonPrimitive.content
                    return when (path) {
                        "closing:getPendingTotalsReconciliations" -> success(
                            """[{"jobId":"job","orderId":"order","mutationId":"mutation","status":"failed","blockedReason":"scheduler"}]"""
                        )
                        "closing:getTotalsDivergences" -> success(
                            """[{"orderId":"order","deviceTotals":{"netSales":100.0},"reconciledTotals":{"netSales":90.0},"fields":["netSales"]}]"""
                        )
                        else -> MockResponse().setResponseCode(500)
                    }
                }
            }
            server.start()
            val attention = HttpClosingRepository(ConvexHttp(server.url("/").toString()))
                .getAttention("store", "2026-09-15")

            assertEquals(ReconciliationStatus.Failed, attention.jobs.single().status)
            assertEquals("scheduler", attention.jobs.single().blockedReason)
            assertEquals(100.0, attention.divergences.single().deviceTotals.getValue("netSales"), 0.0)
            assertEquals(listOf("netSales"), attention.divergences.single().fields)
        }
    }

    @Test
    fun `generate close and retry use exact existing mutation paths and omit full-day optionals`() = runTest {
        MockWebServer().use { server ->
            repeat(4) { server.enqueue(success("null")) }
            server.start()
            val repository = HttpClosingRepository(ConvexHttp(server.url("/").toString()))
            repository.generate("store", "2026-09-15", null, null)
            repository.generate("store", "2026-09-15", "18:00", "03:00")
            repository.close("store", "2026-09-15")
            repository.retry("job")

            val full = request(server)
            assertEquals("reports:generateDailyReport", full.first)
            assertFalse(full.second.containsKey("startTime"))
            assertFalse(full.second.containsKey("endTime"))
            val custom = request(server)
            assertEquals("18:00", custom.second["startTime"]!!.jsonPrimitive.content)
            assertEquals("03:00", custom.second["endTime"]!!.jsonPrimitive.content)
            assertEquals("closing:logDayClosing", request(server).first)
            val retry = request(server)
            assertEquals("closing:retryTotalsReconciliation", retry.first)
            assertEquals("job", retry.second["jobId"]!!.jsonPrimitive.content)
        }
    }

    private fun assertRequest(server: MockWebServer, path: String, storeId: String, date: String?) {
        val (actualPath, args) = request(server)
        assertEquals(path, actualPath)
        assertEquals(storeId, args["storeId"]!!.jsonPrimitive.content)
        if (date == null) assertFalse(args.containsKey("reportDate"))
        else assertEquals(date, args["reportDate"]!!.jsonPrimitive.content)
    }

    private fun request(server: MockWebServer): Pair<String, JsonObject> {
        val body = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        return body["path"]!!.jsonPrimitive.content to body["args"]!!.jsonObject
    }
}

private fun success(value: String) = MockResponse().setBody("""{"status":"success","value":$value}""")

private val storeJson =
    """{
      "_id":"store","name":"Synthetic Eatery","address1":"123 Fixture Road","address2":null,
      "tin":"000-000-000-000","schedule":{
        "monday":{"open":"06:00","close":"22:00"},"tuesday":{"open":"18:00","close":"03:00"},
        "wednesday":{"open":"06:00","close":"22:00"},"thursday":{"open":"06:00","close":"22:00"},
        "friday":{"open":"06:00","close":"22:00"},"saturday":{"open":"06:00","close":"22:00"},
        "sunday":{"open":"06:00","close":"22:00"}
      }
    }"""

private val reportJson =
    """{
      "_id":"report","reportDate":"2026-09-15","startTime":"18:00","endTime":"03:00",
      "grossSales":1234.56,"vatableSales":1000.0,"vatAmount":120.0,"vatExemptSales":100.0,
      "nonVatSales":14.56,"netSales":1200.885,"seniorDiscounts":1.005,"pwdDiscounts":2.675,
      "promoDiscounts":30.0,"manualDiscounts":0.0,"totalDiscounts":33.675,
      "voidCount":2.0,"voidAmount":40.5,"cashTotal":700.5,"cardEwalletTotal":500.385,
      "transactionCount":12.0,"averageTicket":100.07375,"generatedAt":1789545845000.0,
      "generatedByName":"Manager One","isPrinted":false,"printedAt":null
    }"""
