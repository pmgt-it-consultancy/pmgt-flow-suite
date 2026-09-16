package com.pmgt.pos.telemetry

import com.pmgt.pos.transport.ConvexException
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TelemetryTest {
    @get:Rule val telemetry = RecordingTelemetry()

    @Test
    fun `an unreachable network is not a non-fatal but a server rejection is`() {
        Telemetry.nonFatal("sync.pull", UnknownHostException("no route"))
        Telemetry.nonFatal("sync.push", ConvexException(500, "Server request failed (500)"))

        assertEquals(listOf("sync.push"), telemetry.operations())
    }

    @Test
    fun `recomposing the same screen is one visit and returning to it is another`() {
        listOf("HomeScreen", "HomeScreen", "TablesScreen", "LockScreen", "TablesScreen").forEach(Telemetry::screen)

        assertEquals(
            listOf("HomeScreen", "TablesScreen", "LockScreen", "TablesScreen"),
            telemetry.events.map { assertEquals("screen_view", it.name); it.params.getValue("screen_name") },
        )
    }

    @Test
    fun `missing event parameters are left out rather than sent empty`() {
        Telemetry.event("order_settled", "order_type" to "takeout", "order_category" to null)

        assertEquals(mapOf("order_type" to "takeout"), telemetry.events.single().params)
    }
}
