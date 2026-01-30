# Implementation Plan: Online Status Indicator for POS

## Overview
Add a persistent status indicator button (top-right of every screen header) that shows server and printer connectivity. Tapping it opens a diagnostic dropdown panel with retry/reconnect actions. Alerts the cashier via haptics and toast when connectivity changes.

## Dependencies to Install
- `@react-native-community/netinfo` — device network status detection
- `expo-haptics` — vibration feedback on status changes

---

## Task 1: Install dependencies

```bash
cd apps/native && npx expo install @react-native-community/netinfo expo-haptics
```

**Verification:** `npx expo install` completes without errors.

---

## Task 2: Create Convex `ping` query

**File to create:** `packages/backend/convex/ping.ts`

This is a lightweight, unauthenticated query used as a heartbeat to detect server reachability.

```typescript
import { v } from "convex/values";
import { query } from "./_generated/server";

export const ping = query({
  args: {},
  returns: v.object({
    status: v.literal("ok"),
    timestamp: v.number(),
  }),
  handler: async () => {
    return {
      status: "ok" as const,
      timestamp: Date.now(),
    };
  },
});
```

**Why unauthenticated:** The heartbeat must work regardless of auth state. It only returns a static "ok" and a timestamp — no data exposure.

**Verification:** `npx convex dev` picks up the new file and generates `api.ping.ping`.

---

## Task 3: Create `useSystemStatus` hook

**File to create:** `apps/native/src/features/shared/hooks/useSystemStatus.ts`

**Also edit:** `apps/native/src/features/shared/hooks/index.ts` — add `export { useSystemStatus } from "./useSystemStatus";`

This hook combines three connectivity sources into a single status object.

### State shape
```typescript
type ConnectionStatus = "connected" | "disconnected" | "checking";

interface SystemStatus {
  server: ConnectionStatus;
  receiptPrinter: ConnectionStatus;
  kitchenPrinter: ConnectionStatus;
  lastSyncTimestamp: number | null;
  overallStatus: "ok" | "degraded" | "critical";
  retryServer: () => void;
  reconnectPrinter: (role: "receipt" | "kitchen") => void;
}
```

### Detection logic

1. **Device network** — Use `NetInfo.addEventListener` for real-time network state. When `isConnected` is false, immediately set `server` to `"disconnected"`.

2. **Server heartbeat** — Use `useQuery(api.ping.ping)` from Convex. Convex's `useQuery` auto-subscribes and reconnects. Track transitions:
   - Result is object with `status: "ok"` → `"connected"`, update `lastSyncTimestamp`
   - Result is `undefined` AND NetInfo says online → `"checking"`
   - Result is `undefined` AND NetInfo says offline → `"disconnected"`

3. **Printers** — Read from existing `usePrinterStore` Zustand store:
   - Get `printers` array and `connectionStatus` record
   - Find printer with role `"receipt"` → check `connectionStatus[address]`
   - Find printer with role `"kitchen"` → check `connectionStatus[address]`
   - If no printer configured for a role → treat as `"disconnected"` only if `kitchenPrintingEnabled` is true for kitchen, always check for receipt

4. **Overall status:**
   - `"critical"` if `server === "disconnected"`
   - `"degraded"` if any printer is `"disconnected"` but server is ok
   - `"ok"` if everything is connected

5. **Alerts on status change** — Use `useRef` to track previous `overallStatus`. When it changes:
   - `Haptics.notificationAsync(NotificationFeedbackType.Warning)` for degraded
   - `Haptics.notificationAsync(NotificationFeedbackType.Error)` for critical

6. **Recovery actions:**
   - `retryServer()` — toggle a state counter to force `useQuery` re-evaluation
   - `reconnectPrinter(role)` — find printer by role from store, call `usePrinterStore.getState().connectPrinter(address)`

**Verification:** Import in HomeScreen temporarily, `console.log(status)`.

---

## Task 4: Create `StatusIndicatorButton` component

**File to create:** `apps/native/src/features/shared/components/StatusIndicatorButton.tsx`

A small pressable circle (24x24) showing overall status color. Uses `useSystemStatus` internally.

### Colors
- Green (`#22C55E`) — all ok
- Yellow (`#F59E0B`) — degraded
- Red (`#EF4444`) — critical, with pulsing animation

### Pulsing animation
Use `react-native-reanimated` (already installed):
```typescript
import { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from "react-native-reanimated";

const pulseAnim = useSharedValue(1);
useEffect(() => {
  if (overallStatus === "critical") {
    pulseAnim.value = withRepeat(
      withSequence(
        withTiming(1.3, { duration: 500 }),
        withTiming(1.0, { duration: 500 }),
      ),
      -1,
    );
  } else {
    pulseAnim.value = withTiming(1, { duration: 200 });
  }
}, [overallStatus]);
```

### Props
```typescript
interface StatusIndicatorButtonProps {
  onPress: () => void;
}
```

**Verification:** Render in isolation, confirm green static dot and red pulsing.

---

## Task 5: Create `StatusDropdown` component

**File to create:** `apps/native/src/features/shared/components/StatusDropdown.tsx`

A dropdown panel shown via React Native `Modal` (transparent) positioned top-right.

### Layout
```
┌──────────────────────────────┐
│  System Status               │
├──────────────────────────────┤
│  ● Server        Connected   │
│  ● Receipt Printer Connected │
│  ● Kitchen Printer  Offline  │
│    [Reconnect]               │
├──────────────────────────────┤
│  Last sync: just now         │
└──────────────────────────────┘
```

### Props
```typescript
interface StatusDropdownProps {
  visible: boolean;
  onClose: () => void;
  status: SystemStatus; // from useSystemStatus
}
```

### Implementation details

- `Modal` with `transparent: true`, `animationType="fade"`
- Full-screen `Pressable` backdrop (transparent) that calls `onClose`
- White card positioned with `position: absolute`, `top: 8`, `right: 16`
- Card has shadow, rounded-xl, min-width 260

**Status rows:** Each shows:
- Colored dot (8x8 rounded-full View)
- Label: "Server", "Receipt Printer", "Kitchen Printer"
- Status text colored green/red/yellow
- If disconnected: small "Retry" / "Reconnect" `Button` (size="sm", variant="outline") calling `status.retryServer()` or `status.reconnectPrinter(role)`

**Last sync line:**
- `< 10s` → "just now"
- `< 60s` → "Xs ago"
- `< 300s` → "Xm ago"
- `>= 300s` → "5+ min ago" (red text)
- `null` → "Never" (red text)

**Verification:** Toggle visibility, confirm layout and action buttons.

---

## Task 6: Create `SystemStatusBar` wrapper component

**File to create:** `apps/native/src/features/shared/components/SystemStatusBar.tsx`

Combines the button, dropdown, and toast into one component that screens import.

```tsx
export const SystemStatusBar = () => {
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const status = useSystemStatus();

  return (
    <>
      <StatusIndicatorButton onPress={() => setDropdownVisible(true)} />
      <StatusDropdown
        visible={dropdownVisible}
        onClose={() => setDropdownVisible(false)}
        status={status}
      />
      <StatusToast status={status} />
    </>
  );
};
```

### StatusToast (inline in same file)
- Tracks previous `server` status via `useRef`
- On transition to `"disconnected"`: show red banner "Server connection lost", auto-dismiss 3s
- On transition to `"connected"` (from disconnected): show green banner "Server reconnected", auto-dismiss 2s
- Uses `Animated.View` with opacity fade, positioned absolutely top of screen, full width, high zIndex
- Text: white, bold, centered

**Export:** Add to `apps/native/src/features/shared/components/ui/index.ts`:
```typescript
export { SystemStatusBar } from "../SystemStatusBar";
```

**Verification:** Simulate offline → toast appears, haptic fires, red pulsing dot.

---

## Task 7: Integrate into all screen headers

Add `<SystemStatusBar />` to the right side of every screen header. Import from shared components.

### Screens to modify (6 header components/inline headers):

**1. `apps/native/src/features/home/components/HomeHeader.tsx`**

Current right side has `flex-row gap-2` with 3 IconButtons. Add `<SystemStatusBar />` as the **first child** in that row:
```tsx
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";

// In the right-side View:
<View className="flex-row gap-2 items-center">
  <SystemStatusBar />
  <IconButton icon="receipt-outline" onPress={onOrderHistory} />
  <IconButton icon="settings-outline" onPress={onSettings} />
  <IconButton icon="log-out-outline" variant="destructive" onPress={handleLogoutPress} />
</View>
```

**2. `apps/native/src/features/tables/components/Header.tsx`**

Same pattern as HomeHeader — add `<SystemStatusBar />` first in right-side row:
```tsx
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";

<View className="flex-row gap-2 items-center">
  <SystemStatusBar />
  <IconButton icon="receipt-outline" onPress={onOrderHistory} />
  <IconButton icon="settings-outline" onPress={onSettings} />
  <IconButton icon="log-out-outline" variant="destructive" onPress={handleLogoutPress} />
</View>
```

**3. `apps/native/src/features/orders/components/OrderHeader.tsx`**

Current right side: optional transfer table IconButton. Add `<SystemStatusBar />` before it:
```tsx
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";

// After the flex-1 title section, before closing </View>:
<SystemStatusBar />
{onTransferTable && (
  <IconButton icon="swap-horizontal" variant="ghost" onPress={onTransferTable} iconColor="#6B7280" />
)}
```

**4. `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`** (inline header ~line 324)

Current header: back button + title, no right side. Add SystemStatusBar:
```tsx
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";

// In the header View (line 324):
<View className="bg-white flex-row items-center px-4 py-3 border-b border-gray-200">
  <IconButton icon="arrow-back" variant="ghost" onPress={handleBack} className="mr-2" />
  <View className="flex-1">
    <Text variant="heading" size="lg">Checkout</Text>
    ...
  </View>
  <SystemStatusBar />
</View>
```

**5. `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`** (inline header ~line 75)

Current right side has "New Order" button. Add SystemStatusBar before it:
```tsx
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";

// In the header right section:
<View className="flex-row gap-2 items-center">
  <SystemStatusBar />
  <Button ...>New Order</Button>
</View>
```

**6. `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx`**

Uses `OrderHeader` component — already modified in step 3. No additional changes needed.

**7. Check remaining screens** — OrderHistoryScreen, OrderDetailScreen, SettingsScreen, PrinterSettingsScreen. Read their headers and add `<SystemStatusBar />` using the same pattern.

### Verification
Navigate through all screens. Confirm the green dot appears consistently in every header's top-right area.

---

## Task 8: End-to-end testing

1. **Normal state:** Green dot, static. Dropdown shows all "Connected", "Last sync: just now"
2. **Disable WiFi:** Red pulsing dot, toast "Server connection lost", haptic buzz, dropdown shows server "Disconnected" with Retry
3. **Re-enable WiFi:** Green dot returns, toast "Server reconnected"
4. **Disconnect Bluetooth printer:** Yellow dot, dropdown shows printer "Offline" with Reconnect
5. **Both down:** Red dot (server takes priority over printer status)

---

## File Summary

| Action | File |
|--------|------|
| INSTALL | `@react-native-community/netinfo`, `expo-haptics` |
| CREATE | `packages/backend/convex/ping.ts` |
| CREATE | `apps/native/src/features/shared/hooks/useSystemStatus.ts` |
| CREATE | `apps/native/src/features/shared/components/StatusIndicatorButton.tsx` |
| CREATE | `apps/native/src/features/shared/components/StatusDropdown.tsx` |
| CREATE | `apps/native/src/features/shared/components/SystemStatusBar.tsx` |
| EDIT | `apps/native/src/features/shared/hooks/index.ts` (add export) |
| EDIT | `apps/native/src/features/shared/components/ui/index.ts` (add export) |
| EDIT | `apps/native/src/features/home/components/HomeHeader.tsx` |
| EDIT | `apps/native/src/features/tables/components/Header.tsx` |
| EDIT | `apps/native/src/features/orders/components/OrderHeader.tsx` |
| EDIT | `apps/native/src/features/checkout/screens/CheckoutScreen.tsx` |
| EDIT | `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx` |
| EDIT | Other screens with headers (OrderHistory, Settings, etc.) |

## Execution Order

1. **Task 1** — Install deps (no dependencies)
2. **Task 2** — Convex ping query (no dependencies)
3. **Task 3** — useSystemStatus hook (depends on Task 1 for NetInfo/Haptics, Task 2 for ping query)
4. **Task 4** — StatusIndicatorButton (depends on Task 3)
5. **Task 5** — StatusDropdown (depends on Task 3)
6. **Task 6** — SystemStatusBar wrapper (depends on Tasks 4, 5)
7. **Task 7** — Integrate into headers (depends on Task 6)
8. **Task 8** — End-to-end testing (depends on Task 7)

Tasks 1 and 2 can run in parallel. Tasks 4 and 5 can run in parallel after Task 3.
