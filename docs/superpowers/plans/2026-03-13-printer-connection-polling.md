# Printer Connection Polling & Error Notifications Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add periodic Bluetooth printer connection polling with auto-reconnect (3 retries), proper error states, and reconnect buttons everywhere printers are shown.

**Architecture:** Extend the Zustand printer store with string-based connection states and retry tracking. A new polling hook runs a 15-second interval that checks each printer's connection and triggers auto-reconnect with exponential limits. UI components read the richer status to show reconnecting/failed states and surface errors on manual reconnect.

**Tech Stack:** React Native, Zustand, `@vardrz/react-native-bluetooth-escpos-printer` (BluetoothManager), React Native Alert API

**Spec:** `docs/superpowers/specs/2026-03-13-printer-connection-polling-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/native/src/features/settings/stores/usePrinterStore.ts` | Modify | Change `connectionStatus` type, add `reconnectAttempts`, add `setConnectionStatus`/`resetReconnectAttempts` actions |
| `apps/native/src/features/settings/hooks/usePrinterConnectionPolling.ts` | Create | Polling hook with 15s interval and auto-reconnect logic |
| `apps/native/src/features/shared/hooks/useSystemStatus.ts` | Modify | Adapt printer status derivation to new string states, update `reconnectPrinter` to return success/failure |
| `apps/native/src/features/shared/components/StatusDropdown.tsx` | Modify | Handle `reconnecting`/`failed` states, add Alert on manual reconnect failure |
| `apps/native/src/features/shared/components/SystemStatusBar.tsx` | Modify | No changes needed — delegates to StatusIndicatorButton which reads overallStatus |
| `apps/native/src/features/settings/screens/PrinterSettingsScreen.tsx` | Modify | Add Reconnect button, update status display for new states |
| `apps/native/src/navigation/Navigation.tsx` | Modify | Mount `usePrinterConnectionPolling` hook |

---

## Chunk 1: Store & Polling Infrastructure

### Task 1: Update PrinterStore Types and State

**Files:**
- Modify: `apps/native/src/features/settings/stores/usePrinterStore.ts`

- [ ] **Step 1: Define the new connection status type and update the interface**

Add a type alias and update the store interface. Change `connectionStatus` from `Record<string, boolean>` to `Record<string, PrinterConnectionStatus>`. Add `reconnectAttempts` state and new actions.

```typescript
// Add after line 27 (after INITIALIZATION_DELAY_MS)
export type PrinterConnectionStatus = "connected" | "disconnected" | "reconnecting" | "failed";
```

Update the `PrinterStore` interface:
```typescript
interface PrinterStore {
  printers: PrinterConfig[];
  connectionStatus: Record<string, PrinterConnectionStatus>;  // was Record<string, boolean>
  reconnectAttempts: Record<string, number>;                   // NEW
  isScanning: boolean;
  kitchenPrintingEnabled: boolean;
  cashDrawerEnabled: boolean;
  isInitialized: boolean;

  initialize: () => Promise<{ failedPrinters: string[] }>;
  fetchPairedDevices: () => Promise<BluetoothDevice[]>;
  scanForDevices: () => Promise<BluetoothDevice[]>;
  connectPrinter: (address: string) => Promise<boolean>;
  disconnectPrinter: (address: string) => Promise<void>;
  setConnectionStatus: (address: string, status: PrinterConnectionStatus) => void;  // NEW
  resetReconnectAttempts: (address: string) => void;                                 // NEW
  incrementReconnectAttempts: (address: string) => number;                           // NEW
  addPrinter: (
    device: BluetoothDevice,
    role: "receipt" | "kitchen",
    paperWidth: 58 | 80,
  ) => Promise<void>;
  removePrinter: (id: string) => Promise<void>;
  updatePrinter: (id: string, updates: Partial<PrinterConfig>) => Promise<void>;
  setKitchenPrintingEnabled: (enabled: boolean) => Promise<void>;
  setCashDrawerEnabled: (enabled: boolean) => Promise<void>;
  printReceipt: (data: ReceiptData) => Promise<void>;
  printKitchenTicket: (data: KitchenTicketData) => Promise<void>;
  openCashDrawer: () => Promise<void>;
  testPrint: (address: string) => Promise<void>;
}
```

- [ ] **Step 2: Update the store implementation**

Initialize `reconnectAttempts: {}` alongside existing state (after line 60).

Update `initialize` — change the `connectionStatus` building to use string values:
```typescript
// In initialize(), replace lines 79-93:
const failedPrinters: string[] = [];
const connectionStatus: Record<string, PrinterConnectionStatus> = {};

for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
  if (i > 0) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  for (const printer of settings.printers) {
    const connected = await connectToDevice(printer.id);
    connectionStatus[printer.id] = connected ? "connected" : "disconnected";
    if (!connected) {
      failedPrinters.push(printer.name);
    }
  }
}
```

Update `connectPrinter` — use string status:
```typescript
connectPrinter: async (address: string) => {
  const connected = await connectToDevice(address);
  set((state) => ({
    connectionStatus: {
      ...state.connectionStatus,
      [address]: connected ? "connected" : "disconnected",
    },
  }));
  return connected;
},
```

Update `disconnectPrinter` — use string status:
```typescript
disconnectPrinter: async (address: string) => {
  await disconnectDevice();
  set((state) => ({
    connectionStatus: { ...state.connectionStatus, [address]: "disconnected" },
  }));
},
```

Add the three new actions after `disconnectPrinter`:
```typescript
setConnectionStatus: (address: string, status: PrinterConnectionStatus) => {
  set((state) => ({
    connectionStatus: { ...state.connectionStatus, [address]: status },
  }));
},

resetReconnectAttempts: (address: string) => {
  set((state) => ({
    reconnectAttempts: { ...state.reconnectAttempts, [address]: 0 },
  }));
},

incrementReconnectAttempts: (address: string) => {
  const current = get().reconnectAttempts[address] ?? 0;
  const next = current + 1;
  set((state) => ({
    reconnectAttempts: { ...state.reconnectAttempts, [address]: next },
  }));
  return next;
},
```

Update `addPrinter` — use string status (line 147):
```typescript
connectionStatus: {
  ...state.connectionStatus,
  [device.address]: connected ? "connected" : "disconnected",
},
```

Update `removePrinter` — the existing destructure/filter pattern works as-is since it's just removing a key.

Update `testPrint` — the existing check `!connectionStatus[address]` needs to change:
```typescript
// Replace line 241: if (!connectionStatus[address]) {
if (connectionStatus[address] !== "connected") {
```

Update `printReceipt`, `printKitchenTicket`, `openCashDrawer` — these call `connectPrinter` which returns boolean, so no changes needed there.

- [ ] **Step 3: Verify the app compiles**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No type errors in `usePrinterStore.ts` (there will be errors in consumers — that's expected, we fix those next)

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/settings/stores/usePrinterStore.ts
git commit -m "feat: extend printer connection status to string-based states with reconnect tracking"
```

---

### Task 2: Create the Polling Hook

**Files:**
- Create: `apps/native/src/features/settings/hooks/usePrinterConnectionPolling.ts`

- [ ] **Step 1: Create the polling hook**

```typescript
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { connectToDevice } from "../services/bluetoothPrinter";
import { usePrinterStore } from "../stores/usePrinterStore";

const POLL_INTERVAL_MS = 15_000;
const MAX_AUTO_RECONNECT = 3;
const AUTO_RECONNECT_DELAY_MS = 2_000;

export function usePrinterConnectionPolling() {
  const isInitialized = usePrinterStore((s) => s.isInitialized);
  const printers = usePrinterStore((s) => s.printers);
  const isPollingRef = useRef(false);

  useEffect(() => {
    if (!isInitialized || printers.length === 0) return;

    const poll = async () => {
      // Skip if already polling (prevents overlapping polls)
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
            // Printer is reachable — reset everything to good state
            store.setConnectionStatus(printer.id, "connected");
            store.resetReconnectAttempts(printer.id);
          } else if (currentStatus === "connected") {
            // Was connected, now isn't — start auto-reconnect
            store.setConnectionStatus(printer.id, "reconnecting");
            autoReconnect(printer.id);
          }
          // If already "disconnected" or "failed", don't re-trigger auto-reconnect
          // User must manually reconnect from those states
        }
      } finally {
        isPollingRef.current = false;
      }
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);

    // Pause polling when app is backgrounded, resume on foreground
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // Run an immediate poll when coming back to foreground
        poll();
      }
    });

    return () => {
      clearInterval(intervalId);
      appStateSub.remove();
    };
  }, [isInitialized, printers.length]);
}

async function autoReconnect(address: string) {
  const store = usePrinterStore.getState();

  for (let i = 0; i < MAX_AUTO_RECONNECT; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, AUTO_RECONNECT_DELAY_MS));
    }

    const attempt = store.incrementReconnectAttempts(address);
    const connected = await connectToDevice(address);

    if (connected) {
      store.setConnectionStatus(address, "connected");
      store.resetReconnectAttempts(address);
      return;
    }

    // Re-read store in case printer was removed during reconnect
    const currentStore = usePrinterStore.getState();
    if (!currentStore.printers.find((p) => p.id === address)) return;
  }

  // All retries exhausted
  store.setConnectionStatus(address, "failed");
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No new type errors from this file

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/settings/hooks/usePrinterConnectionPolling.ts
git commit -m "feat: add printer connection polling hook with auto-reconnect"
```

---

### Task 3: Mount Polling in Navigation

**Files:**
- Modify: `apps/native/src/navigation/Navigation.tsx`

- [ ] **Step 1: Import and mount the polling hook**

Add import after line 18:
```typescript
import { usePrinterConnectionPolling } from "../features/settings/hooks/usePrinterConnectionPolling";
```

Add the hook call inside the `Navigation` component, after the `isInitialized` selector (after line 63):
```typescript
usePrinterConnectionPolling();
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/navigation/Navigation.tsx
git commit -m "feat: mount printer connection polling in Navigation"
```

---

## Chunk 2: UI Updates

### Task 4: Update useSystemStatus for New Status Types

**Files:**
- Modify: `apps/native/src/features/shared/hooks/useSystemStatus.ts`

- [ ] **Step 1: Import the new type and update printer status derivation**

Add import at the top:
```typescript
import type { PrinterConnectionStatus } from "../../settings/stores/usePrinterStore";
```

Update `ConnectionStatus` export to include the new states:
```typescript
export type ConnectionStatus = "connected" | "disconnected" | "checking" | "reconnecting" | "failed";
```

Update `receiptPrinter` derivation (replace lines 63-67):
```typescript
const receiptPrinter: ConnectionStatus = useMemo(() => {
  const printer = printers.find((p) => p.role === "receipt" && p.isDefault);
  if (!printer) return "disconnected";
  const status = connectionStatus[printer.id];
  if (!status || status === "disconnected") return "disconnected";
  if (status === "reconnecting") return "reconnecting";
  if (status === "failed") return "failed";
  return "connected";
}, [printers, connectionStatus]);
```

Update `kitchenPrinter` derivation (replace lines 69-74):
```typescript
const kitchenPrinter: ConnectionStatus = useMemo(() => {
  if (!kitchenPrintingEnabled) return "connected"; // not relevant, treat as ok
  const printer = printers.find((p) => p.role === "kitchen" && p.isDefault);
  if (!printer) return "disconnected";
  const status = connectionStatus[printer.id];
  if (!status || status === "disconnected") return "disconnected";
  if (status === "reconnecting") return "reconnecting";
  if (status === "failed") return "failed";
  return "connected";
}, [printers, connectionStatus, kitchenPrintingEnabled]);
```

Update `overallStatus` derivation (replace lines 77-82):
```typescript
const overallStatus: OverallStatus = useMemo(() => {
  if (server === "disconnected") return "critical";
  const printerStatuses = [receiptPrinter, kitchenPrinter];
  if (printerStatuses.includes("failed")) return "critical";
  if (printerStatuses.includes("disconnected") || printerStatuses.includes("reconnecting")) return "degraded";
  if (server === "checking") return "degraded";
  return "ok";
}, [server, receiptPrinter, kitchenPrinter]);
```

- [ ] **Step 2: Update `reconnectPrinter` to return success/failure and reset retry counter**

Replace lines 105-111:
```typescript
const reconnectPrinter = useCallback(async (role: "receipt" | "kitchen"): Promise<boolean> => {
  const store = usePrinterStore.getState();
  const printer = store.printers.find((p) => p.role === role && p.isDefault);
  if (!printer) return false;

  store.setConnectionStatus(printer.id, "reconnecting");
  store.resetReconnectAttempts(printer.id);

  const connected = await store.connectPrinter(printer.id);
  if (!connected) {
    store.setConnectionStatus(printer.id, "failed");
  }
  return connected;
}, []);
```

Update `SystemStatus` interface to reflect the return type:
```typescript
reconnectPrinter: (role: "receipt" | "kitchen") => Promise<boolean>;  // was Promise<void>
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: Possible errors in StatusDropdown (we fix next). No errors in useSystemStatus itself.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/shared/hooks/useSystemStatus.ts
git commit -m "feat: update useSystemStatus for extended printer connection states"
```

---

### Task 5: Update StatusDropdown

**Files:**
- Modify: `apps/native/src/features/shared/components/StatusDropdown.tsx`

- [ ] **Step 1: Add new states to color/label maps and update StatusRow**

Add `Alert` to React Native imports:
```typescript
import { Alert, Modal, Pressable, View } from "react-native";
```

Update `STATUS_DOT_COLORS`:
```typescript
const STATUS_DOT_COLORS: Record<ConnectionStatus, string> = {
  connected: "#22C55E",
  disconnected: "#EF4444",
  checking: "#F59E0B",
  reconnecting: "#F59E0B",
  failed: "#EF4444",
};
```

Update `STATUS_LABELS`:
```typescript
const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: "Connected",
  disconnected: "Offline",
  checking: "Checking...",
  reconnecting: "Reconnecting...",
  failed: "Connection Failed",
};
```

Update `StatusRow` to disable button during reconnecting and handle `failed` state (replace lines 40-70):
```typescript
const StatusRow = ({ label, connectionStatus, onRetry, retryLabel = "Retry" }: StatusRowProps) => {
  const showRetryButton =
    (connectionStatus === "disconnected" || connectionStatus === "failed") && onRetry;
  const isReconnecting = connectionStatus === "reconnecting";

  return (
    <YStack paddingVertical={8}>
      <XStack alignItems="center" justifyContent="space-between">
        <XStack alignItems="center" gap={8} flex={1}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: STATUS_DOT_COLORS[connectionStatus],
            }}
          />
          <Text size="sm" style={{ color: "#374151" }}>
            {label}
          </Text>
        </XStack>
        <Text size="xs" style={{ color: STATUS_DOT_COLORS[connectionStatus], fontWeight: "500" }}>
          {STATUS_LABELS[connectionStatus]}
        </Text>
      </XStack>
      {isReconnecting && (
        <YStack marginLeft={16} marginTop={4}>
          <Button size="sm" variant="outline" disabled>
            <Text size="xs" style={{ color: "#9CA3AF" }}>
              Reconnecting...
            </Text>
          </Button>
        </YStack>
      )}
      {showRetryButton && (
        <YStack marginLeft={16} marginTop={4}>
          <Button size="sm" variant="outline" onPress={onRetry}>
            <Text size="xs" style={{ color: "#0B6FBA" }}>
              {retryLabel}
            </Text>
          </Button>
        </YStack>
      )}
    </YStack>
  );
};
```

- [ ] **Step 2: Update reconnect handlers to show Alert on failure**

In `StatusDropdown`, wrap the `reconnectPrinter` calls with error handling. Replace the `StatusRow` usage for printers (replace lines 106-117):
```typescript
<StatusRow
  label="Receipt Printer"
  connectionStatus={status.receiptPrinter}
  onRetry={async () => {
    const success = await status.reconnectPrinter("receipt");
    if (!success) {
      Alert.alert(
        "Reconnect Failed",
        "Could not connect to the receipt printer. Make sure the printer is turned on and in range.",
        [
          { text: "Retry", onPress: () => status.reconnectPrinter("receipt") },
          { text: "Dismiss", style: "cancel" },
        ],
      );
    }
  }}
  retryLabel="Reconnect"
/>
<StatusRow
  label="Kitchen Printer"
  connectionStatus={status.kitchenPrinter}
  onRetry={async () => {
    const success = await status.reconnectPrinter("kitchen");
    if (!success) {
      Alert.alert(
        "Reconnect Failed",
        "Could not connect to the kitchen printer. Make sure the printer is turned on and in range.",
        [
          { text: "Retry", onPress: () => status.reconnectPrinter("kitchen") },
          { text: "Dismiss", style: "cancel" },
        ],
      );
    }
  }}
  retryLabel="Reconnect"
/>
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/shared/components/StatusDropdown.tsx
git commit -m "feat: update StatusDropdown for extended connection states with error alerts"
```

---

### Task 6: Add Reconnect Button to PrinterSettingsScreen

**Files:**
- Modify: `apps/native/src/features/settings/screens/PrinterSettingsScreen.tsx`

- [ ] **Step 1: Import PrinterConnectionStatus type and add reconnect handler**

Add import:
```typescript
import type { PrinterConnectionStatus } from "../stores/usePrinterStore";
```

Add `connectPrinter`, `setConnectionStatus`, and `resetReconnectAttempts` to the destructured store:
```typescript
const {
  printers,
  connectionStatus,
  kitchenPrintingEnabled,
  cashDrawerEnabled,
  setKitchenPrintingEnabled,
  setCashDrawerEnabled,
  openCashDrawer,
  testPrint,
  removePrinter,
  connectPrinter,
  setConnectionStatus,
  resetReconnectAttempts,
} = usePrinterStore();
```

Add a reconnect handler:
```typescript
const handleReconnect = async (printer: PrinterConfig) => {
  setConnectionStatus(printer.id, "reconnecting");
  resetReconnectAttempts(printer.id);

  const connected = await connectPrinter(printer.id);
  if (!connected) {
    setConnectionStatus(printer.id, "failed");
    Alert.alert(
      "Reconnect Failed",
      `Could not connect to "${printer.name}". Make sure the printer is turned on and in range.`,
      [
        { text: "Retry", onPress: () => handleReconnect(printer) },
        { text: "Dismiss", style: "cancel" },
      ],
    );
  }
};
```

- [ ] **Step 2: Update the status display and add Reconnect button**

Update the connection status section in the printer card. Replace lines 204-216 (status dot + label):
```typescript
{/* Connection status */}
<XStack alignItems="center" marginBottom={12}>
  <YStack
    width={8}
    height={8}
    borderRadius={4}
    marginRight={8}
    backgroundColor={
      status === "connected"
        ? "#22C55E"
        : status === "reconnecting"
          ? "#F59E0B"
          : status === "failed"
            ? "#EF4444"
            : "#9CA3AF"
    }
  />
  <Text
    size="sm"
    style={{
      color:
        status === "connected"
          ? "#16A34A"
          : status === "reconnecting"
            ? "#D97706"
            : status === "failed"
              ? "#DC2626"
              : "#6B7280",
    }}
  >
    {status === "connected"
      ? "Connected"
      : status === "reconnecting"
        ? "Reconnecting..."
        : status === "failed"
          ? "Connection Failed"
          : "Disconnected"}
  </Text>
</XStack>
```

Note: The `status` variable needs to be derived from `connectionStatus[printer.id]`. Update the map callback — replace line 180's `isConnected` with:
```typescript
const status: PrinterConnectionStatus = connectionStatus[printer.id] ?? "disconnected";
```

Remove the old `isConnected` line (line 180).

Update the action buttons row (replace lines 219-235). Add a Reconnect button that only shows when disconnected or failed:
```typescript
{/* Action buttons */}
<XStack gap={8} flexWrap="wrap">
  {(status === "disconnected" || status === "failed") && (
    <Button variant="outline" size="sm" onPress={() => handleReconnect(printer)}>
      <Text style={{ color: "#0D87E1", fontSize: 14, fontWeight: "500" }}>
        Reconnect
      </Text>
    </Button>
  )}
  {status === "reconnecting" && (
    <Button variant="outline" size="sm" disabled>
      <Text style={{ color: "#9CA3AF", fontSize: 14, fontWeight: "500" }}>
        Reconnecting...
      </Text>
    </Button>
  )}
  <Button variant="outline" size="sm" onPress={() => testPrint(printer.id)}>
    Test Print
  </Button>
  <Button variant="outline" size="sm" onPress={() => setEditingPrinter(printer)}>
    Edit
  </Button>
  <Button
    variant="outline"
    size="sm"
    onPress={() => handleRemove(printer)}
    style={{ borderColor: "#FCA5A5" }}
  >
    <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "500" }}>
      Remove
    </Text>
  </Button>
</XStack>
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/settings/screens/PrinterSettingsScreen.tsx
git commit -m "feat: add reconnect button and extended status display to PrinterSettingsScreen"
```

---

## Chunk 3: Final Verification

### Task 7: Full Build & Manual Test

- [ ] **Step 1: Run full type check**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: Clean pass, no errors

- [ ] **Step 2: Run linter**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm check`
Expected: No lint/format errors (fix any that appear)

- [ ] **Step 3: Manual test checklist**

Test on device with Bluetooth printer:
1. App startup with printer ON → status shows "Connected" (green)
2. Turn printer OFF → within ~15s status changes to "Reconnecting..." (amber)
3. Wait for 3 retries → status changes to "Connection Failed" (red)
4. Press Reconnect in StatusDropdown → Alert shows "Reconnect Failed" with Retry/Dismiss
5. Press Reconnect in PrinterSettingsScreen → same Alert behavior
6. Turn printer back ON → press Reconnect → status returns to "Connected"
7. Turn printer back ON → wait for next poll cycle → status auto-recovers to "Connected" (only if currently "connected" → detected disconnect path; for "failed" state, user must manually reconnect)
