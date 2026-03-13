# Event-Driven Bluetooth Connection Detection

**Date:** 2026-03-13
**Status:** Approved

## Problem

The current Bluetooth printer connection status relies on 15-second polling (`usePrinterConnectionPolling.ts`). When a printer is turned off or disconnected, staff see a green "connected" indicator for up to 15 seconds — long enough to attempt a print that will fail.

## Solution

A custom Expo native module that listens for Android's system-level `ACTION_ACL_CONNECTED` and `ACTION_ACL_DISCONNECTED` broadcasts, providing sub-second disconnect detection without replacing the existing printing library.

## Architecture

### Components

**1. Native Module: `BluetoothConnectionModule` (Kotlin)**

Location: `apps/native/modules/bluetooth-connection/`

- Registers a `BroadcastReceiver` for `BluetoothDevice.ACTION_ACL_CONNECTED` and `BluetoothDevice.ACTION_ACL_DISCONNECTED`
- Emits events to JS via Expo's `EventEmitter`:
  - `onDeviceConnected` with `{ address: string }` (Bluetooth MAC address)
  - `onDeviceDisconnected` with `{ address: string }` (Bluetooth MAC address)
- `startListening()` registers the receiver, `stopListening()` unregisters it
- Uses **application context** (`reactContext.applicationContext`) for registration, so the receiver survives Activity recreation (e.g., configuration changes). Cleanup happens in `stopListening()` or when the module is destroyed.
- Event-driven detection only works while the app is in the foreground. When the app is backgrounded, the OS may not deliver broadcasts reliably. The 60s safety-net poll (which already triggers on AppState "active") covers the return-to-foreground case.

**Android permissions:** Requires `BLUETOOTH_CONNECT` on API 31+ (Android 12+). The app already declares this permission for printing — no new permissions needed.

**Package path:** `expo.modules.bluetoothconnection.BluetoothConnectionModule` (following Expo module conventions).

**2. JS Hook: `useBluetoothConnectionEvents`**

Location: `apps/native/src/features/settings/hooks/useBluetoothConnectionEvents.ts`

- Listens for native events from `BluetoothConnectionModule`
- On `onDeviceDisconnected`: matches the event's MAC address against stored printers by `printer.id` (which is the device's MAC address). If matched, calls the shared `autoReconnect()` function for that printer.
- On `onDeviceConnected`: matches by MAC address. If matched, updates status to `"connected"` and resets reconnect attempts.
- Calls `startListening()` on mount, `stopListening()` on unmount
- Multiple printers: each event carries a single `address`. Only the matching printer's status is updated. Reconnect attempts for different printers run concurrently without interference since each is keyed by address.

**3. Shared Auto-Reconnect: Exponential Backoff**

Currently, the `autoReconnect` function lives in `usePrinterConnectionPolling.ts` (lines 64-88). It will be **extracted into a shared utility**: `apps/native/src/features/settings/utils/autoReconnect.ts`.

Both `useBluetoothConnectionEvents` and `usePrinterConnectionPolling` will import and call this shared function.

Parameters (changed from current):
- Max attempts: 5 (up from 3, was `MAX_AUTO_RECONNECT` in polling hook)
- Delays: 1s, 2s, 4s, 8s, 16s (exponential backoff, was fixed 2s `AUTO_RECONNECT_DELAY_MS`)
- Total wait before "failed": ~31s
- **Race condition guard:** Before each attempt, the function checks the printer's current status in the store. If status has changed to `"connected"` (e.g., from a native `onDeviceConnected` event), the loop exits early without overwriting the status.
- Still skips entirely if printer is already in "reconnecting" state

Note: The store's `initialize()` function has its own separate retry logic (`MAX_RETRY_ATTEMPTS = 3`, `RETRY_DELAY_MS = 1000`) for initial connection at app startup. That logic is unchanged.

**4. Safety-Net Poll: 60s Interval**

Modified in: `apps/native/src/features/settings/hooks/usePrinterConnectionPolling.ts`

- Interval changed from 15s to 60s
- Same logic: tests connection on "connected" printers, triggers shared `autoReconnect()` on failure
- Inline `autoReconnect` function removed; imports from shared utility instead
- Acts as fallback for missed native events (e.g., app returning from background)

### Data Flow

```
Printer turned off
  -> Android fires ACTION_ACL_DISCONNECTED
  -> BroadcastReceiver catches it
  -> Emits "onDeviceDisconnected" { address: "AA:BB:CC:DD:EE:FF" }
  -> useBluetoothConnectionEvents receives event
  -> Matches address against stored printers by printer.id (MAC address)
  -> If match found: calls autoReconnect(address)
  -> autoReconnect sets status -> "reconnecting"
  -> Exponential backoff: attempt 1 (1s), 2 (2s), 3 (4s), 4 (8s), 5 (16s)
  -> Before each attempt: check if status is already "connected" (exit if so)
  -> If all fail: status -> "failed"
  -> If printer turns back on mid-retry:
      - Reconnect attempt succeeds -> status -> "connected", loop exits
      - OR native onDeviceConnected event fires -> status -> "connected"
        -> next backoff iteration sees "connected", exits loop
```

### File Structure

```
apps/native/modules/bluetooth-connection/
  expo-module.config.json
  index.ts                              # JS API + typed event emitter
  src/main/
    AndroidManifest.xml
    java/expo/modules/bluetoothconnection/
      BluetoothConnectionModule.kt

apps/native/src/features/settings/
  hooks/
    useBluetoothConnectionEvents.ts     # NEW - event listener hook
    usePrinterConnectionPolling.ts      # MODIFIED (15s -> 60s, use shared autoReconnect)
  utils/
    autoReconnect.ts                    # NEW - extracted shared reconnect logic
  stores/
    usePrinterStore.ts                  # UNCHANGED (store actions remain the same)
```

### Integration Point

`apps/native/src/navigation/Navigation.tsx` — add `useBluetoothConnectionEvents()` alongside the existing polling hook initialization.

## What Changes

| Component | Before | After |
|-----------|--------|-------|
| Primary detection | 15s polling | Native ACL events (sub-second) |
| Fallback detection | None | 60s safety-net poll |
| Reconnect strategy | 3 attempts, 0s/2s/2s delays (~4s) | 5 attempts, exponential backoff 1-16s (~31s) |
| Reconnect logic location | Inline in `usePrinterConnectionPolling.ts` | Shared `utils/autoReconnect.ts` |
| Reconnect race safety | None | Checks status before each attempt |

## What Stays the Same

- `@vardrz/react-native-bluetooth-escpos-printer` for all printing operations
- `PrinterSettingsScreen`, `ScanPrintersModal`, `EditPrinterModal` UI
- Printer storage in `expo-secure-store`
- Manual reconnect button behavior
- Connection status state machine: `connected | disconnected | reconnecting | failed`
- Printer discovery (paired devices + BLE scan)
- Store's `initialize()` retry logic (separate from auto-reconnect)

## Scope Exclusions

- No Bluetooth adapter state monitoring (on/off detection)
- No iOS support (current printing library is Android-only)
- No changes to ESC/POS printing or formatting logic

## Risks

- **BroadcastReceiver in background**: When the app is backgrounded, broadcast delivery is unreliable. Mitigated by the 60s safety-net poll which triggers on AppState "active" (return to foreground).
- **Duplicate events**: Both the native event and the safety-net poll could detect the same disconnection. The "reconnecting" status guard prevents duplicate reconnect attempts.
- **Race condition**: A native `onDeviceConnected` event could fire while a backoff loop is running. Mitigated by checking current status before each reconnect attempt.
- **Expo compatibility**: Custom native modules require `expo prebuild`. This project already uses Expo with native modules, so this is not a new constraint.
