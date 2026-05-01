import { useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { syncManager } from "./SyncManager";
import type { SyncState, SyncStatus } from "./types";

const COLORS: Record<SyncStatus, { bg: string; fg: string }> = {
  idle: { bg: "#DCFCE7", fg: "#15803D" }, // green-100 / green-700
  syncing: { bg: "#FEF3C7", fg: "#92400E" }, // amber-100 / amber-800
  offline: { bg: "#FEE2E2", fg: "#991B1B" }, // red-100 / red-800
  error: { bg: "#FEE2E2", fg: "#991B1B" },
};

/** "modifier_options" → "Modifier Options" */
function humanizeTable(snake: string): string {
  return snake
    .split("_")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function formatStatus(state: SyncState): string {
  if (state.status === "syncing") {
    const p = state.progress;
    if (!p) return "Syncing…";
    if (p.phase === "push") return "Pushing changes…";
    if (p.currentTable) return `Syncing ${humanizeTable(p.currentTable)} · page ${p.pageIndex}`;
    return `Syncing… page ${p.pageIndex}`;
  }
  if (state.status === "offline") return "Offline";
  if (state.status === "error") return "Sync failed — tap to retry";
  // idle
  if (!state.lastPulledAt) return "Not synced";
  const ago = Date.now() - state.lastPulledAt;
  const dc = syncManager.getDeviceCode();
  const deviceSuffix = dc ? ` · Device ${dc}` : "";
  if (ago < 60_000) return `Synced${deviceSuffix}`;
  const minutes = Math.floor(ago / 60_000);
  if (minutes < 60) return `Synced ${minutes}m ago${deviceSuffix}`;
  const hours = Math.floor(minutes / 60);
  return `Synced ${hours}h ago${deviceSuffix}`;
}

/**
 * Renders the current sync state. Tapping it triggers an immediate sync
 * when offline or in error; otherwise it's a passive indicator.
 *
 * Mount this in the app header next to the user name.
 */
export function SyncStatusPill() {
  const [state, setState] = useState<SyncState>(syncManager.getState());

  useEffect(() => syncManager.subscribe(setState), []);

  const colors = COLORS[state.status];
  const text = formatStatus(state);
  const accessibilityLabel =
    state.status === "error" && state.lastError ? `${text}: ${state.lastError}` : text;

  const onPress = () => {
    if (state.status === "error" || state.status === "offline") {
      void syncManager.syncNow();
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View
        style={{
          backgroundColor: colors.bg,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: colors.fg, fontSize: 12, fontWeight: "600" }}>{text}</Text>
      </View>
    </TouchableOpacity>
  );
}
