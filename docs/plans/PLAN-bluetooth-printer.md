# Implementation Plan: POS Bluetooth Printer Support & Receipt Flow

## Overview
Replace the current system print dialog flow with direct Bluetooth thermal printer support. Add a Settings screen with printer management (scan, pair, configure roles/paper width). Improve the post-checkout experience with a receipt preview modal.

## Library Choice
**`react-native-bluetooth-escpos-printer`** (fork: `@vardrz/react-native-bluetooth-escpos-printer` v0.1.1) — the most recently maintained fork with ESC/POS support. For iOS Bluetooth printing, we'll use a platform abstraction that falls back to `expo-print` on iOS until the library adds full iOS support.

> **Note:** Bluetooth Classic (SPP) libraries have limited iOS support across the ecosystem. Android will get direct Bluetooth thermal printing. iOS will use AirPrint as fallback. This is an industry-wide limitation.

---

## Task 1: Install Bluetooth printing dependencies

**Files to create/modify:**
- `apps/native/package.json` — add dependency

**Steps:**
1. Install `@vardrz/react-native-bluetooth-escpos-printer` and `zustand`
2. Run `npx expo prebuild` to regenerate native projects
3. Add Bluetooth permissions to `AndroidManifest.xml` (if not auto-configured):
   - `BLUETOOTH`, `BLUETOOTH_ADMIN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`, `ACCESS_FINE_LOCATION`

**Verification:** App builds and runs on Android device without errors.

---

## Task 2: Create printer storage service

**File to create:**
- `apps/native/src/features/settings/services/printerStorage.ts`

**Purpose:** Persist paired printer configs using `expo-secure-store` (already in deps). This stores printer settings locally on-device — not in Convex — since printers are device-specific.

```typescript
// Data model
interface PrinterConfig {
  id: string;           // Bluetooth MAC address
  name: string;         // User-editable label
  deviceName: string;   // Original Bluetooth device name
  role: "receipt" | "kitchen";
  paperWidth: 58 | 80;  // mm
  isDefault: boolean;    // default for its role
}

interface PrinterSettings {
  printers: PrinterConfig[];
  kitchenPrintingEnabled: boolean;  // toggle in settings, default false
}
```

**Functions:**
- `getPrinterSettings(): Promise<PrinterSettings>`
- `savePrinterSettings(settings: PrinterSettings): Promise<void>`
- `getDefaultPrinter(role: "receipt" | "kitchen"): Promise<PrinterConfig | null>`
- `addPrinter(config: PrinterConfig): Promise<void>`
- `updatePrinter(id: string, updates: Partial<PrinterConfig>): Promise<void>`
- `removePrinter(id: string): Promise<void>`

**Verification:** Unit test or manual test — save and retrieve a printer config.

---

## Task 3: Create Bluetooth printer service

**File to create:**
- `apps/native/src/features/settings/services/bluetoothPrinter.ts`

**Purpose:** Wraps the Bluetooth library with a clean API for scanning, connecting, and printing.

```typescript
interface BluetoothDevice {
  name: string;
  address: string; // MAC address
}

// Functions
scanDevices(): Promise<BluetoothDevice[]>
connectToDevice(address: string): Promise<boolean>
disconnectDevice(address: string): Promise<void>
isConnected(address: string): Promise<boolean>
getConnectionStatus(): Promise<Map<string, boolean>>
printEscPos(commands: Uint8Array, address: string): Promise<void>
```

**Platform handling:**
- Android: Use `@vardrz/react-native-bluetooth-escpos-printer` BluetoothManager + BluetoothEscposPrinter
- iOS: Fall back to `expo-print` with HTML rendering (existing behavior)

**Verification:** Scan returns nearby Bluetooth devices on Android.

---

## Task 4: Create ESC/POS receipt formatter

**File to create:**
- `apps/native/src/features/settings/services/escposFormatter.ts`

**Purpose:** Convert `ReceiptData` into ESC/POS byte commands for thermal printers. Two formats: receipt and kitchen.

**Receipt format** (mirrors existing HTML receipt):
- Store header (bold, centered)
- Divider line
- Order info (receipt #, date, type, table, cashier)
- Customer info (if discount applied)
- Items table (name, qty, price, total)
- Totals (subtotal, discount, grand total — bold)
- Payment details
- VAT breakdown
- Footer: "Thank you for your patronage!" + "This does not serve as an official receipt"

**Kitchen format** (simplified):
- Order # (large/bold)
- Table name (large/bold)
- Order type
- Divider
- Items list: quantity × name
  - Per-item notes/modifications on indented line below
- Timestamp
- Divider + cut command

**Key ESC/POS commands used:**
- `ESC @` — initialize printer
- `ESC E` — bold on/off
- `GS !` — character size
- `ESC a` — text alignment (left/center/right)
- `ESC d` — feed lines
- `GS V` — paper cut

**Paper width handling:**
- 58mm = 32 characters per line
- 80mm = 48 characters per line
- Accept `charsPerLine` parameter derived from `paperWidth`

**Verification:** Generate ESC/POS bytes and verify structure matches expected format.

---

## Task 5: Create Zustand printer store

**File to create:**
- `apps/native/src/features/settings/stores/usePrinterStore.ts`

**Purpose:** Global state for printer connections, auto-reconnect, and print operations. Uses Zustand — no provider needed. Wraps Task 2 + Task 3 services.

```typescript
interface PrinterStore {
  // State
  printers: PrinterConfig[];
  connectionStatus: Record<string, boolean>; // address -> connected
  isScanning: boolean;
  kitchenPrintingEnabled: boolean;
  isInitialized: boolean;

  // Actions
  initialize(): Promise<void>;  // load from storage + auto-reconnect
  scanForDevices(): Promise<BluetoothDevice[]>;
  connectPrinter(address: string): Promise<boolean>;
  disconnectPrinter(address: string): Promise<void>;
  addPrinter(device: BluetoothDevice, role: "receipt" | "kitchen", paperWidth: 58 | 80): Promise<void>;
  removePrinter(id: string): Promise<void>;
  updatePrinter(id: string, updates: Partial<PrinterConfig>): Promise<void>;
  setKitchenPrintingEnabled(enabled: boolean): Promise<void>;

  // Print operations
  printReceipt(data: ReceiptData): Promise<void>;
  printKitchenTicket(data: KitchenTicketData): Promise<void>;
  testPrint(address: string): Promise<void>;
}

export const usePrinterStore = create<PrinterStore>((set, get) => ({
  // ... implementation
}));
```

**Auto-reconnect logic (called via `initialize()`):**
1. Load saved printers from storage
2. For each saved printer, attempt connection
3. If any fail, return list of failed printers (caller shows dialog)

**No provider wrapper needed** — Zustand stores are imported directly.

**Verification:** Store provides printer state and operations, accessible from any component via `usePrinterStore()`.

---

## Task 6: Initialize printer store on app startup

**File to modify:**
- `apps/native/App.tsx`

**Change:** Call `usePrinterStore.getState().initialize()` after auth is loaded. No provider wrapping needed — just a `useEffect` in the Navigation component or a small hook that runs once after auth.

**Verification:** App renders without errors, printer store initializes and attempts reconnect.

---

## Task 7: Add Settings navigation

**Files to modify:**
- `apps/native/src/navigation/Navigation.tsx` — add SettingsScreen and PrinterSettingsScreen to stack

**Add to RootStackParamList:**
```typescript
SettingsScreen: undefined;
PrinterSettingsScreen: { printerId?: string }; // optional: edit specific printer
```

**Add screen entries in the Stack.Navigator.**

**Verification:** Navigation type-checks and screens are reachable.

---

## Task 8: Add settings gear icon to Header

**File to modify:**
- `apps/native/src/features/tables/components/Header.tsx`

**Change:** Add a gear icon button next to the logout button. The right side becomes:

```
[⚙ Settings]  [🚪 Logout]
```

Use existing `IconButton` component with `icon="settings-outline"` (Ionicons).

**File to modify:**
- `apps/native/src/features/tables/screens/TablesScreen.tsx`

**Change:** Pass `onSettings` handler to Header, which navigates to SettingsScreen.

**Verification:** Gear icon visible in header, tapping navigates to Settings.

---

## Task 9: Create SettingsScreen

**File to create:**
- `apps/native/src/features/settings/screens/SettingsScreen.tsx`

**Layout:**
```
┌────────────────────────────────────────┐
│ ← Back          Settings               │
├────────────────────────────────────────┤
│                                        │
│  🖨 Printers                      →   │
│     2 printers configured              │
│                                        │
│  (future settings sections here)       │
│                                        │
└────────────────────────────────────────┘
```

Simple list of settings categories. For now, only "Printers" entry that navigates to PrinterSettingsScreen.

**Verification:** Screen renders, "Printers" row navigates correctly.

---

## Task 10: Create PrinterSettingsScreen

**File to create:**
- `apps/native/src/features/settings/screens/PrinterSettingsScreen.tsx`

**Layout:**
```
┌──────────────────────────────────────────────────┐
│ ← Back          Printers                         │
├──────────────────────────────────────────────────┤
│                                                  │
│  Kitchen Printing          [Toggle: OFF]         │
│  Enable to print kitchen tickets at checkout     │
│                                                  │
│  ─────────────────────────────────────────────── │
│                                                  │
│  PAIRED PRINTERS                                 │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │ 🖨 Front Counter Printer                │   │
│  │   Role: Receipt  |  Paper: 80mm         │   │
│  │   ● Connected                            │   │
│  │   [Test Print]  [Edit]  [Remove]         │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │ 🖨 Kitchen Printer                      │   │
│  │   Role: Kitchen  |  Paper: 58mm         │   │
│  │   ○ Disconnected                         │   │
│  │   [Test Print]  [Edit]  [Remove]         │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ─────────────────────────────────────────────── │
│                                                  │
│  [🔍 Scan for Printers]                         │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Features:**
- Kitchen printing toggle at top
- List of paired printers with status indicators (green dot = connected, gray = disconnected)
- Each printer card shows: name, role, paper width, connection status
- Action buttons: Test Print, Edit (opens edit modal), Remove (with confirmation)
- "Scan for Printers" button at bottom opens scan modal

**Verification:** Screen renders, shows paired printers from context, toggle works.

---

## Task 11: Create ScanPrintersModal

**File to create:**
- `apps/native/src/features/settings/components/ScanPrintersModal.tsx`

**Layout (bottom modal):**
```
┌──────────────────────────────────────────┐
│  Scan for Printers              [Close]  │
├──────────────────────────────────────────┤
│                                          │
│  🔄 Scanning...                          │
│                                          │
│  Found Devices:                          │
│  ┌────────────────────────────────────┐  │
│  │ BlueTooth Printer XP-58            │  │
│  │ [Add as Receipt] [Add as Kitchen]  │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │ POS-80 Thermal                     │  │
│  │ [Add as Receipt] [Add as Kitchen]  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [🔄 Scan Again]                         │
│                                          │
└──────────────────────────────────────────┘
```

**Flow:**
1. Opens → starts scanning automatically
2. Shows found Bluetooth devices (filtered: excludes already-paired ones)
3. Tap "Add as Receipt" or "Add as Kitchen" → prompts for paper width (58mm/80mm) → adds printer
4. Scan Again button to rescan

**Verification:** Modal opens, shows Bluetooth devices, adding a device persists it.

---

## Task 12: Create EditPrinterModal

**File to create:**
- `apps/native/src/features/settings/components/EditPrinterModal.tsx`

**Layout (center modal):**
```
┌────────────────────────────────┐
│  Edit Printer          [Close] │
├────────────────────────────────┤
│                                │
│  Name                          │
│  [Front Counter Printer    ]   │
│                                │
│  Role                          │
│  [Receipt ▼]                   │
│                                │
│  Paper Width                   │
│  (58mm)  (80mm)                │
│                                │
│  [Save Changes]                │
│                                │
└────────────────────────────────┘
```

**Verification:** Editing a printer updates its config in storage and context.

---

## Task 13: Create ReceiptPreviewModal

**File to create:**
- `apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx`

**Purpose:** Replaces the current Alert dialog after payment. Shows receipt preview with print/skip actions.

**Layout (center modal, landscape-optimized):**
```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │                      │    │                              │  │
│  │   STORE NAME         │    │  Print to:                   │  │
│  │   Address            │    │  🖨 Front Counter Printer    │  │
│  │   ─────────────      │    │  ● Connected | 80mm          │  │
│  │   Receipt #: 001     │    │                              │  │
│  │   Date: ...          │    │  ─────────────────────────── │  │
│  │   ─────────────      │    │                              │  │
│  │   ORDER ITEMS        │    │  💰 Change Due: ₱250.00     │  │
│  │   2x Chicken  ₱500  │    │                              │  │
│  │   1x Rice     ₱50   │    │  ─────────────────────────── │  │
│  │   ─────────────      │    │                              │  │
│  │   TOTAL: ₱550.00    │    │  [🖨 Print Receipt]          │  │
│  │   ─────────────      │    │                              │  │
│  │   Cash: ₱800.00     │    │  [Skip]                      │  │
│  │   Change: ₱250.00   │    │                              │  │
│  │   ─────────────      │    │                              │  │
│  │   Thank you!         │    │                              │  │
│  │                      │    │                              │  │
│  └──────────────────────┘    └──────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Left panel:** Scrollable receipt preview rendered as React Native views (not HTML WebView — faster and native-feeling). Uses the existing `ReceiptData` to render a visual representation.

**Right panel:**
- Target printer name + status + paper width
- Change due amount (prominent, for cash transactions only)
- "Print Receipt" primary button — sends ESC/POS to Bluetooth printer
- "Skip" secondary button — dismisses and navigates to tables
- If no printer configured: show "No printer configured" with link to Settings

**Props:**
```typescript
interface ReceiptPreviewModalProps {
  visible: boolean;
  receiptData: ReceiptData;
  onPrint: () => void;
  onSkip: () => void;
}
```

**Verification:** Modal renders with receipt preview, buttons trigger callbacks.

---

## Task 14: Update CheckoutScreen post-payment flow

**File to modify:**
- `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`

**Changes:**

1. Add state: `showReceiptPreview` (boolean), `completedReceiptData` (ReceiptData | null)
2. Replace the `Alert.alert("Payment Successful", ...)` block (lines ~237-271) with:
   ```typescript
   // After successful payment:
   setCompletedReceiptData(createReceiptData(finalChange, ...));
   setShowReceiptPreview(true);
   ```

3. Add `ReceiptPreviewModal` to the render tree:
   ```typescript
   <ReceiptPreviewModal
     visible={showReceiptPreview}
     receiptData={completedReceiptData}
     onPrint={async () => {
       await printReceipt(completedReceiptData); // uses PrinterContext
       // If kitchen printing enabled, also print kitchen ticket
       if (kitchenPrintingEnabled) {
         await printKitchenTicket(kitchenData);
       }
       navigation.reset({ index: 0, routes: [{ name: "TablesScreen" }] });
     }}
     onSkip={() => {
       navigation.reset({ index: 0, routes: [{ name: "TablesScreen" }] });
     }}
   />
   ```

4. The `onPrint` handler:
   - Calls `printReceipt()` from PrinterContext (sends to Bluetooth receipt printer)
   - If kitchen printing enabled AND kitchen printer configured, also calls `printKitchenTicket()`
   - Then navigates to TablesScreen

**Verification:** After checkout, receipt preview modal appears. Print sends to Bluetooth. Skip goes to tables.

---

## Task 15: Create feature barrel exports and index files

**Files to create:**
- `apps/native/src/features/settings/index.ts`
- `apps/native/src/features/settings/screens/index.ts`
- `apps/native/src/features/settings/components/index.ts`
- `apps/native/src/features/settings/services/index.ts`
- `apps/native/src/features/settings/stores/index.ts`

**Purpose:** Follow existing barrel export pattern from other features.

**Verification:** All imports resolve correctly.

---

## Task 16: Auto-reconnect failure dialog

**File to modify:**
- `apps/native/src/features/settings/stores/usePrinterStore.ts` (part of Task 5, but separate concern)

**Behavior on app startup (after auth loads):**
1. Load saved printer configs
2. Attempt to connect each saved printer
3. If any fail:
   - Show Alert dialog:
     - Title: "Printer Connection Failed"
     - Message: "Could not connect to: {printer names}. Please check the printer is turned on and in range."
     - Buttons: "Retry" (re-attempts), "Settings" (navigates to printer settings), "Dismiss"
4. If all succeed: silent, no dialog

**Navigation from store:** Will use a root navigation ref or pass navigation callback from the component that calls `initialize()`.

**Verification:** Turn off a paired printer, restart app, see reconnect failure dialog.

---

## Execution Order

```
Task 1  → Install dependencies
Task 2  → Printer storage service
Task 3  → Bluetooth printer service  (depends on Task 1)
Task 4  → ESC/POS formatter          (depends on Task 2 for types)
Task 5  → PrinterContext              (depends on Tasks 2, 3, 4)
Task 6  → Wire into App.tsx           (depends on Task 5)
Task 7  → Navigation updates          (depends on Task 6)
Task 8  → Header gear icon            (depends on Task 7)
Task 9  → SettingsScreen              (depends on Task 7)
Task 10 → PrinterSettingsScreen       (depends on Tasks 5, 9)
Task 11 → ScanPrintersModal           (depends on Tasks 3, 5)
Task 12 → EditPrinterModal            (depends on Task 5)
Task 13 → ReceiptPreviewModal         (depends on Tasks 4, 5)
Task 14 → Update CheckoutScreen       (depends on Tasks 5, 13)
Task 15 → Barrel exports              (depends on all feature files)
Task 16 → Auto-reconnect dialog       (depends on Task 5)
```

**Parallelizable batches:**
- Batch 1: Tasks 1, 2
- Batch 2: Tasks 3, 4 (after Batch 1)
- Batch 3: Task 5 (after Batch 2)
- Batch 4: Tasks 6, 7 (after Batch 3)
- Batch 5: Tasks 8, 9, 11, 12, 13 (after Batch 4 — independent UI components)
- Batch 6: Tasks 10, 14, 15, 16 (after Batch 5 — integration)
