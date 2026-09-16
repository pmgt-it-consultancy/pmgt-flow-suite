package com.pmgt.pos.browse

import com.pmgt.pos.sync.SyncPhase
import com.pmgt.pos.sync.SyncState
import com.pmgt.pos.sync.SyncStatus

fun browseSyncLabel(
    state: SyncState?,
    deviceCode: String,
    now: Long = System.currentTimeMillis(),
): String {
    if (state == null) return "Not synced"
    return when (state.status) {
        SyncStatus.Syncing ->
            state.progress?.let { progress ->
                if (progress.phase == SyncPhase.Push) "Pushing changes…"
                else
                    progress.currentTable?.let { table ->
                        "Syncing ${table.split('_').joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }} · page ${progress.pageIndex}"
                    } ?: "Syncing… page ${progress.pageIndex}"
            } ?: "Syncing…"
        SyncStatus.Offline -> "Offline"
        SyncStatus.Error -> "Sync failed — tap to retry"
        SyncStatus.Idle -> {
            val last = state.lastPulledAt?.takeIf { it != 0L } ?: return "Not synced"
            val minutes = (now - last) / 60_000
            val suffix = if (deviceCode.isEmpty()) "" else " · Device $deviceCode"
            (if (minutes < 1) "Synced"
            else if (minutes < 60) "Synced ${minutes}m ago" else "Synced ${minutes / 60}h ago") +
                suffix
        }
    }
}
