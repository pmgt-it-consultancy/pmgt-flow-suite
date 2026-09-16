package com.pmgt.pos.checkout

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test

class ManagerApprovalTest {
    @Test
    fun actualAuthenticatedEndpointsRetainInvalidPinAndRejectStaleCompletion() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val http = ConvexHttp(server.url("/").toString()).apply { token = "synthetic-token" }
            var current = true
            fun session() =
                ManagerApprovalSession(
                    http,
                    CheckoutOwner("cashier", "store"),
                    "order",
                    "action",
                    { current },
                )
            val approval = session()
            server.enqueue(
                MockResponse()
                    .setBody(
                        """{"status":"success","value":[{"_id":"manager","name":"Manager","roleName":"Supervisor"}]}"""
                    )
            )
            approval.load()
            assertEquals("Manager", approval.state.value.managers?.singleOrNull()?.name)
            val request = server.takeRequest()
            assertEquals("Bearer synthetic-token", request.getHeader("Authorization"))
            assertEquals(
                "helpers/usersHelpers:listManagers",
                Json.parseToJsonElement(request.body.readUtf8())
                    .jsonObject
                    .getValue("path")
                    .jsonPrimitive
                    .content,
            )
            approval.select("manager")
            approval.pin("123456")
            repeat(2) {
                server.enqueue(
                    MockResponse()
                        .setBody(
                            """{"status":"success","value":{"success":false,"error":"Wrong PIN"}}"""
                        )
                )
                assertNull(approval.verify())
                assertEquals("123456", approval.state.value.pin)
                assertEquals("Invalid PIN", approval.state.value.error?.title)
                val call = server.takeRequest()
                val body = Json.parseToJsonElement(call.body.readUtf8()).jsonObject
                assertEquals("users:verifyPin", body.getValue("path").jsonPrimitive.content)
                assertEquals(
                    "manager",
                    body.getValue("args").jsonObject.getValue("userId").jsonPrimitive.content,
                )
                assertEquals(
                    "123456",
                    body.getValue("args").jsonObject.getValue("pin").jsonPrimitive.content,
                )
                approval.dismissError()
            }
            server.enqueue(MockResponse().setResponseCode(503))
            assertNull(approval.verify())
            server.takeRequest()
            assertEquals("Failed to verify PIN", approval.state.value.error?.message)
            assertEquals("123456", approval.state.value.pin)
            server.enqueue(
                MockResponse()
                    .setBody("""{"status":"success","value":{"success":true}}""")
                    .setBodyDelay(100, java.util.concurrent.TimeUnit.MILLISECONDS)
            )
            val pending = async { approval.verify() }
            withContext(Dispatchers.IO) { server.takeRequest() }
            assertNull(approval.verify()) // IME and button cannot overlap
            approval.close()
            assertNull(pending.await())
            assertEquals("", approval.state.value.pin)
            current = false
            assertNull(approval.verify())
        }
    }
}
