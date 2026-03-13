# Event-Driven Bluetooth Connection Detection — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 15-second polling with Android ACL broadcast events for sub-second Bluetooth printer disconnect detection.

**Architecture:** A custom Expo native module (Kotlin) registers a BroadcastReceiver for `ACTION_ACL_CONNECTED`/`ACTION_ACL_DISCONNECTED`, emitting events to JS. A new React hook listens for these events and updates the Zustand printer store. The existing `autoReconnect` logic is extracted to a shared utility with exponential backoff. The polling interval becomes a 60s safety net.

**Tech Stack:** Expo Modules API (Kotlin), React Native, Zustand, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-13-bluetooth-connection-events-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/native/modules/bluetooth-connection/expo-module.config.json` | Expo autolinking config |
| Create | `apps/native/modules/bluetooth-connection/index.ts` | JS API: typed EventEmitter + start/stop |
| Create | `apps/native/modules/bluetooth-connection/src/main/AndroidManifest.xml` | Android manifest (empty, permissions inherited) |
| Create | `apps/native/modules/bluetooth-connection/src/main/java/expo/modules/bluetoothconnection/BluetoothConnectionModule.kt` | BroadcastReceiver for ACL events |
| Create | `apps/native/src/features/settings/utils/autoReconnect.ts` | Shared reconnect logic with exponential backoff |
| Create | `apps/native/src/features/settings/hooks/useBluetoothConnectionEvents.ts` | Hook: listen for native events, trigger reconnect |
| Modify | `apps/native/src/features/settings/hooks/usePrinterConnectionPolling.ts` | Change interval 15s→60s, use shared autoReconnect |
| Modify | `apps/native/src/navigation/Navigation.tsx` | Add `useBluetoothConnectionEvents()` call |

---

## Chunk 1: Native Module + JS API

### Task 1: Create the Expo native module scaffold

**Files:**
- Create: `apps/native/modules/bluetooth-connection/expo-module.config.json`
- Create: `apps/native/modules/bluetooth-connection/src/main/AndroidManifest.xml`

- [ ] **Step 1: Create expo-module.config.json**

```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["expo.modules.bluetoothconnection.BluetoothConnectionModule"]
  }
}
```

- [ ] **Step 2: Create AndroidManifest.xml**

The app already declares `BLUETOOTH_CONNECT` in `app.config.ts`. This manifest just needs the package declaration.

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="expo.modules.bluetoothconnection">
</manifest>
```

- [ ] **Step 3: Commit scaffold**

```bash
git add apps/native/modules/bluetooth-connection/expo-module.config.json \
       apps/native/modules/bluetooth-connection/src/main/AndroidManifest.xml
git commit -m "feat: scaffold Expo native module for Bluetooth connection events"
```

---

### Task 2: Implement the Kotlin BroadcastReceiver module

**Files:**
- Create: `apps/native/modules/bluetooth-connection/src/main/java/expo/modules/bluetoothconnection/BluetoothConnectionModule.kt`

**Context:** This module uses Expo Modules API (`Module`, `ModuleDefinition`, `Events`, `sendEvent`). It registers a `BroadcastReceiver` for `ACTION_ACL_CONNECTED` and `ACTION_ACL_DISCONNECTED` using `OnStartObserving`/`OnStopObserving` lifecycle callbacks. The receiver uses application context so it survives Activity recreation.

- [ ] **Step 1: Create BluetoothConnectionModule.kt**

```kotlin
package expo.modules.bluetoothconnection

import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BluetoothConnectionModule : Module() {
    private var receiver: BroadcastReceiver? = null

    override fun definition() = ModuleDefinition {
        Name("BluetoothConnection")

        Events("onDeviceConnected", "onDeviceDisconnected")

        OnStartObserving {
            registerReceiver()
        }

        OnStopObserving {
            unregisterReceiver()
        }
    }

    private fun registerReceiver() {
        if (receiver != null) return

        val context = appContext.reactContext?.applicationContext ?: return

        receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent?.getParcelableExtra(
                        BluetoothDevice.EXTRA_DEVICE,
                        BluetoothDevice::class.java
                    )
                } else {
                    @Suppress("DEPRECATION")
                    intent?.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                }

                val address = device?.address ?: return

                when (intent?.action) {
                    BluetoothDevice.ACTION_ACL_CONNECTED -> {
                        sendEvent("onDeviceConnected", bundleOf("address" to address))
                    }
                    BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                        sendEvent("onDeviceDisconnected", bundleOf("address" to address))
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
            addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
    }

    private fun unregisterReceiver() {
        val context = appContext.reactContext?.applicationContext ?: return
        receiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (_: IllegalArgumentException) {
                // Receiver was already unregistered
            }
        }
        receiver = null
    }
}
```

**Key details:**
- Uses `Build.VERSION_CODES.TIRAMISU` (API 33) check for `getParcelableExtra` deprecation
- Uses `RECEIVER_EXPORTED` flag on API 33+ (required for system broadcasts)
- `OnStartObserving` / `OnStopObserving` are called by Expo when JS starts/stops listening for events — this means the receiver is only active when something is subscribed
- Safe unregister with try/catch for `IllegalArgumentException`

- [ ] **Step 2: Commit Kotlin module**

```bash
git add apps/native/modules/bluetooth-connection/src/main/java/expo/modules/bluetoothconnection/BluetoothConnectionModule.kt
git commit -m "feat: implement Bluetooth ACL event BroadcastReceiver module"
```

---

### Task 3: Create the JS API for the native module

**Files:**
- Create: `apps/native/modules/bluetooth-connection/index.ts`

**Context:** Expo local modules export from `index.ts` at the module root. The `requireNativeModule` function from `expo-modules-core` loads the native module by name. `EventEmitter` wraps native events into typed JS subscriptions.

- [ ] **Step 1: Create index.ts**

```typescript
import { EventEmitter, type Subscription } from "expo-modules-core";
import { requireNativeModule } from "expo-modules-core";

interface BluetoothDeviceEvent {
  address: string;
}

const BluetoothConnectionNative = requireNativeModule("BluetoothConnection");
const emitter = new EventEmitter(BluetoothConnectionNative);

export function addDeviceConnectedListener(
  listener: (event: BluetoothDeviceEvent) => void,
): Subscription {
  return emitter.addListener("onDeviceConnected", listener);
}

export function addDeviceDisconnectedListener(
  listener: (event: BluetoothDeviceEvent) => void,
): Subscription {
  return emitter.addListener("onDeviceDisconnected", listener);
}
```

**Note:** No explicit `startListening`/`stopListening` calls are needed. Expo's `EventEmitter` automatically triggers `OnStartObserving` when the first listener is added and `OnStopObserving` when the last listener is removed. This simplifies the JS API.

- [ ] **Step 2: Commit JS API**

```bash
git add apps/native/modules/bluetooth-connection/index.ts
git commit -m "feat: add JS API for Bluetooth connection events module"
```

---

## Chunk 2: Shared Auto-Reconnect Utility

### Task 4: Extract autoReconnect to a shared utility with exponential backoff

**Files:**
- Create: `apps/native/src/features/settings/utils/autoReconnect.ts`

**Context:** The current `autoReconnect` function is defined at lines 64-88 of `apps/native/src/features/settings/hooks/usePrinterConnectionPolling.ts`. It uses fixed 2s delays, 3 max attempts, and no race condition guard. The new version adds exponential backoff (1s, 2s, 4s, 8s, 16s), 5 attempts, and checks the store for status changes before each attempt.

The function reads/writes from `usePrinterStore` using `getState()` (non-reactive access), and calls `connectToDevice` from `bluetoothPrinter.ts`. Both of these are already used in the existing implementation.

- [ ] **Step 1: Create autoReconnect.ts**

```typescript
import { connectToDevice } from "../services/bluetoothPrinter";
import { usePrinterStore } from "../stores/usePrinterStore";

const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

export async function autoReconnect(address: string): Promise<void> {
  const store = usePrinterStore.getState();

  // Don't start if already reconnecting
  if (store.connectionStatus[address] === "reconnecting") return;

  store.setConnectionStatus(address, "reconnecting");

  for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
    // Race condition guard: check if status changed (e.g., native connect event fired)
    const currentStore = usePrinterStore.getState();
    if (currentStore.connectionStatus[address] === "connected") return;

    // Check if printer was removed during reconnect
    if (!currentStore.printers.find((p) => p.id === address)) return;

    currentStore.incrementReconnectAttempts(address);
    const connected = await connectToDevice(address);

    if (connected) {
      usePrinterStore.getState().setConnectionStatus(address, "connected");
      usePrinterStore.getState().resetReconnectAttempts(address);
      return;
    }

    // Wait before next attempt (exponential: 1s, 2s, 4s, 8s, 16s)
    if (i < MAX_RECONNECT_ATTEMPTS - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, BACKOFF_DELAYS_MS[i]),
      );
    }
  }

  // All retries exhausted — total backoff wait: ~31s
  usePrinterStore.getState().setConnectionStatus(address, "failed");
}
```

**Differences from old version:**
- 5 attempts instead of 3
- Exponential backoff after each failed attempt (1s, 2s, 4s, 8s, 16s = ~31s total) instead of fixed 2s
- Guard at top: skip if already "reconnecting"
- Race condition guard: check status before each attempt
- Sets "reconnecting" status itself (callers don't need to)

- [ ] **Step 2: Commit shared utility**

```bash
git add apps/native/src/features/settings/utils/autoReconnect.ts
git commit -m "feat: extract autoReconnect with exponential backoff"
```

---

## Chunk 3: Event Listener Hook + Integration

### Task 5: Create useBluetoothConnectionEvents hook

**Files:**
- Create: `apps/native/src/features/settings/hooks/useBluetoothConnectionEvents.ts`

**Context:** This hook subscribes to native Bluetooth ACL events and updates the Zustand printer store. On disconnect, it triggers the shared `autoReconnect`. On connect, it sets status to "connected". It uses `usePrinterStore` to read printer list and match by MAC address (`printer.id`).

- [ ] **Step 1: Create useBluetoothConnectionEvents.ts**

```typescript
import { useEffect } from "react";
import {
  addDeviceConnectedListener,
  addDeviceDisconnectedListener,
} from "../../../../modules/bluetooth-connection";
import { usePrinterStore } from "../stores/usePrinterStore";
import { autoReconnect } from "../utils/autoReconnect";

export function useBluetoothConnectionEvents() {
  const isInitialized = usePrinterStore((s) => s.isInitialized);

  useEffect(() => {
    if (!isInitialized) return;

    const connectedSub = addDeviceConnectedListener(({ address }) => {
      const store = usePrinterStore.getState();
      const isPrinterTracked = store.printers.some((p) => p.id === address);
      if (!isPrinterTracked) return;

      store.setConnectionStatus(address, "connected");
      store.resetReconnectAttempts(address);
    });

    const disconnectedSub = addDeviceDisconnectedListener(({ address }) => {
      const store = usePrinterStore.getState();
      const isPrinterTracked = store.printers.some((p) => p.id === address);
      if (!isPrinterTracked) return;

      // Only trigger reconnect if the printer was previously connected
      const currentStatus = store.connectionStatus[address];
      if (currentStatus === "connected") {
        autoReconnect(address);
      }
    });

    return () => {
      connectedSub.remove();
      disconnectedSub.remove();
    };
  }, [isInitialized]);
}
```

**Key details:**
- Only processes events for printers that are in the store (matched by MAC address)
- Only triggers reconnect when a printer transitions from "connected" — not if already "disconnected" or "failed"
- Subscriptions auto-trigger `OnStartObserving`/`OnStopObserving` on the native side
- Cleanup removes subscriptions, which triggers `OnStopObserving` (unregisters BroadcastReceiver)

- [ ] **Step 2: Commit hook**

```bash
git add apps/native/src/features/settings/hooks/useBluetoothConnectionEvents.ts
git commit -m "feat: add useBluetoothConnectionEvents hook"
```

---

### Task 6: Update usePrinterConnectionPolling to use shared autoReconnect and 60s interval

**Files:**
- Modify: `apps/native/src/features/settings/hooks/usePrinterConnectionPolling.ts`

**Context:** Currently this file defines `POLL_INTERVAL_MS = 15_000`, `MAX_AUTO_RECONNECT = 3`, `AUTO_RECONNECT_DELAY_MS = 2_000`, and contains an inline `autoReconnect` function (lines 64-88). We need to:
1. Change `POLL_INTERVAL_MS` to `60_000`
2. Remove `MAX_AUTO_RECONNECT` and `AUTO_RECONNECT_DELAY_MS` constants
3. Remove the inline `autoReconnect` function
4. Import the shared `autoReconnect` from `../utils/autoReconnect`
5. Update the poll function to call the shared `autoReconnect` (which sets "reconnecting" status itself)

- [ ] **Step 1: Update usePrinterConnectionPolling.ts**

Replace the entire file with:

```typescript
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { connectToDevice } from "../services/bluetoothPrinter";
import { usePrinterStore } from "../stores/usePrinterStore";
import { autoReconnect } from "../utils/autoReconnect";

const POLL_INTERVAL_MS = 60_000;

export function usePrinterConnectionPolling() {
  const isInitialized = usePrinterStore((s) => s.isInitialized);
  const printers = usePrinterStore((s) => s.printers);
  const isPollingRef = useRef(false);

  useEffect(() => {
    if (!isInitialized || printers.length === 0) return;

    const poll = async () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        const store = usePrinterStore.getState();

        for (const printer of store.printers) {
          const currentStatus = store.connectionStatus[printer.id];

          // Don't poll printers that are actively reconnecting
          if (currentStatus === "reconnecting") continue;

          const connected = await connectToDevice(printer.id);

          if (connected) {
            store.setConnectionStatus(printer.id, "connected");
            store.resetReconnectAttempts(printer.id);
          } else if (currentStatus === "connected") {
            // Was connected, now isn't — start auto-reconnect
            autoReconnect(printer.id);
          }
          // If already "disconnected" or "failed", don't re-trigger auto-reconnect
        }
      } finally {
        isPollingRef.current = false;
      }
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);

    // Run an immediate poll when app comes to foreground
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        poll();
      }
    });

    return () => {
      clearInterval(intervalId);
      appStateSub.remove();
    };
  }, [isInitialized, printers.length]);
}
```

**Changes from original:**
- `POLL_INTERVAL_MS`: 15_000 → 60_000
- Removed `MAX_AUTO_RECONNECT` and `AUTO_RECONNECT_DELAY_MS` constants
- Removed inline `autoReconnect` function (lines 64-88)
- Added import of shared `autoReconnect` from `../utils/autoReconnect`
- Removed `store.setConnectionStatus(printer.id, "reconnecting")` before calling `autoReconnect` — the shared function handles that itself

- [ ] **Step 2: Verify no type errors**

Run from project root:
```bash
cd apps/native && pnpm typecheck
```

Expected: No new type errors related to `usePrinterConnectionPolling.ts` or `autoReconnect.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/settings/hooks/usePrinterConnectionPolling.ts
git commit -m "refactor: use shared autoReconnect and increase poll interval to 60s"
```

---

### Task 7: Integrate useBluetoothConnectionEvents in Navigation

**Files:**
- Modify: `apps/native/src/navigation/Navigation.tsx`

**Context:** The polling hook is already called at line 65: `usePrinterConnectionPolling()`. We add `useBluetoothConnectionEvents()` right next to it. The import path goes from `navigation/` up to `features/settings/hooks/`.

- [ ] **Step 1: Add import**

Add this import after the existing `usePrinterConnectionPolling` import (line 18):

```typescript
import { useBluetoothConnectionEvents } from "../features/settings/hooks/useBluetoothConnectionEvents";
```

- [ ] **Step 2: Add hook call**

Add the hook call right after the existing `usePrinterConnectionPolling()` call (line 65):

```typescript
  usePrinterConnectionPolling();
  useBluetoothConnectionEvents();
```

- [ ] **Step 3: Verify no type errors**

```bash
cd apps/native && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/navigation/Navigation.tsx
git commit -m "feat: integrate Bluetooth connection event listener in Navigation"
```

---

## Chunk 4: Build & Manual Testing

### Task 8: Prebuild and verify the native module compiles

**Context:** Since this is a new Expo native module, the Android project needs to be regenerated with `expo prebuild`. The module is auto-discovered by Expo autolinking from the `modules/` directory (default `nativeModulesDir`).

- [ ] **Step 1: Run prebuild**

```bash
cd apps/native && APP_VARIANT=staging pnpm prebuild:staging:clean
```

Expected: Prebuild completes without errors. The `android/` directory is regenerated with the new module included.

- [ ] **Step 2: Build and run on device**

```bash
cd apps/native && pnpm android:staging
```

Expected: App compiles and launches. No crash on startup.

- [ ] **Step 3: Manual test — disconnect detection**

1. Open the app and go to Settings → Printer Settings
2. Connect to a Bluetooth printer — verify green status dot
3. Turn off the printer
4. Observe: status should change to yellow "Reconnecting" within ~1-2 seconds (not 15s)
5. Wait for reconnect attempts to exhaust (~31s) — status should change to red "Failed"

- [ ] **Step 4: Manual test — reconnect detection**

1. With a printer in "Failed" or "Reconnecting" state, turn it back on
2. If reconnect loop is still running: should reconnect automatically
3. If status is "Failed": manually hit "Reconnect" button — should connect

- [ ] **Step 5: Manual test — safety-net poll**

1. Connect to a printer
2. Background the app
3. Turn off the printer
4. Wait 10 seconds, then foreground the app
5. The immediate poll on foreground should detect the disconnection and trigger reconnect

- [ ] **Step 6: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: address issues found during Bluetooth connection events testing"
```

(Only if fixes were needed — skip if everything worked.)
