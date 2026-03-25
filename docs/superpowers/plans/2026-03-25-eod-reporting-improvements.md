# End-of-Day Reporting Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve end-of-day reporting with item breakdowns in the POS app, better date navigation, and PDF export in the web admin.

**Architecture:** Three independent workstreams: (1) Rewrite the native Day Closing screen with date navigation bar and item breakdown, removing batch reprint; (2) Update the thermal Z-Report formatter to include item sales data; (3) Add a PDF download button to the web admin reports page using `@react-pdf/renderer`. All data queries already exist in the backend — no backend changes needed.

**Tech Stack:** React Native (Tamagui, `@react-native-community/datetimepicker`), `@react-pdf/renderer` (web PDF), Convex (existing queries), ESC/POS thermal printing.

**Spec:** `docs/superpowers/specs/2026-03-25-eod-reporting-improvements-design.md`

---

## File Structure

### Native App Changes (`apps/native/src/features/day-closing/`)

| File | Action | Responsibility |
|------|--------|---------------|
| `screens/DayClosingScreen.tsx` | Rewrite | Main screen: date nav bar, Z-Report summary, item breakdown, print footer |
| `components/ZReportSummary.tsx` | Modify | Pure display component — remove print button props |
| `components/ItemBreakdownCard.tsx` | Create | Card showing per-product sales with voided items in red |
| `components/DateNavigationBar.tsx` | Create | Prominent date nav with arrows + calendar picker trigger |
| `components/OrderSelectionItem.tsx` | Delete | Batch reprint feature removed |
| `components/PrintProgressModal.tsx` | Delete | Batch reprint feature removed |
| `hooks/useBatchPrint.ts` | Delete | Batch reprint feature removed |
| `utils/zReportFormatter.ts` | Modify | Add items-sold section to thermal print output |

### Web App Changes (`apps/web/src/app/(admin)/reports/`)

| File | Action | Responsibility |
|------|--------|---------------|
| `page.tsx` | Modify | Add `stores.get` query, wire up dynamic PDF button import |
| `_components/ReportPdfDocument.tsx` | Create | React-PDF document with all report sections |
| `_components/DownloadPdfButton.tsx` | Create | Button that generates and downloads PDF blob |
| `_components/index.ts` | Create | Barrel export |

### Dependencies

| Package | Where | Action |
|---------|-------|--------|
| `@react-pdf/renderer` | `apps/web` | Install |

---

## Chunk 1: POS Native — Delete Batch Reprint & Simplify ZReportSummary

### Task 1: Delete batch reprint files

**Files:**
- Delete: `apps/native/src/features/day-closing/components/OrderSelectionItem.tsx`
- Delete: `apps/native/src/features/day-closing/components/PrintProgressModal.tsx`
- Delete: `apps/native/src/features/day-closing/hooks/useBatchPrint.ts`

- [ ] **Step 1: Delete the three batch reprint files**

```bash
rm apps/native/src/features/day-closing/components/OrderSelectionItem.tsx
rm apps/native/src/features/day-closing/components/PrintProgressModal.tsx
rm apps/native/src/features/day-closing/hooks/useBatchPrint.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A apps/native/src/features/day-closing/components/OrderSelectionItem.tsx \
  apps/native/src/features/day-closing/components/PrintProgressModal.tsx \
  apps/native/src/features/day-closing/hooks/useBatchPrint.ts
git commit -m "refactor(day-closing): remove batch receipt reprint feature"
```

---

### Task 2: Simplify ZReportSummary to pure display component

**Files:**
- Modify: `apps/native/src/features/day-closing/components/ZReportSummary.tsx`

The component currently accepts `onPrintZReport` and `isPrintingZReport` props and renders a print button. Remove these props and the print button — the print action moves to the screen's sticky footer.

- [ ] **Step 1: Remove print-related props and button from ZReportSummary**

Update `ZReportSummaryProps` interface to remove `onPrintZReport` and `isPrintingZReport`. Remove the print button `TouchableOpacity` block (lines 137-148) and the associated `StyleSheet` entries (`printButton`, `printButtonDisabled`). Remove the `StyleSheet` and `TouchableOpacity` imports if no longer used.

The updated interface:

```tsx
interface ZReportSummaryProps {
  report: ZReportData | null;
  isLoading: boolean;
}
```

The component signature becomes:

```tsx
export const ZReportSummary = ({ report, isLoading }: ZReportSummaryProps) => {
```

Remove the entire print button block:
```tsx
      {/* Print Z-Report button */}
      <TouchableOpacity
        onPress={onPrintZReport}
        disabled={isPrintingZReport}
        ...
      </TouchableOpacity>
```

Remove `StyleSheet` import and the entire `const styles = StyleSheet.create({...})` block. Remove `TouchableOpacity` from the `react-native` import. Remove `Ionicons` import.

- [ ] **Step 2: Verify the component compiles**

```bash
cd apps/native && npx tsc --noEmit --pretty 2>&1 | head -30
```

Note: This will show errors in `DayClosingScreen.tsx` because it still passes the removed props — that's expected and will be fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/day-closing/components/ZReportSummary.tsx
git commit -m "refactor(day-closing): simplify ZReportSummary to pure display component"
```

---

## Chunk 2: POS Native — New Components & Screen Rewrite

### Task 3: Create DateNavigationBar component

**Files:**
- Create: `apps/native/src/features/day-closing/components/DateNavigationBar.tsx`

A full-width bar with left/right arrows and a tappable date label. Arrows navigate days. Tapping the date text opens the calendar picker. Right arrow disabled when viewing today. Light blue background (`#EFF6FF`).

- [ ] **Step 1: Create DateNavigationBar component**

```tsx
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, TouchableOpacity } from "react-native";
import { XStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface DateNavigationBarProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

const isToday = (date: Date): boolean => {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};

const formatDateLabel = (date: Date): string =>
  date.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const DateNavigationBar = ({ selectedDate, onDateChange }: DateNavigationBarProps) => {
  const [showPicker, setShowPicker] = useState(false);
  const today = isToday(selectedDate);

  const goToPreviousDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    onDateChange(prev);
  };

  const goToNextDay = () => {
    if (today) return;
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    onDateChange(next);
  };

  return (
    <>
      <XStack
        backgroundColor="#EFF6FF"
        paddingVertical={12}
        paddingHorizontal={16}
        alignItems="center"
        justifyContent="space-between"
      >
        <TouchableOpacity
          onPress={goToPreviousDay}
          style={{ width: 48, height: 48, justifyContent: "center", alignItems: "center" }}
          activeOpacity={0.6}
        >
          <Ionicons name="chevron-back" size={24} color="#0D87E1" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowPicker(true)} activeOpacity={0.6}>
          <XStack alignItems="center" gap={6}>
            <Ionicons name="calendar-outline" size={18} color="#0D87E1" />
            <Text style={{ color: "#0D87E1", fontWeight: "700", fontSize: 16 }}>
              {formatDateLabel(selectedDate)}
            </Text>
          </XStack>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={goToNextDay}
          disabled={today}
          style={{
            width: 48,
            height: 48,
            justifyContent: "center",
            alignItems: "center",
            opacity: today ? 0.3 : 1,
          }}
          activeOpacity={0.6}
        >
          <Ionicons name="chevron-forward" size={24} color="#0D87E1" />
        </TouchableOpacity>
      </XStack>

      {showPicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          maximumDate={new Date()}
          onChange={(_, date) => {
            setShowPicker(false);
            if (date) onDateChange(date);
          }}
        />
      )}
    </>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/features/day-closing/components/DateNavigationBar.tsx
git commit -m "feat(day-closing): add DateNavigationBar component with day arrows and calendar picker"
```

---

### Task 4: Create ItemBreakdownCard component

**Files:**
- Create: `apps/native/src/features/day-closing/components/ItemBreakdownCard.tsx`

A card displaying per-product sales as a plain mapped list (NOT FlatList — this component lives inside a ScrollView). Shows product name, quantity sold, and amount. Voided items displayed below with red text. Sorted by quantity descending.

- [ ] **Step 1: Create ItemBreakdownCard component**

The `productSales` data shape comes from the `getDailyProductSales` query return type. Each item has: `productId`, `productName`, `categoryName`, `quantitySold`, `grossAmount`, `voidedQuantity`, `voidedAmount`.

```tsx
import { YStack, XStack } from "tamagui";
import { Card, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface ProductSaleItem {
  productId: string;
  productName: string;
  categoryName: string;
  quantitySold: number;
  grossAmount: number;
  voidedQuantity: number;
  voidedAmount: number;
}

interface ItemBreakdownCardProps {
  productSales: ProductSaleItem[] | undefined;
  isLoading: boolean;
}

export const ItemBreakdownCard = ({ productSales, isLoading }: ItemBreakdownCardProps) => {
  const formatCurrency = useFormatCurrency();

  if (isLoading) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <Text variant="muted">Loading item breakdown...</Text>
      </Card>
    );
  }

  if (!productSales || productSales.length === 0) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <Text variant="muted">No items sold for this date.</Text>
      </Card>
    );
  }

  const sorted = [...productSales].sort((a, b) => b.quantitySold - a.quantitySold);
  const totalQty = sorted.reduce((sum, item) => sum + item.quantitySold, 0);
  const totalAmount = sorted.reduce((sum, item) => sum + item.grossAmount, 0);

  return (
    <YStack gap={8}>
      <XStack justifyContent="space-between" alignItems="center">
        <Text variant="heading" size="base">
          Items Sold
        </Text>
        <Text variant="muted" size="sm">
          {sorted.length} product(s)
        </Text>
      </XStack>

      <YStack
        backgroundColor="$white"
        borderRadius={12}
        borderWidth={1}
        borderColor="$gray200"
        overflow="hidden"
      >
        {/* Header row */}
        <XStack
          paddingVertical={10}
          paddingHorizontal={14}
          backgroundColor="#F9FAFB"
          borderBottomWidth={1}
          borderColor="$gray200"
        >
          <Text variant="muted" size="sm" style={{ flex: 1 }}>
            Product
          </Text>
          <Text variant="muted" size="sm" style={{ width: 50, textAlign: "right" }}>
            Qty
          </Text>
          <Text variant="muted" size="sm" style={{ width: 90, textAlign: "right" }}>
            Amount
          </Text>
        </XStack>

        {/* Product rows — plain .map(), NOT FlatList */}
        {sorted.map((item) => (
          <YStack key={item.productId}>
            <XStack
              paddingVertical={10}
              paddingHorizontal={14}
              borderBottomWidth={1}
              borderColor="#F3F4F6"
              alignItems="center"
            >
              <YStack style={{ flex: 1 }}>
                <Text size="sm" style={{ fontWeight: "500" }}>
                  {item.productName}
                </Text>
                <Text variant="muted" size="xs">
                  {item.categoryName}
                </Text>
              </YStack>
              <Text size="sm" style={{ width: 50, textAlign: "right", fontWeight: "600" }}>
                {item.quantitySold}
              </Text>
              <Text size="sm" style={{ width: 90, textAlign: "right", fontWeight: "600" }}>
                {formatCurrency(item.grossAmount)}
              </Text>
            </XStack>

            {/* Voided info row */}
            {item.voidedQuantity > 0 && (
              <XStack
                paddingVertical={6}
                paddingHorizontal={14}
                backgroundColor="#FEF2F2"
                borderBottomWidth={1}
                borderColor="#F3F4F6"
              >
                <Text size="xs" style={{ flex: 1, color: "#DC2626" }}>
                  Voided
                </Text>
                <Text size="xs" style={{ width: 50, textAlign: "right", color: "#DC2626" }}>
                  {item.voidedQuantity}
                </Text>
                <Text size="xs" style={{ width: 90, textAlign: "right", color: "#DC2626" }}>
                  -{formatCurrency(item.voidedAmount)}
                </Text>
              </XStack>
            )}
          </YStack>
        ))}

        {/* Totals row */}
        <XStack
          paddingVertical={12}
          paddingHorizontal={14}
          backgroundColor="#F9FAFB"
          borderTopWidth={1}
          borderColor="$gray200"
        >
          <Text size="sm" style={{ flex: 1, fontWeight: "700" }}>
            Total
          </Text>
          <Text size="sm" style={{ width: 50, textAlign: "right", fontWeight: "700" }}>
            {totalQty}
          </Text>
          <Text size="sm" style={{ width: 90, textAlign: "right", fontWeight: "700" }}>
            {formatCurrency(totalAmount)}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/features/day-closing/components/ItemBreakdownCard.tsx
git commit -m "feat(day-closing): add ItemBreakdownCard component for product sales display"
```

---

### Task 5: Rewrite DayClosingScreen

**Files:**
- Rewrite: `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx`

Full rewrite. Layout: Header bar > DateNavigationBar > ScrollView (ZReportSummary + ItemBreakdownCard) > Sticky footer with Print Z-Report button. Uses single `ScrollView` — no nested scrollable containers. Removes all batch reprint logic, `getOrderHistory` subscription, and `selectedOrderIds` state.

- [ ] **Step 1: Rewrite DayClosingScreen.tsx**

```tsx
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { Alert, SafeAreaView, ScrollView, StyleSheet, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { Text } from "../../shared/components/ui";
import { DateNavigationBar } from "../components/DateNavigationBar";
import { ItemBreakdownCard } from "../components/ItemBreakdownCard";
import { ZReportSummary } from "../components/ZReportSummary";
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

export const DayClosingScreen = ({ navigation }: DayClosingScreenProps) => {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isPrintingZReport, setIsPrintingZReport] = useState(false);

  const storeId = user?.storeId;
  const reportDate = formatDateKey(selectedDate);

  // Queries
  const report = useQuery(api.reports.getDailyReport, storeId ? { storeId, reportDate } : "skip");
  const productSales = useQuery(
    api.reports.getDailyProductSales,
    storeId ? { storeId, reportDate } : "skip",
  );
  const store = useQuery(api.stores.get, storeId ? { storeId } : "skip");

  // Mutations
  const generateReport = useMutation(api.reports.generateDailyReport);
  const logDayClosing = useMutation(api.closing.logDayClosing);

  // Printer config
  const charsPerLine = usePrinterStore((s) => {
    const receipt = s.printers.find((p) => p.role === "receipt");
    return receipt?.paperWidth === 80 ? 48 : 32;
  });

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

  // Print Z-Report to thermal printer
  const handlePrintZReport = useCallback(async () => {
    if (!report || !storeId || !store) return;
    setIsPrintingZReport(true);
    try {
      const storeAddress = [store.address1, store.address2].filter(Boolean).join(", ");

      await printZReportToThermal(
        {
          storeName: store.name,
          storeAddress: storeAddress || undefined,
          storeTin: store.tin || undefined,
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
        productSales ?? [],
      );
      Alert.alert("Success", "Z-Report printed successfully.");
    } catch (error) {
      Alert.alert("Error", "Failed to print Z-Report. Check printer connection.");
    } finally {
      setIsPrintingZReport(false);
    }
  }, [report, storeId, store, reportDate, charsPerLine, productSales]);

  const canPrint = !!report && !isPrintingZReport;

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
            <Text variant="heading" size="lg">
              Day Closing
            </Text>
          </YStack>
          <TouchableOpacity onPress={handleGenerateReport} style={styles.refreshButton}>
            <Ionicons name="refresh" size={22} color="#0D87E1" />
          </TouchableOpacity>
        </XStack>

        {/* Date Navigation */}
        <DateNavigationBar selectedDate={selectedDate} onDateChange={setSelectedDate} />

        {/* Scrollable Content — single ScrollView, no nested scrollables */}
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <YStack gap={16}>
            <ZReportSummary report={report ?? null} isLoading={report === undefined} />
            <ItemBreakdownCard productSales={productSales ?? undefined} isLoading={productSales === undefined} />
          </YStack>
        </ScrollView>

        {/* Sticky Footer — Print Z-Report */}
        <YStack
          backgroundColor="$white"
          paddingHorizontal={20}
          paddingVertical={16}
          borderTopWidth={1}
          borderColor="$gray200"
        >
          <TouchableOpacity
            onPress={handlePrintZReport}
            disabled={!canPrint}
            activeOpacity={0.7}
            style={[styles.printButton, !canPrint && styles.printButtonDisabled]}
          >
            <Ionicons name="print-outline" size={22} color="#FFFFFF" />
            <Text style={styles.printButtonText}>
              {isPrintingZReport ? "Printing..." : "Print Z-Report"}
            </Text>
          </TouchableOpacity>
        </YStack>
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
  scrollContent: {
    padding: 16,
    paddingBottom: 8,
  },
  printButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0D87E1",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 10,
  },
  printButtonDisabled: {
    opacity: 0.5,
  },
  printButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});
```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/native && npx tsc --noEmit --pretty 2>&1 | head -40
```

Expect: errors only in `zReportFormatter.ts` because `printZReportToThermal` doesn't accept the third `productSales` parameter yet — that's fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/day-closing/screens/DayClosingScreen.tsx
git commit -m "feat(day-closing): rewrite screen with date navigation bar and item breakdown"
```

---

## Chunk 3: POS Native — Z-Report Thermal Print Item Breakdown

### Task 6: Add item breakdown to thermal Z-Report formatter

**Files:**
- Modify: `apps/native/src/features/day-closing/utils/zReportFormatter.ts`

Add a third parameter `productSales` to `printZReportToThermal`. After the VAT summary section and before the footer, print an "ITEMS SOLD" section with product name, quantity, and amount columns. Adapts to paper width.

- [ ] **Step 1: Update the ZReportData interface and add ProductSaleItem type**

At the top of `zReportFormatter.ts`, after the existing `ZReportData` interface (line 26), add:

```typescript
export interface ProductSaleItem {
  productName: string;
  quantitySold: number;
  grossAmount: number;
}
```

- [ ] **Step 2: Update `printZReportToThermal` signature**

Change the function signature (line 59) from:

```typescript
export async function printZReportToThermal(
  data: ZReportData,
  charsPerLine: number,
): Promise<void> {
```

to:

```typescript
export async function printZReportToThermal(
  data: ZReportData,
  charsPerLine: number,
  productSales: ProductSaleItem[] = [],
): Promise<void> {
```

- [ ] **Step 3: Add items-sold section before the footer**

Insert the following block after the `await p.printText(line("=", w) + "\n", normal());` on line 168 (after VAT summary) and before the footer section (line 171):

```typescript
  // Items sold breakdown
  if (productSales.length > 0) {
    await p.printText("\n", normal());
    await p.printerAlign(ALIGN.CENTER);
    await p.printText("ITEMS SOLD\n", bold());
    await p.printerAlign(ALIGN.LEFT);
    await p.printText(`${line("-", w)}\n`, normal());

    // Column widths: product name gets remaining space, qty = 5 chars, amount = 10 chars
    const qtyCol = 5;
    const amtCol = 10;
    const nameCol = w - qtyCol - amtCol - 2; // 2 for spacing

    // Header
    const hdrName = "Item".padEnd(nameCol);
    const hdrQty = "Qty".padStart(qtyCol);
    const hdrAmt = "Amt".padStart(amtCol);
    await p.printText(`${hdrName} ${hdrQty} ${hdrAmt}\n`, normal());
    await p.printText(`${line("-", w)}\n`, normal());

    // Sort by quantity descending
    const sorted = [...productSales].sort((a, b) => b.quantitySold - a.quantitySold);

    let totalQty = 0;
    let totalAmt = 0;

    for (const item of sorted) {
      totalQty += item.quantitySold;
      totalAmt += item.grossAmount;

      const name = item.productName.length > nameCol
        ? item.productName.slice(0, nameCol)
        : item.productName.padEnd(nameCol);
      const qty = String(item.quantitySold).padStart(qtyCol);
      const amt = formatCurrency(item.grossAmount).padStart(amtCol);
      await p.printText(`${name} ${qty} ${amt}\n`, normal());
    }

    await p.printText(`${line("-", w)}\n`, normal());
    const totalLabel = "Total".padEnd(nameCol);
    const totalQtyStr = String(totalQty).padStart(qtyCol);
    const totalAmtStr = formatCurrency(totalAmt).padStart(amtCol);
    await p.printText(`${totalLabel} ${totalQtyStr} ${totalAmtStr}\n`, bold());
    await p.printText(`${line("=", w)}\n`, normal());
  }
```

- [ ] **Step 4: Verify types compile**

```bash
cd apps/native && npx tsc --noEmit --pretty 2>&1 | head -20
```

Expected: no errors (DayClosingScreen already passes the third argument).

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/day-closing/utils/zReportFormatter.ts
git commit -m "feat(day-closing): add items-sold section to thermal Z-Report output"
```

---

## Chunk 4: Web Admin — Install Dependency & Create PDF Components

### Task 7: Install @react-pdf/renderer

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install the dependency**

```bash
cd apps/web && pnpm add @react-pdf/renderer
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add @react-pdf/renderer dependency for PDF report generation"
```

---

### Task 8: Create ReportPdfDocument component

**Files:**
- Create: `apps/web/src/app/(admin)/reports/_components/ReportPdfDocument.tsx`

React-PDF document component with all report sections per the design spec. Uses `@react-pdf/renderer` components (`Document`, `Page`, `View`, `Text`, `StyleSheet`).

The component receives all report data as props — it does NOT call Convex hooks itself (it's rendered by react-pdf, not React DOM).

- [ ] **Step 1: Create the _components directory**

```bash
mkdir -p apps/web/src/app/\(admin\)/reports/_components
```

- [ ] **Step 2: Create ReportPdfDocument.tsx**

```tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

// ── Types ──────────────────────────────────────────────────────

interface StoreInfo {
  name: string;
  address1: string;
  address2?: string;
  tin: string;
  contactNumber?: string;
  telephone?: string;
  email?: string;
  website?: string;
}

interface DailyReportData {
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
  generatedAt: number;
}

interface ProductSaleRow {
  productId: string;
  productName: string;
  categoryName: string;
  quantitySold: number;
  grossAmount: number;
  voidedQuantity: number;
  voidedAmount: number;
}

interface CategorySaleRow {
  categoryId: string;
  categoryName: string;
  productCount: number;
  totalQuantitySold: number;
  totalGrossAmount: number;
}

interface HourlySaleRow {
  hour: number;
  transactionCount: number;
  netSales: number;
}

interface ReportPdfDocumentProps {
  store: StoreInfo;
  reportDate: string;
  report: DailyReportData;
  productSales: ProductSaleRow[];
  categorySales: CategorySaleRow[];
  hourlySales: HourlySaleRow[];
}

// ── Helpers ────────────────────────────────────────────────────

const fmt = (amount: number): string =>
  `PHP ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const fmtDate = (dateStr: string): string => {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
};

const fmtDateTime = (ts: number): string =>
  new Date(ts).toLocaleString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const fmtHour = (hour: number): string => {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h}:00 ${suffix}`;
};

// ── Styles ─────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#1F2937" },
  header: { marginBottom: 20, textAlign: "center" },
  storeName: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  storeDetail: { fontSize: 9, color: "#6B7280", marginBottom: 1 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#6B7280", marginBottom: 16 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowLabel: { color: "#6B7280" },
  rowValue: { fontFamily: "Helvetica-Bold" },
  divider: { borderBottomWidth: 1, borderBottomColor: "#E5E7EB", marginVertical: 6 },
  twoCol: { flexDirection: "row", gap: 20 },
  col: { flex: 1 },
  // Table styles
  table: { marginTop: 4 },
  tableHeader: { flexDirection: "row", backgroundColor: "#F9FAFB", paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tableRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: "#F3F4F6" },
  tableRowAlt: { backgroundColor: "#FAFAFA" },
  thText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#6B7280" },
  tdText: { fontSize: 8 },
  tdRight: { fontSize: 8, textAlign: "right" },
  tdRed: { fontSize: 8, textAlign: "right", color: "#DC2626" },
  footer: { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB", textAlign: "center" },
  footerText: { fontSize: 8, color: "#9CA3AF" },
  // Summary cards
  cardRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  card: { flex: 1, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 6, padding: 10 },
  cardLabel: { fontSize: 8, color: "#6B7280", marginBottom: 2 },
  cardValue: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  cardHighlight: { flex: 1, borderWidth: 1, borderColor: "#0D87E1", borderRadius: 6, padding: 10, backgroundColor: "#EFF6FF" },
});

// ── Component ──────────────────────────────────────────────────

const DetailRow = ({ label, value, bold: isBold }: { label: string; value: string; bold?: boolean }) => (
  <View style={s.row}>
    <Text style={isBold ? s.rowValue : s.rowLabel}>{label}</Text>
    <Text style={s.rowValue}>{value}</Text>
  </View>
);

export const ReportPdfDocument = ({
  store,
  reportDate,
  report,
  productSales,
  categorySales,
  hourlySales,
}: ReportPdfDocumentProps) => {
  const address = [store.address1, store.address2].filter(Boolean).join(", ");
  const activeHours = hourlySales.filter((h) => h.transactionCount > 0 || h.netSales > 0);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Store Header */}
        <View style={s.header}>
          <Text style={s.storeName}>{store.name}</Text>
          {address && <Text style={s.storeDetail}>{address}</Text>}
          {store.tin && <Text style={s.storeDetail}>TIN: {store.tin}</Text>}
          {store.contactNumber && <Text style={s.storeDetail}>Tel: {store.contactNumber}</Text>}
          {store.telephone && store.telephone !== store.contactNumber && (
            <Text style={s.storeDetail}>Phone: {store.telephone}</Text>
          )}
          {store.email && <Text style={s.storeDetail}>{store.email}</Text>}
          {store.website && <Text style={s.storeDetail}>{store.website}</Text>}
        </View>

        {/* Report Title */}
        <View style={{ textAlign: "center", marginBottom: 20 }}>
          <Text style={s.title}>Daily Sales Report</Text>
          <Text style={s.subtitle}>
            {fmtDate(reportDate)} — Generated by {report.generatedByName} on{" "}
            {fmtDateTime(report.generatedAt)}
          </Text>
        </View>

        {/* Summary Cards */}
        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Gross Sales</Text>
            <Text style={s.cardValue}>{fmt(report.grossSales)}</Text>
          </View>
          <View style={s.cardHighlight}>
            <Text style={s.cardLabel}>Net Sales</Text>
            <Text style={[s.cardValue, { color: "#0D87E1" }]}>{fmt(report.netSales)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Transactions</Text>
            <Text style={s.cardValue}>{report.transactionCount}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Avg Ticket</Text>
            <Text style={s.cardValue}>{fmt(report.averageTicket)}</Text>
          </View>
        </View>

        {/* Financial Summary — two columns */}
        <View style={s.twoCol}>
          <View style={[s.section, s.col]}>
            <Text style={s.sectionTitle}>Sales Breakdown</Text>
            <DetailRow label="Vatable Sales" value={fmt(report.vatableSales)} />
            <DetailRow label="VAT Amount (12%)" value={fmt(report.vatAmount)} />
            <DetailRow label="VAT-Exempt Sales" value={fmt(report.vatExemptSales)} />
            <DetailRow label="Non-VAT Sales" value={fmt(report.nonVatSales)} />
            <View style={s.divider} />
            <DetailRow label="Gross Sales" value={fmt(report.grossSales)} bold />
          </View>

          <View style={[s.section, s.col]}>
            <Text style={s.sectionTitle}>Discounts & Voids</Text>
            <DetailRow label="Senior Citizen" value={fmt(report.seniorDiscounts)} />
            <DetailRow label="PWD" value={fmt(report.pwdDiscounts)} />
            <DetailRow label="Promo" value={fmt(report.promoDiscounts)} />
            <DetailRow label="Manual" value={fmt(report.manualDiscounts)} />
            <View style={s.divider} />
            <DetailRow label="Total Discounts" value={fmt(report.totalDiscounts)} bold />
            <View style={s.divider} />
            <DetailRow label="Void Count" value={String(report.voidCount)} />
            <DetailRow label="Void Amount" value={fmt(report.voidAmount)} />
          </View>
        </View>

        {/* Payment Methods */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Payment Methods</Text>
          <DetailRow label="Cash" value={fmt(report.cashTotal)} />
          <DetailRow label="Card/E-Wallet" value={fmt(report.cardEwalletTotal)} />
        </View>

        {/* Product Sales Breakdown */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Product Sales Breakdown ({productSales.length} products)</Text>
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.thText, { flex: 3 }]}>Product</Text>
              <Text style={[s.thText, { flex: 2 }]}>Category</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Qty</Text>
              <Text style={[s.thText, { flex: 1.5, textAlign: "right" }]}>Gross</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Void Qty</Text>
              <Text style={[s.thText, { flex: 1.5, textAlign: "right" }]}>Void Amt</Text>
            </View>
            {productSales.map((p, i) => (
              <View key={p.productId} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
                <Text style={[s.tdText, { flex: 3 }]}>{p.productName}</Text>
                <Text style={[s.tdText, { flex: 2 }]}>{p.categoryName}</Text>
                <Text style={[s.tdRight, { flex: 1 }]}>{p.quantitySold}</Text>
                <Text style={[s.tdRight, { flex: 1.5 }]}>{fmt(p.grossAmount)}</Text>
                <Text style={[p.voidedQuantity > 0 ? s.tdRed : s.tdRight, { flex: 1 }]}>
                  {p.voidedQuantity > 0 ? p.voidedQuantity : "-"}
                </Text>
                <Text style={[p.voidedAmount > 0 ? s.tdRed : s.tdRight, { flex: 1.5 }]}>
                  {p.voidedAmount > 0 ? fmt(p.voidedAmount) : "-"}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Sales by Category */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Sales by Category</Text>
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.thText, { flex: 3 }]}>Category</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Products</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Total Qty</Text>
              <Text style={[s.thText, { flex: 2, textAlign: "right" }]}>Total Amount</Text>
            </View>
            {categorySales.map((c, i) => (
              <View key={c.categoryId} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
                <Text style={[s.tdText, { flex: 3 }]}>{c.categoryName}</Text>
                <Text style={[s.tdRight, { flex: 1 }]}>{c.productCount}</Text>
                <Text style={[s.tdRight, { flex: 1 }]}>{c.totalQuantitySold}</Text>
                <Text style={[s.tdRight, { flex: 2 }]}>{fmt(c.totalGrossAmount)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Hourly Breakdown */}
        {activeHours.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>Hourly Breakdown</Text>
            <View style={s.table}>
              <View style={s.tableHeader}>
                <Text style={[s.thText, { flex: 2 }]}>Hour</Text>
                <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Transactions</Text>
                <Text style={[s.thText, { flex: 2, textAlign: "right" }]}>Net Sales</Text>
              </View>
              {activeHours.map((h, i) => (
                <View key={h.hour} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
                  <Text style={[s.tdText, { flex: 2 }]}>{fmtHour(h.hour)}</Text>
                  <Text style={[s.tdRight, { flex: 1 }]}>{h.transactionCount}</Text>
                  <Text style={[s.tdRight, { flex: 2 }]}>{fmt(h.netSales)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>This is a system-generated report.</Text>
          <Text style={s.footerText}>
            Downloaded on {new Date().toLocaleString("en-PH")}
          </Text>
          <Text style={[s.footerText, { marginTop: 4 }]}>Powered by PMGT Flow Suite</Text>
        </View>
      </Page>
    </Document>
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/reports/_components/ReportPdfDocument.tsx
git commit -m "feat(reports): create ReportPdfDocument component for PDF export"
```

---

### Task 9: Create DownloadPdfButton component

**Files:**
- Create: `apps/web/src/app/(admin)/reports/_components/DownloadPdfButton.tsx`

Button that generates a PDF blob using `@react-pdf/renderer`'s `pdf()` function and triggers a browser download. Receives all data as props. Shows loading state during PDF generation.

- [ ] **Step 1: Create DownloadPdfButton.tsx**

```tsx
"use client";

import { pdf } from "@react-pdf/renderer";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ReportPdfDocument } from "./ReportPdfDocument";

type ReportPdfDocumentProps = React.ComponentProps<typeof ReportPdfDocument>;

interface DownloadPdfButtonProps {
  data: ReportPdfDocumentProps;
  reportDate: string;
  storeName: string;
  disabled?: boolean;
}

export const DownloadPdfButton = ({ data, reportDate, storeName, disabled }: DownloadPdfButtonProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      const blob = await pdf(<ReportPdfDocument {...data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${storeName.replace(/\s+/g, "-")}-daily-report-${reportDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded successfully");
    } catch (error) {
      toast.error("Failed to generate PDF");
      console.error("PDF generation error:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={disabled || isGenerating}
    >
      {isGenerating ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {isGenerating ? "Generating..." : "Download PDF"}
    </Button>
  );
};
```

- [ ] **Step 2: Create barrel export index.ts**

```tsx
export { DownloadPdfButton } from "./DownloadPdfButton";
export { ReportPdfDocument } from "./ReportPdfDocument";
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/reports/_components/DownloadPdfButton.tsx \
  apps/web/src/app/\(admin\)/reports/_components/index.ts
git commit -m "feat(reports): create DownloadPdfButton component with PDF generation and download"
```

---

## Chunk 5: Web Admin — Wire Up PDF Button in Reports Page

### Task 10: Add store query and PDF download button to reports page

**Files:**
- Modify: `apps/web/src/app/(admin)/reports/page.tsx`

Three changes:
1. Add `stores.get` query subscription for store info
2. Add dynamic import of `DownloadPdfButton` (SSR disabled)
3. Add the button next to the existing "Mark as Printed" button

- [ ] **Step 1: Add dynamic import at the top of the file**

After the existing imports (around line 34), add:

```tsx
import dynamic from "next/dynamic";

const DownloadPdfButton = dynamic(
  () => import("./_components/DownloadPdfButton").then((mod) => mod.DownloadPdfButton),
  { ssr: false },
);
```

- [ ] **Step 2: Add store query inside the component**

After the existing `dateRangeReport` query (around line 70), add:

```tsx
const store = useQuery(
  api.stores.get,
  isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
);
```

- [ ] **Step 3: Add the PDF download button in the report header card**

In the daily report tab, inside the `<div className="flex items-center gap-2">` block (around line 190), after the existing "Mark as Printed" button, add the `DownloadPdfButton`:

Find this block (lines 190-199):
```tsx
                    <div className="flex items-center gap-2">
                      <Badge variant={dailyReport.isPrinted ? "default" : "secondary"}>
                        {dailyReport.isPrinted ? "Printed" : "Not Printed"}
                      </Badge>
                      {!dailyReport.isPrinted && (
                        <Button variant="outline" size="sm" onClick={handleMarkPrinted}>
                          <Printer className="mr-2 h-4 w-4" />
                          Mark as Printed
                        </Button>
                      )}
                    </div>
```

Replace it with:

```tsx
                    <div className="flex items-center gap-2">
                      <Badge variant={dailyReport.isPrinted ? "default" : "secondary"}>
                        {dailyReport.isPrinted ? "Printed" : "Not Printed"}
                      </Badge>
                      {!dailyReport.isPrinted && (
                        <Button variant="outline" size="sm" onClick={handleMarkPrinted}>
                          <Printer className="mr-2 h-4 w-4" />
                          Mark as Printed
                        </Button>
                      )}
                      {store && productSales && categorySales && hourlySales && (
                        <DownloadPdfButton
                          reportDate={reportDate}
                          storeName={store.name}
                          disabled={false}
                          data={{
                            store: {
                              name: store.name,
                              address1: store.address1,
                              address2: store.address2,
                              tin: store.tin,
                              contactNumber: store.contactNumber,
                              telephone: store.telephone,
                              email: store.email,
                              website: store.website,
                            },
                            reportDate,
                            report: {
                              grossSales: dailyReport.grossSales,
                              netSales: dailyReport.netSales,
                              vatableSales: dailyReport.vatableSales,
                              vatAmount: dailyReport.vatAmount,
                              vatExemptSales: dailyReport.vatExemptSales,
                              nonVatSales: dailyReport.nonVatSales,
                              seniorDiscounts: dailyReport.seniorDiscounts,
                              pwdDiscounts: dailyReport.pwdDiscounts,
                              promoDiscounts: dailyReport.promoDiscounts,
                              manualDiscounts: dailyReport.manualDiscounts,
                              totalDiscounts: dailyReport.totalDiscounts,
                              voidCount: dailyReport.voidCount,
                              voidAmount: dailyReport.voidAmount,
                              cashTotal: dailyReport.cashTotal,
                              cardEwalletTotal: dailyReport.cardEwalletTotal,
                              transactionCount: dailyReport.transactionCount,
                              averageTicket: dailyReport.averageTicket,
                              generatedByName: dailyReport.generatedByName,
                              generatedAt: dailyReport.generatedAt,
                            },
                            productSales,
                            categorySales,
                            hourlySales,
                          }}
                        />
                      )}
                    </div>
```

- [ ] **Step 4: Verify build**

```bash
cd apps/web && pnpm build 2>&1 | tail -20
```

Expected: successful build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(admin\)/reports/page.tsx
git commit -m "feat(reports): wire up PDF download button in daily report header"
```

---

## Chunk 6: Verification & Cleanup

### Task 11: End-to-end verification

- [ ] **Step 1: Type check native app**

```bash
cd apps/native && npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 2: Type check web app**

```bash
cd apps/web && npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 3: Run lint/format**

```bash
pnpm check
```

Fix any issues found.

- [ ] **Step 4: Verify web app builds**

```bash
cd apps/web && pnpm build 2>&1 | tail -20
```

Expected: successful build.

- [ ] **Step 5: Commit any lint/format fixes**

```bash
git add -A && git commit -m "style: fix lint and format issues"
```

(Only run if there were changes from step 3.)
