package com.pmgt.pos.telemetry

import com.pmgt.pos.db.AdoptionState
import com.pmgt.pos.sync.TabletStartupState

/**
 * Tags every later crash and non-fatal with the tablet and store it came from. The device identity
 * names the tablet, never a person, so it stays across logout; store context clears with the session.
 */
fun reportTabletContext(state: TabletStartupState, deviceId: String?) {
    deviceId?.let {
        Telemetry.deviceId(it)
        Telemetry.key("device_id", it)
    }
    Telemetry.key("store_id", state.storeId)
    Telemetry.key(
        "adoption",
        when {
            state.storeId == null -> null
            state.verifying -> "verifying"
            else ->
                when (state.adoption) {
                    is AdoptionState.PendingVerification -> "pending_verification"
                    is AdoptionState.Ready -> "ready"
                    is AdoptionState.Blocked -> "blocked"
                }
        },
    )
}
