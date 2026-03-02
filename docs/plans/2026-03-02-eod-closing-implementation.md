# End-of-Day Closing & Batch Receipt Reprint — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Day Closing screen to the native app that displays a Z-Report summary (printable to thermal) and lets managers batch-reprint all receipts for a given day.

**Architecture:** New `day-closing` feature module in the native app with a dedicated screen pushed from the Home header. Reuses existing backend functions (`getDailyReport`, `generateDailyReport`, `getOrderHistory`, `getReceipt`, `logReceiptReprint`). One new backend mutation (`logDayClosing`) for audit trail. New ESC/POS formatter for Z-Report thermal printing.

**Tech Stack:** React Native (Expo 54), Tamagui, Convex (backend), BluetoothEscposPrinter (ESC/POS), FlashList, Zustand (printer store)

**Key Patterns (reference these files for conventions):**
- Icon buttons: `apps/native/src/features/shared/components/ui/IconButton.tsx`
- ESC/POS formatting: `apps/native/src/features/settings/services/escposFormatter.ts`
- Receipt data type: `apps/native/src/features/shared/utils/receipt.ts` (ReceiptData interface)
- Printer store: `apps/native/src/features/settings/stores/usePrinterStore.ts` (printReceipt method)
- Navigation: `apps/native/src/navigation/Navigation.tsx` (RootStackParamList + Stack.Screen)
- Auth/permissions: `apps/native/src/features/auth/context/AuthContext.tsx` (hasPermission)
- Audit logging: `packages/backend/convex/checkout.ts:336-365` (logReceiptReprint pattern)
- Permissions list: `packages/backend/convex/lib/permissions.ts` (existing `reports.print_eod` and `checkout.reprint`)

---

### Task 1: Backend — Add `logDayClosing` mutation

**Files:**
- Create: `packages/backend/convex/closing.ts`

**Step 1: Create the closing.ts file with logDayClosing mutation**

Follow the exact pattern from `logReceiptReprint` in `packages/backend/convex/checkout.ts:336-365`.

```typescript
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";

export const logDayClosing = mutation({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "day_closing",
      entityType: "dailyReports",
      entityId: args.reportDate,
      details: JSON.stringify({
        reportDate: args.reportDate,
        closedBy: user.name ?? "Unknown",
      }),
      userId: user._id,
      createdAt: Date.now(),
    });

    return null;
  },
});
```

**Step 2: Verify backend types**

Run: `cd packages/backend && npx convex dev --once`

Expected: No type errors, `api.closing.logDayClosing` generated.

**Step 3: Commit**

```bash
git add packages/backend/convex/closing.ts
git commit -m "feat: add logDayClosing audit mutation for EOD closing"
```

---

### Task 2: Navigation — Register DayClosingScreen

**Files:**
- Modify: `apps/native/src/navigation/Navigation.tsx:28-55` (RootStackParamList) and `:122-133` (Stack.Screen entries)

**Step 1: Add DayClosingScreen to RootStackParamList**

In `apps/native/src/navigation/Navigation.tsx`, add to the type definition (after line 54, before the closing `}`):

```typescript
DayClosingScreen: undefined;
```

**Step 2: Add the import**

After line 13 (`import { HomeScreen } from "../features/home";`), add:

```typescript
import { DayClosingScreen } from "../features/day-closing";
```

**Step 3: Register the screen**

After line 128 (`<Stack.Screen name="OrderDetailScreen" component={OrderDetailScreen} />`), add:

```typescript
<Stack.Screen name="DayClosingScreen" component={DayClosingScreen} />
```

**Note:** This will cause an import error until Task 4 creates the actual screen. That's expected — we're wiring navigation first so subsequent tasks can reference it.

**Step 4: Commit**

```bash
git add apps/native/src/navigation/Navigation.tsx
git commit -m "feat: register DayClosingScreen in navigation stack"
```

---

### Task 3: Home Header — Add "Close Day" button

**Files:**
- Modify: `apps/native/src/features/home/components/HomeHeader.tsx`
- Modify: `apps/native/src/features/home/screens/HomeScreen.tsx`

**Step 1: Add onDayClosing prop to HomeHeader**

In `apps/native/src/features/home/components/HomeHeader.tsx`:

Update the interface (lines 6-11) to add the new callback:

```typescript
interface HomeHeaderProps {
  userName: string;
  onLogout: () => void;
  onSettings: () => void;
  onOrderHistory: () => void;
  onDayClosing?: () => void;
}
```

Update the destructuring (line 13):

```typescript
export const HomeHeader = ({ userName, onLogout, onSettings, onOrderHistory, onDayClosing }: HomeHeaderProps) => {
```

Add the icon button (between line 46 settings and line 47 logout):

```tsx
{onDayClosing && (
  <IconButton icon="today-outline" onPress={onDayClosing} />
)}
```

**Step 2: Pass the callback from HomeScreen**

In `apps/native/src/features/home/screens/HomeScreen.tsx`, update the `<HomeHeader>` usage (lines 61-66):

```tsx
<HomeHeader
  userName={user?.name ?? "User"}
  onLogout={handleLogout}
  onSettings={() => navigation.navigate("SettingsScreen")}
  onOrderHistory={() => navigation.navigate("OrderHistoryScreen")}
  onDayClosing={
    user?.role?.permissions?.includes("reports.print_eod")
      ? () => navigation.navigate("DayClosingScreen")
      : undefined
  }
/>
```

This shows the button only for users with the `reports.print_eod` permission.

**Step 3: Commit**

```bash
git add apps/native/src/features/home/components/HomeHeader.tsx apps/native/src/features/home/screens/HomeScreen.tsx
git commit -m "feat: add Close Day icon button to home header (permission-gated)"
```

---

### Task 4: Z-Report Thermal Formatter

**Files:**
- Create: `apps/native/src/features/day-closing/utils/zReportFormatter.ts`

**Step 1: Create the Z-Report ESC/POS formatter**

Follow the exact pattern from `printReceiptToThermal` in `apps/native/src/features/settings/services/escposFormatter.ts`. Use the same helpers (`formatRow`, `formatCurrency`, `line`, `bold`, `normal`, `large`, `ALIGN`).

```typescript
import { BluetoothEscposPrinter } from "@vardrz/react-native-bluetooth-escpos-printer";

interface ZReportData {
  storeName: string;
  storeAddress?: string;
  storeTin?: string;
  reportDate: string;
  grossSales: number;
  netSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  nonVatSales: number;
  seniorDiscounts: number;
  pwdDiscounts: number;
  promoDiscounts: number;
  manualDiscounts: number;
  totalDiscounts: number;
  voidCount: number;
  voidAmount: number;
  cashTotal: number;
  cardEwalletTotal: number;
  transactionCount: number;
  averageTicket: number;
  generatedByName: string;
}

const line = (char: string, width: number): string => char.repeat(width);

const formatRow = (left: string, right: string, width: number): string => {
  const gap = width - left.length - right.length;
  if (gap < 1) return left.slice(0, width - right.length - 1) + " " + right;
  return left + " ".repeat(gap) + right;
};

const formatCurrency = (amount: number): string => {
  const formatted = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `P ${formatted}`;
};

const ALIGN = BluetoothEscposPrinter.ALIGN;
const normal = () => ({ encoding: "UTF-8", widthtimes: 0, heigthtimes: 0, fonttype: 0 });
const bold = () => ({ encoding: "UTF-8", widthtimes: 0, heigthtimes: 1, fonttype: 0 });
const large = () => ({ encoding: "UTF-8", widthtimes: 1, heigthtimes: 1, fonttype: 0 });

export type { ZReportData };

export async function printZReportToThermal(
  data: ZReportData,
  charsPerLine: number,
): Promise<void> {
  const w = charsPerLine;
  const p = BluetoothEscposPrinter;

  // Header
  await p.printerAlign(ALIGN.CENTER);
  await p.printText(`${data.storeName}\n`, bold());
  if (data.storeAddress) await p.printText(`${data.storeAddress}\n`, normal());
  if (data.storeTin) await p.printText(`TIN: ${data.storeTin}\n`, normal());
  await p.printText("\n", normal());
  await p.printText("Z-REPORT / END OF DAY\n", large());
  await p.printText(`${data.reportDate}\n`, bold());
  await p.printText(`${line("=", w)}\n`, normal());

  // Sales Summary
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${formatRow("Gross Sales", formatCurrency(data.grossSales), w)}\n`, bold());
  await p.printText(`${formatRow("Less: Discounts", `-${formatCurrency(data.totalDiscounts)}`, w)}\n`, normal());
  await p.printText(`${formatRow("Less: Voids", `-${formatCurrency(data.voidAmount)}`, w)}\n`, normal());
  await p.printText(`${line("-", w)}\n`, normal());
  await p.printText(`${formatRow("NET SALES", formatCurrency(data.netSales), w)}\n`, bold());
  await p.printText("\n", normal());

  // Transaction Count
  await p.printText(`${formatRow("Transactions", String(data.transactionCount), w)}\n`, normal());
  await p.printText(`${formatRow("Average Ticket", formatCurrency(data.averageTicket), w)}\n`, normal());
  await p.printText(`${line("-", w)}\n`, normal());

  // Payment Breakdown
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("PAYMENT BREAKDOWN\n", bold());
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${formatRow("Cash", formatCurrency(data.cashTotal), w)}\n`, normal());
  await p.printText(`${formatRow("Card/E-Wallet", formatCurrency(data.cardEwalletTotal), w)}\n`, normal());
  await p.printText(`${line("-", w)}\n`, normal());

  // Discount Breakdown
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("DISCOUNT BREAKDOWN\n", bold());
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${formatRow("Senior Citizen", formatCurrency(data.seniorDiscounts), w)}\n`, normal());
  await p.printText(`${formatRow("PWD", formatCurrency(data.pwdDiscounts), w)}\n`, normal());
  await p.printText(`${formatRow("Promo", formatCurrency(data.promoDiscounts), w)}\n`, normal());
  await p.printText(`${formatRow("Manual", formatCurrency(data.manualDiscounts), w)}\n`, normal());
  await p.printText(`${line("-", w)}\n`, normal());

  // Voids
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("VOIDS\n", bold());
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${formatRow("Void Count", String(data.voidCount), w)}\n`, normal());
  await p.printText(`${formatRow("Void Amount", formatCurrency(data.voidAmount), w)}\n`, normal());
  await p.printText(`${line("-", w)}\n`, normal());

  // VAT Summary
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("VAT SUMMARY\n", bold());
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${formatRow("VATable Sales", formatCurrency(data.vatableSales), w)}\n`, normal());
  await p.printText(`${formatRow("VAT Amount (12%)", formatCurrency(data.vatAmount), w)}\n`, normal());
  await p.printText(`${formatRow("VAT-Exempt", formatCurrency(data.vatExemptSales), w)}\n`, normal());
  await p.printText(`${formatRow("Non-VAT", formatCurrency(data.nonVatSales), w)}\n`, normal());
  await p.printText(`${line("=", w)}\n`, normal());

  // Footer
  await p.printerAlign(ALIGN.CENTER);
  await p.printText(`\nGenerated by: ${data.generatedByName}\n`, normal());
  await p.printText(`Printed: ${new Date().toLocaleString("en-PH")}\n`, normal());
  await p.printText("This is a system-generated report\n", normal());
  const feed = charsPerLine >= 48 ? "\n\n\n\n\n\n" : "\n\n\n";
  await p.printText(`Powered by PMGT Flow Suite${feed}`, {
    ...normal(),
    cut: true,
  });
}
```

**Step 2: Commit**

```bash
git add apps/native/src/features/day-closing/utils/zReportFormatter.ts
git commit -m "feat: add Z-Report ESC/POS thermal printer formatter"
```

---

### Task 5: Batch Print Hook

**Files:**
- Create: `apps/native/src/features/day-closing/hooks/useBatchPrint.ts`

**Step 1: Create the batch print hook**

This hook manages the state and logic for printing multiple receipts sequentially. It uses the existing `usePrinterStore` for thermal printing and Convex mutations for audit logging.

```typescript
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";

interface BatchPrintState {
  isPrinting: boolean;
  currentIndex: number;
  totalCount: number;
  failedOrderIds: Id<"orders">[];
}

export function useBatchPrint() {
  const [state, setState] = useState<BatchPrintState>({
    isPrinting: false,
    currentIndex: 0,
    totalCount: 0,
    failedOrderIds: [],
  });
  const cancelledRef = useRef(false);

  const logReprint = useMutation(api.checkout.logReceiptReprint);
  const { printReceipt: printToThermal } = usePrinterStore();

  const printBatch = useCallback(
    async (orderIds: Id<"orders">[], getReceiptData: (orderId: Id<"orders">) => Promise<any>) => {
      cancelledRef.current = false;
      const failed: Id<"orders">[] = [];

      setState({
        isPrinting: true,
        currentIndex: 0,
        totalCount: orderIds.length,
        failedOrderIds: [],
      });

      for (let i = 0; i < orderIds.length; i++) {
        if (cancelledRef.current) break;

        setState((prev) => ({ ...prev, currentIndex: i + 1 }));

        try {
          const receiptData = await getReceiptData(orderIds[i]);
          if (receiptData) {
            await printToThermal(receiptData);
            await logReprint({ orderId: orderIds[i] });
          }
        } catch (error) {
          console.error(`Failed to print order ${orderIds[i]}:`, error);
          failed.push(orderIds[i]);
        }
      }

      setState((prev) => ({
        ...prev,
        isPrinting: false,
        failedOrderIds: failed,
      }));

      if (failed.length > 0 && !cancelledRef.current) {
        Alert.alert(
          "Batch Print Complete",
          `${orderIds.length - failed.length} of ${orderIds.length} receipts printed successfully. ${failed.length} failed.`,
        );
      } else if (!cancelledRef.current) {
        Alert.alert("Success", `All ${orderIds.length} receipts printed successfully.`);
      }
    },
    [logReprint, printToThermal],
  );

  const cancelBatch = useCallback(() => {
    cancelledRef.current = true;
    setState((prev) => ({ ...prev, isPrinting: false }));
  }, []);

  return {
    ...state,
    printBatch,
    cancelBatch,
  };
}
```

**Step 2: Commit**

```bash
git add apps/native/src/features/day-closing/hooks/useBatchPrint.ts
git commit -m "feat: add useBatchPrint hook for sequential receipt printing"
```

---

### Task 6: PrintProgressModal Component

**Files:**
- Create: `apps/native/src/features/day-closing/components/PrintProgressModal.tsx`

**Step 1: Create the progress modal**

Follow the modal pattern from CLAUDE.md (sticky footer, RNModal). Use Tamagui `XStack`/`YStack` for layout. Keep touch targets >= 48px per POS design rules.

```tsx
import { Ionicons } from "@expo/vector-icons";
import { Modal as RNModal, Pressable, StyleSheet } from "react-native";
import { XStack, YStack } from "tamagui";
import { Button, Text } from "../../shared/components/ui";

interface PrintProgressModalProps {
  visible: boolean;
  currentIndex: number;
  totalCount: number;
  onCancel: () => void;
}

export const PrintProgressModal = ({
  visible,
  currentIndex,
  totalCount,
  onCancel,
}: PrintProgressModalProps) => {
  const progress = totalCount > 0 ? currentIndex / totalCount : 0;

  return (
    <RNModal visible={visible} transparent animationType="fade">
      <Pressable style={styles.backdrop}>
        <YStack
          backgroundColor="$white"
          borderRadius={16}
          padding={24}
          marginHorizontal={40}
          alignItems="center"
          gap={16}
        >
          <Ionicons name="print-outline" size={40} color="#0D87E1" />
          <Text variant="heading" size="lg">
            Printing Receipts
          </Text>
          <Text variant="muted" size="base">
            {currentIndex} of {totalCount}
          </Text>

          {/* Progress bar */}
          <YStack
            width="100%"
            height={8}
            backgroundColor="#E5E7EB"
            borderRadius={4}
            overflow="hidden"
          >
            <YStack
              height="100%"
              backgroundColor="#0D87E1"
              borderRadius={4}
              width={`${progress * 100}%` as any}
            />
          </YStack>

          <Button
            variant="destructive"
            size="lg"
            style={{ width: "100%", marginTop: 8 }}
            onPress={onCancel}
          >
            <XStack alignItems="center" justifyContent="center" gap={8}>
              <Ionicons name="close-circle-outline" size={20} color="#DC2626" />
              <Text style={{ color: "#DC2626", fontWeight: "600" }}>Cancel</Text>
            </XStack>
          </Button>
        </YStack>
      </Pressable>
    </RNModal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
});
```

**Step 2: Commit**

```bash
git add apps/native/src/features/day-closing/components/PrintProgressModal.tsx
git commit -m "feat: add PrintProgressModal for batch print progress display"
```

---

### Task 7: ZReportSummary Component

**Files:**
- Create: `apps/native/src/features/day-closing/components/ZReportSummary.tsx`

**Step 1: Create the Z-Report summary card**

Displays the daily report data in a compact card. Uses Tamagui layout with POS design conventions (large numbers, high information density, color-coded sections).

```tsx
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { useFormatCurrency } from "../../shared/hooks";
import { Card, Text } from "../../shared/components/ui";

interface ZReportData {
  grossSales: number;
  netSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  totalDiscounts: number;
  voidCount: number;
  voidAmount: number;
  cashTotal: number;
  cardEwalletTotal: number;
  transactionCount: number;
  averageTicket: number;
}

interface ZReportSummaryProps {
  report: ZReportData | null;
  isLoading: boolean;
  onPrintZReport: () => void;
  isPrintingZReport: boolean;
}

const StatBox = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <YStack
    flex={1}
    backgroundColor="#F9FAFB"
    borderRadius={10}
    paddingVertical={12}
    paddingHorizontal={8}
    alignItems="center"
  >
    <Text style={{ fontSize: 22, fontWeight: "700", color }}>{value}</Text>
    <Text variant="muted" style={{ fontSize: 11, marginTop: 2 }}>
      {label}
    </Text>
  </YStack>
);

export const ZReportSummary = ({
  report,
  isLoading,
  onPrintZReport,
  isPrintingZReport,
}: ZReportSummaryProps) => {
  const formatCurrency = useFormatCurrency();

  if (isLoading) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <Text variant="muted">Loading report...</Text>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <Text variant="muted">No report data for this date. Generate it first.</Text>
      </Card>
    );
  }

  return (
    <YStack gap={12}>
      {/* Top stats row */}
      <XStack gap={8}>
        <StatBox label="Gross Sales" value={formatCurrency(report.grossSales)} color="#111827" />
        <StatBox label="Net Sales" value={formatCurrency(report.netSales)} color="#16A34A" />
        <StatBox label="Transactions" value={String(report.transactionCount)} color="#0D87E1" />
      </XStack>

      {/* Detail rows */}
      <YStack
        backgroundColor="$white"
        borderRadius={12}
        padding={16}
        borderWidth={1}
        borderColor="$gray200"
        gap={8}
      >
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">Cash</Text>
          <Text size="sm" style={{ fontWeight: "600" }}>{formatCurrency(report.cashTotal)}</Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">Card/E-Wallet</Text>
          <Text size="sm" style={{ fontWeight: "600" }}>{formatCurrency(report.cardEwalletTotal)}</Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">Discounts</Text>
          <Text size="sm" style={{ fontWeight: "600", color: "#DC2626" }}>
            -{formatCurrency(report.totalDiscounts)}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">Voids ({report.voidCount})</Text>
          <Text size="sm" style={{ fontWeight: "600", color: "#DC2626" }}>
            -{formatCurrency(report.voidAmount)}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">VAT (12%)</Text>
          <Text size="sm" style={{ fontWeight: "600" }}>{formatCurrency(report.vatAmount)}</Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">Avg. Ticket</Text>
          <Text size="sm" style={{ fontWeight: "600" }}>{formatCurrency(report.averageTicket)}</Text>
        </XStack>
      </YStack>

      {/* Print Z-Report button */}
      <TouchableOpacity
        onPress={onPrintZReport}
        disabled={isPrintingZReport}
        activeOpacity={0.7}
        style={[
          styles.printButton,
          isPrintingZReport && { opacity: 0.6 },
        ]}
      >
        <Ionicons name="print-outline" size={20} color="#0D87E1" />
        <Text style={{ color: "#0D87E1", fontWeight: "600", fontSize: 15, marginLeft: 8 }}>
          {isPrintingZReport ? "Printing..." : "Print Z-Report"}
        </Text>
      </TouchableOpacity>
    </YStack>
  );
};

const styles = StyleSheet.create({
  printButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DBEAFE",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#93C5FD",
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
});
```

**Step 2: Commit**

```bash
git add apps/native/src/features/day-closing/components/ZReportSummary.tsx
git commit -m "feat: add ZReportSummary component for day closing screen"
```

---

### Task 8: OrderSelectionItem Component (Memoized)

**Files:**
- Create: `apps/native/src/features/day-closing/components/OrderSelectionItem.tsx`

**Step 1: Create the memoized list item**

Per React Native performance rules:
- Wrap in `React.memo` (list-performance-item-memo)
- No inline style objects (list-performance-inline-objects)
- Extract StyleSheet outside component

```tsx
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Badge, Text } from "../../shared/components/ui";

interface OrderItem {
  _id: Id<"orders">;
  orderNumber: string;
  orderType: "dine_in" | "takeout";
  status: "open" | "paid" | "voided";
  netSales: number;
  createdAt: number;
  paymentMethod?: "cash" | "card_ewallet";
}

interface OrderSelectionItemProps {
  order: OrderItem;
  isSelected: boolean;
  onToggle: (orderId: Id<"orders">) => void;
  formatCurrency: (amount: number) => string;
}

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const OrderSelectionItem = React.memo(
  ({ order, isSelected, onToggle, formatCurrency }: OrderSelectionItemProps) => {
    const isVoided = order.status === "voided";

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onToggle(order._id)}
        style={[
          styles.container,
          isSelected && styles.containerSelected,
          isVoided && styles.containerVoided,
        ]}
      >
        <XStack alignItems="center" gap={12} flex={1}>
          {/* Checkbox */}
          <Ionicons
            name={isSelected ? "checkbox" : "square-outline"}
            size={24}
            color={isSelected ? "#0D87E1" : "#9CA3AF"}
          />

          {/* Order info */}
          <YStack flex={1} gap={2}>
            <XStack alignItems="center" gap={8}>
              <Text style={styles.orderNumber}>#{order.orderNumber}</Text>
              <Badge
                variant={order.orderType === "dine_in" ? "default" : "warning"}
                size="sm"
              >
                <Text style={styles.badgeText}>
                  {order.orderType === "dine_in" ? "Dine-In" : "Takeout"}
                </Text>
              </Badge>
              {isVoided && (
                <Badge variant="destructive" size="sm">
                  <Text style={styles.voidedBadgeText}>VOIDED</Text>
                </Badge>
              )}
            </XStack>
            <XStack alignItems="center" gap={8}>
              <Text variant="muted" size="xs">{formatTime(order.createdAt)}</Text>
              {order.paymentMethod && (
                <Text variant="muted" size="xs">
                  {order.paymentMethod === "cash" ? "Cash" : "Card"}
                </Text>
              )}
            </XStack>
          </YStack>

          {/* Amount */}
          <Text style={[styles.amount, isVoided && styles.amountVoided]}>
            {formatCurrency(order.netSales)}
          </Text>
        </XStack>
      </TouchableOpacity>
    );
  },
);

OrderSelectionItem.displayName = "OrderSelectionItem";

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 8,
  },
  containerSelected: {
    backgroundColor: "#EFF6FF",
    borderColor: "#93C5FD",
  },
  containerVoided: {
    opacity: 0.6,
  },
  orderNumber: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  voidedBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#DC2626",
  },
  amount: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  amountVoided: {
    textDecorationLine: "line-through",
    color: "#9CA3AF",
  },
});
```

**Step 2: Commit**

```bash
git add apps/native/src/features/day-closing/components/OrderSelectionItem.tsx
git commit -m "feat: add memoized OrderSelectionItem for batch reprint list"
```

---

### Task 9: DayClosingScreen — Main Screen

**Files:**
- Create: `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx`
- Create: `apps/native/src/features/day-closing/index.ts` (barrel export)

**Step 1: Create the main screen**

This is the core screen that composes ZReportSummary, the order FlatList, and PrintProgressModal. Uses Convex queries for real-time data, FlatList for the order list (with memoized items), and Zustand printer store for thermal printing.

```tsx
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  SafeAreaView,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { Button, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import type { ReceiptData } from "../../shared/utils/receipt";
import { OrderSelectionItem } from "../components/OrderSelectionItem";
import { PrintProgressModal } from "../components/PrintProgressModal";
import { ZReportSummary } from "../components/ZReportSummary";
import { useBatchPrint } from "../hooks/useBatchPrint";
import { printZReportToThermal } from "../utils/zReportFormatter";

interface DayClosingScreenProps {
  navigation: any;
}

const formatDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getDateRange = (date: Date): { start: number; end: number } => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
};

export const DayClosingScreen = ({ navigation }: DayClosingScreenProps) => {
  const { user } = useAuth();
  const formatCurrency = useFormatCurrency();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<Id<"orders">>>(new Set());
  const [isPrintingZReport, setIsPrintingZReport] = useState(false);

  const storeId = user?.storeId;
  const reportDate = formatDateKey(selectedDate);
  const { start, end } = useMemo(() => getDateRange(selectedDate), [selectedDate]);

  // Queries
  const report = useQuery(
    api.reports.getDailyReport,
    storeId ? { storeId, reportDate } : "skip",
  );

  const orders = useQuery(
    api.orders.getOrderHistory,
    storeId ? { storeId, startDate: start, endDate: end } : "skip",
  );

  // Mutations
  const generateReport = useMutation(api.reports.generateDailyReport);
  const logDayClosing = useMutation(api.closing.logDayClosing);

  // Batch print
  const { isPrinting, currentIndex, totalCount, printBatch, cancelBatch } = useBatchPrint();
  const { printReceipt: printToThermal } = usePrinterStore();
  const charsPerLine = usePrinterStore((s) => {
    const printers = s.printers;
    const receipt = printers.find((p) => p.type === "receipt");
    return receipt?.charsPerLine ?? 32;
  });

  // Auto-select paid orders when orders load
  useEffect(() => {
    if (orders) {
      const paidIds = new Set(
        orders.filter((o) => o.status === "paid").map((o) => o._id),
      );
      setSelectedOrderIds(paidIds);
    }
  }, [orders]);

  const selectedCount = selectedOrderIds.size;
  const paidOrders = useMemo(
    () => orders?.filter((o) => o.status === "paid") ?? [],
    [orders],
  );
  const allOrders = orders ?? [];

  const toggleOrder = useCallback((orderId: Id<"orders">) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedCount === paidOrders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(paidOrders.map((o) => o._id)));
    }
  }, [selectedCount, paidOrders]);

  // Generate report + log closing
  const handleGenerateReport = useCallback(async () => {
    if (!storeId) return;
    try {
      await generateReport({ storeId, reportDate });
      await logDayClosing({ storeId, reportDate });
    } catch (error) {
      Alert.alert("Error", "Failed to generate report.");
    }
  }, [storeId, reportDate, generateReport, logDayClosing]);

  // Print Z-Report to thermal
  const handlePrintZReport = useCallback(async () => {
    if (!report || !storeId) return;
    setIsPrintingZReport(true);
    try {
      // Generate report first if not already generated
      if (!report._id) {
        await generateReport({ storeId, reportDate });
      }

      const store = user;
      await printZReportToThermal(
        {
          storeName: store?.storeName ?? "Store",
          storeAddress: store?.storeAddress ?? undefined,
          storeTin: store?.storeTin ?? undefined,
          reportDate,
          grossSales: report.grossSales,
          netSales: report.netSales,
          vatableSales: report.vatableSales,
          vatAmount: report.vatAmount,
          vatExemptSales: report.vatExemptSales,
          nonVatSales: report.nonVatSales ?? 0,
          seniorDiscounts: report.seniorDiscounts,
          pwdDiscounts: report.pwdDiscounts,
          promoDiscounts: report.promoDiscounts,
          manualDiscounts: report.manualDiscounts,
          totalDiscounts: report.totalDiscounts,
          voidCount: report.voidCount,
          voidAmount: report.voidAmount,
          cashTotal: report.cashTotal,
          cardEwalletTotal: report.cardEwalletTotal,
          transactionCount: report.transactionCount,
          averageTicket: report.averageTicket,
          generatedByName: report.generatedByName,
        },
        charsPerLine,
      );
      Alert.alert("Success", "Z-Report printed successfully.");
    } catch (error) {
      Alert.alert("Error", "Failed to print Z-Report. Check printer connection.");
    } finally {
      setIsPrintingZReport(false);
    }
  }, [report, storeId, reportDate, generateReport, charsPerLine, user]);

  // Batch reprint selected receipts
  const handleBatchReprint = useCallback(async () => {
    const orderIds = Array.from(selectedOrderIds);
    if (orderIds.length === 0) {
      Alert.alert("No Receipts", "Select at least one order to reprint.");
      return;
    }

    Alert.alert(
      "Batch Reprint",
      `Print ${orderIds.length} receipt(s)? This may take a few minutes.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Print",
          onPress: () => {
            printBatch(orderIds, async (orderId) => {
              // Fetch receipt data for each order from the existing getReceipt query
              // We need to use fetchQuery pattern since we're in a callback
              // The useBatchPrint hook handles the sequential printing
              return null; // placeholder — see note below
            });
          },
        },
      ],
    );
  }, [selectedOrderIds, printBatch]);

  const renderOrderItem = useCallback(
    ({ item }: { item: (typeof allOrders)[0] }) => (
      <OrderSelectionItem
        order={item}
        isSelected={selectedOrderIds.has(item._id)}
        onToggle={toggleOrder}
        formatCurrency={formatCurrency}
      />
    ),
    [selectedOrderIds, toggleOrder, formatCurrency],
  );

  const keyExtractor = useCallback((item: (typeof allOrders)[0]) => item._id, []);

  const dateLabel = selectedDate.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <YStack flex={1} backgroundColor="$gray100">
        {/* Header */}
        <XStack
          backgroundColor="$white"
          paddingHorizontal={16}
          paddingVertical={14}
          alignItems="center"
          borderBottomWidth={1}
          borderColor="$gray200"
        >
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#374151" />
          </TouchableOpacity>
          <YStack flex={1} alignItems="center">
            <Text variant="heading" size="lg">Day Closing</Text>
            <TouchableOpacity onPress={() => setShowDatePicker(true)}>
              <XStack alignItems="center" gap={4} marginTop={2}>
                <Ionicons name="calendar-outline" size={16} color="#0D87E1" />
                <Text style={{ color: "#0D87E1", fontWeight: "600", fontSize: 14 }}>
                  {dateLabel}
                </Text>
              </XStack>
            </TouchableOpacity>
          </YStack>
          {/* Generate/Refresh report button */}
          <TouchableOpacity onPress={handleGenerateReport} style={styles.refreshButton}>
            <Ionicons name="refresh" size={22} color="#0D87E1" />
          </TouchableOpacity>
        </XStack>

        {showDatePicker && (
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            maximumDate={new Date()}
            onChange={(_, date) => {
              setShowDatePicker(false);
              if (date) setSelectedDate(date);
            }}
          />
        )}

        {/* Content */}
        <FlatList
          data={allOrders}
          keyExtractor={keyExtractor}
          renderItem={renderOrderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <YStack gap={16} marginBottom={16}>
              {/* Z-Report Summary */}
              <ZReportSummary
                report={report ?? null}
                isLoading={report === undefined}
                onPrintZReport={handlePrintZReport}
                isPrintingZReport={isPrintingZReport}
              />

              {/* Receipts header */}
              <XStack justifyContent="space-between" alignItems="center">
                <Text variant="heading" size="base">
                  Receipts ({allOrders.length} orders)
                </Text>
                <TouchableOpacity onPress={toggleSelectAll} style={styles.selectAllButton}>
                  <Ionicons
                    name={selectedCount === paidOrders.length ? "checkbox" : "square-outline"}
                    size={20}
                    color="#0D87E1"
                  />
                  <Text style={{ color: "#0D87E1", fontWeight: "600", fontSize: 14, marginLeft: 6 }}>
                    {selectedCount === paidOrders.length ? "Deselect All" : "Select All"}
                  </Text>
                </TouchableOpacity>
              </XStack>
            </YStack>
          }
          ListEmptyComponent={
            <YStack alignItems="center" justifyContent="center" paddingVertical={40}>
              <Ionicons name="receipt-outline" size={48} color="#D1D5DB" />
              <Text variant="muted" size="base" style={{ marginTop: 12 }}>
                No orders found for this date.
              </Text>
            </YStack>
          }
        />

        {/* Sticky Footer */}
        {allOrders.length > 0 && (
          <YStack
            backgroundColor="$white"
            paddingHorizontal={20}
            paddingVertical={16}
            borderTopWidth={1}
            borderColor="$gray200"
          >
            <TouchableOpacity
              onPress={handleBatchReprint}
              disabled={selectedCount === 0 || isPrinting}
              activeOpacity={0.7}
              style={[
                styles.batchPrintButton,
                (selectedCount === 0 || isPrinting) && { opacity: 0.5 },
              ]}
            >
              <Ionicons name="print-outline" size={22} color="#FFFFFF" />
              <Text style={styles.batchPrintText}>
                Reprint {selectedCount} Selected Receipt{selectedCount !== 1 ? "s" : ""}
              </Text>
            </TouchableOpacity>
          </YStack>
        )}

        {/* Print Progress Modal */}
        <PrintProgressModal
          visible={isPrinting}
          currentIndex={currentIndex}
          totalCount={totalCount}
          onCancel={cancelBatch}
        />
      </YStack>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
  },
  refreshButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#EFF6FF",
  },
  listContent: {
    padding: 16,
    paddingBottom: 8,
  },
  selectAllButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  batchPrintButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0D87E1",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 10,
  },
  batchPrintText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});
```

**Step 2: Create barrel export**

Create `apps/native/src/features/day-closing/index.ts`:

```typescript
export { DayClosingScreen } from "./screens/DayClosingScreen";
```

**Step 3: Commit**

```bash
git add apps/native/src/features/day-closing/
git commit -m "feat: add DayClosingScreen with Z-Report summary and batch receipt reprint"
```

---

### Task 10: Wire Up Batch Reprint with Receipt Data Fetching

**Files:**
- Modify: `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx`
- Modify: `apps/native/src/features/day-closing/hooks/useBatchPrint.ts`

**Context:** In Task 9, the `handleBatchReprint` has a placeholder for receipt data fetching. Convex `useQuery` can't be called in callbacks, so we need to use `ConvexReactClient.query()` or restructure the approach. The simplest approach: pre-fetch receipt data for selected orders before starting the print loop, using `useQuery` with a helper mutation that returns receipt data.

Actually, the better pattern is to use `useAction` or the `fetchQuery` from Convex client. However, the simplest approach in this codebase is to pass the `ConvexReactClient` instance and call `.query()` directly, or use `useMutation` that returns data.

The cleanest approach: modify `useBatchPrint` to accept a `getReceiptFn` that the screen provides using `useConvex()` client.

**Step 1: Update useBatchPrint to use ConvexClient**

In `apps/native/src/features/day-closing/hooks/useBatchPrint.ts`, update to accept receipt fetching as a parameter:

Replace the existing `printBatch` implementation to use `convexClient.query()`:

```typescript
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useConvex, useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import type { ReceiptData } from "../../shared/utils/receipt";

interface BatchPrintState {
  isPrinting: boolean;
  currentIndex: number;
  totalCount: number;
  failedOrderIds: Id<"orders">[];
}

export function useBatchPrint() {
  const [state, setState] = useState<BatchPrintState>({
    isPrinting: false,
    currentIndex: 0,
    totalCount: 0,
    failedOrderIds: [],
  });
  const cancelledRef = useRef(false);

  const convex = useConvex();
  const logReprint = useMutation(api.checkout.logReceiptReprint);
  const { printReceipt: printToThermal } = usePrinterStore();

  const buildReceiptData = useCallback(
    async (orderId: Id<"orders">): Promise<ReceiptData | null> => {
      try {
        const receipt = await convex.query(api.checkout.getReceipt, { orderId });
        if (!receipt) return null;

        const discounts = await convex.query(api.discounts.getOrderDiscounts, { orderId });

        const storeAddress = [receipt.storeAddress1, receipt.storeAddress2]
          .filter(Boolean)
          .join(", ");

        const discountsList = (discounts ?? []).map((d: any) => ({
          type:
            d.discountType === "senior_citizen"
              ? ("sc" as const)
              : d.discountType === "pwd"
                ? ("pwd" as const)
                : ("custom" as const),
          customerName: d.customerName ?? "",
          customerId: d.customerId ?? "",
          itemName: d.itemName ?? "Order",
          amount: d.discountAmount,
        }));

        return {
          storeName: receipt.storeName,
          storeAddress,
          storeTin: receipt.tin,
          storeContactNumber: receipt.contactNumber,
          storeTelephone: receipt.telephone,
          storeEmail: receipt.email,
          storeWebsite: receipt.website,
          storeSocials: receipt.socials,
          storeFooter: receipt.footer,
          orderNumber: receipt.orderNumber,
          tableName: receipt.tableName,
          pax: receipt.pax,
          orderType: receipt.orderType === "takeout" ? "take_out" : receipt.orderType,
          cashierName: receipt.cashierName,
          items: receipt.items.map((item: any) => ({
            name: item.productName,
            quantity: item.quantity,
            price: item.unitPrice,
            total: item.lineTotal,
            modifiers: item.modifiers,
          })),
          subtotal: receipt.grossSales,
          discounts: discountsList,
          vatableSales: receipt.vatableSales,
          vatAmount: receipt.vatAmount,
          vatExemptSales: receipt.vatExemptSales,
          total: receipt.netSales,
          paymentMethod: receipt.paymentMethod ?? "cash",
          amountTendered: receipt.cashTendered,
          change: receipt.changeGiven,
          cardPaymentType: receipt.cardPaymentType,
          cardReferenceNumber: receipt.cardReferenceNumber,
          transactionDate: new Date(receipt.paidAt ?? receipt.createdAt),
          receiptNumber: receipt.receiptNumber,
          customerName: receipt.customerName,
          customerId: receipt.customerId,
          customerAddress: receipt.customerAddress,
          customerTin: receipt.customerTin,
        } as ReceiptData;
      } catch {
        return null;
      }
    },
    [convex],
  );

  const printBatch = useCallback(
    async (orderIds: Id<"orders">[]) => {
      cancelledRef.current = false;
      const failed: Id<"orders">[] = [];

      setState({
        isPrinting: true,
        currentIndex: 0,
        totalCount: orderIds.length,
        failedOrderIds: [],
      });

      for (let i = 0; i < orderIds.length; i++) {
        if (cancelledRef.current) break;

        setState((prev) => ({ ...prev, currentIndex: i + 1 }));

        try {
          const receiptData = await buildReceiptData(orderIds[i]);
          if (receiptData) {
            await printToThermal(receiptData);
            await logReprint({ orderId: orderIds[i] });
          } else {
            failed.push(orderIds[i]);
          }
        } catch (error) {
          console.error(`Failed to print order ${orderIds[i]}:`, error);
          failed.push(orderIds[i]);
        }
      }

      setState((prev) => ({
        ...prev,
        isPrinting: false,
        failedOrderIds: failed,
      }));

      if (failed.length > 0 && !cancelledRef.current) {
        Alert.alert(
          "Batch Print Complete",
          `${orderIds.length - failed.length} of ${orderIds.length} receipts printed. ${failed.length} failed.`,
        );
      } else if (!cancelledRef.current) {
        Alert.alert("Success", `All ${orderIds.length} receipts printed.`);
      }
    },
    [buildReceiptData, logReprint, printToThermal],
  );

  const cancelBatch = useCallback(() => {
    cancelledRef.current = true;
    setState((prev) => ({ ...prev, isPrinting: false }));
  }, []);

  return {
    ...state,
    printBatch,
    cancelBatch,
  };
}
```

**Step 2: Update DayClosingScreen handleBatchReprint**

In `DayClosingScreen.tsx`, simplify the batch reprint handler since `printBatch` now handles receipt fetching internally:

```typescript
const handleBatchReprint = useCallback(() => {
  const orderIds = Array.from(selectedOrderIds);
  if (orderIds.length === 0) {
    Alert.alert("No Receipts", "Select at least one order to reprint.");
    return;
  }

  Alert.alert(
    "Batch Reprint",
    `Print ${orderIds.length} receipt(s)? This may take a few minutes.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Print", onPress: () => printBatch(orderIds) },
    ],
  );
}, [selectedOrderIds, printBatch]);
```

**Step 3: Commit**

```bash
git add apps/native/src/features/day-closing/
git commit -m "feat: wire up batch reprint with ConvexClient receipt data fetching"
```

---

### Task 11: Install @react-native-community/datetimepicker (if not already installed)

**Files:**
- Modify: `apps/native/package.json` (if needed)

**Step 1: Check if already installed**

Run: `cd apps/native && cat package.json | grep datetimepicker`

If not found, install it:

Run: `cd /path/to/root && pnpm --filter native add @react-native-community/datetimepicker`

If already installed, skip this task.

**Step 2: Commit (if package was added)**

```bash
git add apps/native/package.json pnpm-lock.yaml
git commit -m "chore: add @react-native-community/datetimepicker dependency"
```

---

### Task 12: Verify & Test

**Step 1: Type check**

Run: `pnpm typecheck`

Expected: No type errors in the new files.

**Step 2: Lint and format**

Run: `pnpm check`

Fix any lint/format issues reported.

**Step 3: Test backend**

Run: `cd packages/backend && pnpm vitest run`

Verify existing tests still pass (no regressions).

**Step 4: Manual smoke test checklist**

- [ ] Home screen shows "Close Day" icon for admin/manager users
- [ ] Home screen does NOT show "Close Day" icon for cashier users
- [ ] Tapping "Close Day" navigates to DayClosingScreen
- [ ] Z-Report summary shows today's data (after generating)
- [ ] Date picker allows selecting past dates
- [ ] Refresh button regenerates the daily report
- [ ] "Print Z-Report" sends formatted report to thermal printer
- [ ] Order list shows all orders for the selected date
- [ ] Select All / Deselect All toggles work
- [ ] Individual order toggle works
- [ ] Voided orders show as deselected by default
- [ ] Batch reprint confirmation dialog appears
- [ ] Progress modal shows during printing
- [ ] Cancel stops the batch print
- [ ] Success alert shows after completion

**Step 5: Final commit (if any fixes)**

```bash
git add -A
git commit -m "fix: address type check and lint issues in day-closing feature"
```

---

## Summary

| Task | Description | New/Modified Files |
|------|-------------|-------------------|
| 1 | Backend `logDayClosing` mutation | `packages/backend/convex/closing.ts` (new) |
| 2 | Navigation registration | `apps/native/src/navigation/Navigation.tsx` (mod) |
| 3 | Home header "Close Day" button | `HomeHeader.tsx`, `HomeScreen.tsx` (mod) |
| 4 | Z-Report thermal formatter | `day-closing/utils/zReportFormatter.ts` (new) |
| 5 | Batch print hook | `day-closing/hooks/useBatchPrint.ts` (new) |
| 6 | Print progress modal | `day-closing/components/PrintProgressModal.tsx` (new) |
| 7 | Z-Report summary component | `day-closing/components/ZReportSummary.tsx` (new) |
| 8 | Order selection item (memoized) | `day-closing/components/OrderSelectionItem.tsx` (new) |
| 9 | Main DayClosingScreen + barrel | `day-closing/screens/DayClosingScreen.tsx`, `day-closing/index.ts` (new) |
| 10 | Wire up batch reprint with data fetching | `useBatchPrint.ts`, `DayClosingScreen.tsx` (mod) |
| 11 | Install datetimepicker (if needed) | `package.json` (mod) |
| 12 | Verify, lint, test | Various |
