# Printer Connection Polling & Error Notifications

## Problem

1. Turning off a connected Bluetooth printer doesn't update the app's connection status until restart
2. The Reconnect button in the StatusDropdown doesn't show errors on failure
3. PrinterSettingsScreen has no Reconnect button for configured printers

## Design

### 1. Connection Polling

**New hook: `usePrinterConnectionPolling`** — runs in Navigation component alongside existing `initialize()`.

- Polls every **15 seconds** via `setInterval`
- For each configured printer, attempts `BluetoothManager.connect(address)` (Bluetooth Classic has no passive "is connected" check)
  - Success → status stays/becomes `"connected"`
  - Failure → status becomes `"disconnected"`, triggers auto-reconnect
- Only polls when `isInitialized` is true
- Cleans up interval on unmount

**Auto-reconnect with limit:**
- Tracks `reconnectAttempts: Record<string, number>` in Zustand store
- On detected disconnection: auto-retry up to **3 times** with **2 second** spacing
- After 3 failures: stop retrying, set status to `"failed"`
- Retry counter resets when:
  - User manually reconnects successfully
  - Polling detects printer is back online
  - App re-initializes

No new dependencies — uses existing `BluetoothManager.connect()`.

### 2. Extended Connection Status

Change `connectionStatus: Record<string, boolean>` to:

```typescript
connectionStatus: Record<string, "connected" | "disconnected" | "reconnecting" | "failed">
```

**Status display mapping:**

| State | Dot Color | Label |
|-------|-----------|-------|
| `connected` | Green `#22C55E` | "Connected" |
| `disconnected` | Gray `#9CA3AF` | "Disconnected" |
| `reconnecting` | Amber `#F59E0B` | "Reconnecting..." |
| `failed` | Red `#EF4444` | "Connection failed" |

### 3. Notification Behavior

- **Polling-detected disconnection** → Inline status update only (no popup)
- **User-initiated reconnect failure** → `Alert.alert` with "Retry" and "Dismiss" options
- **User-initiated reconnect success** → Status updates to "connected", no popup

### 4. Reconnect Buttons

**PrinterSettingsScreen** — Add "Reconnect" button to each printer card:
- Visible only when status is `"disconnected"` or `"failed"`
- Primary outline style with blue color
- On press: attempts connection, shows Alert on failure

**StatusDropdown** — Existing buttons updated:
- Disabled with "Reconnecting..." label when status is `"reconnecting"`
- Red text when status is `"failed"`
- On press: resets retry counter, attempts reconnection, Alert on failure

**Reconnect flow (both locations):**
1. Set status to `"reconnecting"`
2. Reset retry counter to 0
3. Attempt `connectPrinter(address)`
4. Success → set `"connected"`
5. Failure → Alert with "Retry" / "Dismiss" options, set `"failed"` if dismissed

## Files to Modify

| File | Changes |
|------|---------|
| `apps/native/src/features/settings/stores/usePrinterStore.ts` | Change `connectionStatus` type, add `reconnectAttempts`, add polling-related actions |
| `apps/native/src/features/settings/hooks/usePrinterConnectionPolling.ts` | **New** — polling hook with auto-reconnect logic |
| `apps/native/src/navigation/Navigation.tsx` | Mount polling hook |
| `apps/native/src/features/shared/hooks/useSystemStatus.ts` | Update `reconnectPrinter` to surface errors, adapt to new status type |
| `apps/native/src/features/shared/components/StatusDropdown.tsx` | Handle new states, disable during reconnecting, show errors |
| `apps/native/src/features/shared/components/SystemStatusBar.tsx` | Update dot color logic for new states |
| `apps/native/src/features/settings/screens/PrinterSettingsScreen.tsx` | Add Reconnect button, update status display for new states |
