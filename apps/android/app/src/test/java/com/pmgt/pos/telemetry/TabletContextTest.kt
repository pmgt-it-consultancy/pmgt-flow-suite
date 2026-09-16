package com.pmgt.pos.telemetry

import com.pmgt.pos.db.AdoptionIntegrity
import com.pmgt.pos.db.AdoptionState
import com.pmgt.pos.sync.TabletStartupState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class TabletContextTest {
    @get:Rule val telemetry = RecordingTelemetry()

    @Test
    fun `an adopted tablet tags reports with its device and store, and logout clears the store`() {
        reportTabletContext(
            TabletStartupState("user-1", "store-1", AdoptionState.Ready(AdoptionIntegrity(emptyMap(), emptyMap(), emptyMap(), emptyList()))),
            deviceId = "device-1",
        )

        assertEquals("device-1", telemetry.deviceId)
        assertEquals("device-1", telemetry.keys["device_id"])
        assertEquals("store-1", telemetry.keys["store_id"])
        assertEquals("ready", telemetry.keys["adoption"])

        reportTabletContext(TabletStartupState(), deviceId = "device-1")

        assertEquals("", telemetry.keys["store_id"])
        assertEquals("", telemetry.keys["adoption"])
        assertEquals("device-1", telemetry.deviceId)
    }

    @Test
    fun `a blocked adoption is visible on the reports that follow it`() {
        reportTabletContext(
            TabletStartupState("user-1", "store-1", AdoptionState.Blocked("identity unreadable")),
            deviceId = null,
        )

        assertEquals("blocked", telemetry.keys["adoption"])
        assertEquals(null, telemetry.deviceId)
    }

    @Test
    fun `no staff identity is ever used as context`() {
        reportTabletContext(
            TabletStartupState("user-1", "store-1", AdoptionState.PendingVerification(), verifying = true),
            deviceId = "device-1",
        )

        assertEquals("verifying", telemetry.keys["adoption"])
        assertTrue(telemetry.keys.values.none { it == "user-1" })
    }
}
