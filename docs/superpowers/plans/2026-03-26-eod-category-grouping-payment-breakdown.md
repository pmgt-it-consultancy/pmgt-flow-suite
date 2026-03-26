# EOD Category Grouping & Payment Transaction Breakdown — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Z-day reporting to group products by category with subtotals, and break down non-cash payments into individual transactions with reference numbers for verification.

**Architecture:** New `dailyPaymentTransactions` table denormalizes card/e-wallet transaction details at report-generation time (same pattern as existing `dailyProductSales`). Category grouping uses existing `dailyProductSales` data — only the display/print layer changes. All four outputs updated: native screen, thermal print, web page, PDF.

**Tech Stack:** Convex (schema + queries/mutations), React Native + Tamagui (native app), Next.js + Radix UI (web), @react-pdf/renderer (PDF), BluetoothEscposPrinter (thermal)

**Spec:** `docs/superpowers/specs/2026-03-26-eod-category-grouping-payment-breakdown-design.md`

---

## Chunk 1: Backend — Schema + Report Generation + Query

### Task 1: Add `dailyPaymentTransactions` table to schema

**Files:**
- Modify: `packages/backend/convex/schema.ts:318-332` (after `dailyProductSales`)

- [ ] **Step 1: Add the new table definition after `dailyProductSales`**

In `packages/backend/convex/schema.ts`, add the following table definition right after the `dailyProductSales` table (after line 332):

```typescript
  dailyPaymentTransactions: defineTable({
    storeId: v.id("stores"),
    reportDate: v.string(),
    orderId: v.id("orders"),
    orderNumber: v.string(),
    paymentType: v.string(),
    referenceNumber: v.string(),
    amount: v.number(),
    paidAt: v.number(),
  }).index("by_store_date", ["storeId", "reportDate"]),
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add dailyPaymentTransactions table to schema"
```

---

### Task 2: Add `generatePaymentTransactionsBreakdown` helper and wire into report generation

**Files:**
- Modify: `packages/backend/convex/reports.ts`

- [ ] **Step 1: Add the helper function after `generateProductSalesBreakdown` (after line 395)**

Add this helper function at the end of the existing helpers section (after `generateProductSalesBreakdown`):

```typescript
// Helper: Generate payment transactions breakdown for non-cash orders
async function generatePaymentTransactionsBreakdown(
  ctx: { db: any },
  storeId: Id<"stores">,
  reportDate: string,
  startTime?: string,
  endTime?: string,
): Promise<void> {
  // Delete existing payment transactions for this date
  const existingTransactions = await ctx.db
    .query("dailyPaymentTransactions")
    .withIndex("by_store_date", (q: any) => q.eq("storeId", storeId).eq("reportDate", reportDate))
    .collect();

  for (const tx of existingTransactions) {
    await ctx.db.delete(tx._id);
  }

  // Parse date range (PHT boundaries, with optional time range)
  const { start: startOfDay, end: endOfDay } = getPHTTimeBoundariesForDate(
    reportDate,
    startTime,
    endTime,
  );

  // Get all orders for the day
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q.eq("storeId", storeId).gte("createdAt", startOfDay).lt("createdAt", endOfDay),
    )
    .collect();

  // Filter to paid card/e-wallet orders
  const cardOrders = orders.filter(
    (o: any) => o.status === "paid" && o.paymentMethod === "card_ewallet",
  );

  // Insert one row per non-cash transaction
  for (const order of cardOrders) {
    await ctx.db.insert("dailyPaymentTransactions", {
      storeId,
      reportDate,
      orderId: order._id,
      orderNumber: order.orderNumber ?? "",
      paymentType: order.cardPaymentType ?? "Unknown",
      referenceNumber: order.cardReferenceNumber ?? "",
      amount: order.netSales,
      paidAt: order.paidAt ?? order._creationTime,
    });
  }
}
```

- [ ] **Step 2: Wire the helper into `generateDailyReport` — existing report path (line ~63)**

In `generateDailyReport`, in the `if (existingReport)` branch, add the call after `generateProductSalesBreakdown`:

```typescript
      // Regenerate payment transactions breakdown
      await generatePaymentTransactionsBreakdown(
        ctx,
        args.storeId,
        args.reportDate,
        args.startTime,
        args.endTime,
      );
```

- [ ] **Step 3: Wire the helper into `generateDailyReport` — new report path (line ~100)**

In `generateDailyReport`, in the new report creation branch, add the call after `generateProductSalesBreakdown`:

```typescript
    // Also generate payment transactions breakdown
    await generatePaymentTransactionsBreakdown(
      ctx,
      args.storeId,
      args.reportDate,
      args.startTime,
      args.endTime,
    );
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No new type errors

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/reports.ts
git commit -m "feat(backend): generate payment transactions breakdown during report generation"
```

---

### Task 3: Add `getDailyPaymentTransactions` query

**Files:**
- Modify: `packages/backend/convex/reports.ts`

- [ ] **Step 1: Add the query after `getDailyProductSales` (after line 543)**

```typescript
// Get payment transactions for a day (non-cash only, grouped by payment type)
export const getDailyPaymentTransactions = query({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
  },
  returns: v.array(
    v.object({
      paymentType: v.string(),
      transactions: v.array(
        v.object({
          orderId: v.id("orders"),
          orderNumber: v.string(),
          referenceNumber: v.string(),
          amount: v.number(),
          paidAt: v.number(),
        }),
      ),
      subtotal: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    const transactions = await ctx.db
      .query("dailyPaymentTransactions")
      .withIndex("by_store_date", (q) =>
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate),
      )
      .collect();

    // Group by paymentType
    const groupMap = new Map<
      string,
      {
        paymentType: string;
        transactions: {
          orderId: Id<"orders">;
          orderNumber: string;
          referenceNumber: string;
          amount: number;
          paidAt: number;
        }[];
        subtotal: number;
      }
    >();

    for (const tx of transactions) {
      const existing = groupMap.get(tx.paymentType);
      if (existing) {
        existing.transactions.push({
          orderId: tx.orderId,
          orderNumber: tx.orderNumber,
          referenceNumber: tx.referenceNumber,
          amount: tx.amount,
          paidAt: tx.paidAt,
        });
        existing.subtotal += tx.amount;
      } else {
        groupMap.set(tx.paymentType, {
          paymentType: tx.paymentType,
          transactions: [
            {
              orderId: tx.orderId,
              orderNumber: tx.orderNumber,
              referenceNumber: tx.referenceNumber,
              amount: tx.amount,
              paidAt: tx.paidAt,
            },
          ],
          subtotal: tx.amount,
        });
      }
    }

    // Sort transactions within each group by paidAt
    const results = Array.from(groupMap.values());
    for (const group of results) {
      group.transactions.sort((a, b) => a.paidAt - b.paidAt);
      group.subtotal = roundToTwo(group.subtotal);
    }

    // Sort groups alphabetically by paymentType
    results.sort((a, b) => a.paymentType.localeCompare(b.paymentType));

    return results;
  },
});
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/reports.ts
git commit -m "feat(backend): add getDailyPaymentTransactions query"
```

---

## Chunk 2: Native App — Category Grouping in ItemBreakdownCard

### Task 4: Refactor `ItemBreakdownCard` to group products by category

**Files:**
- Modify: `apps/native/src/features/day-closing/components/ItemBreakdownCard.tsx`

- [ ] **Step 1: Replace the component with category-grouped layout**

Replace the entire file content with:

```tsx
import { XStack, YStack } from "tamagui";
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

interface CategoryGroup {
  categoryName: string;
  products: ProductSaleItem[];
  totalQty: number;
  totalAmount: number;
}

function groupByCategory(products: ProductSaleItem[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();

  for (const item of products) {
    const existing = map.get(item.categoryName);
    if (existing) {
      existing.products.push(item);
      existing.totalQty += item.quantitySold;
      existing.totalAmount += item.grossAmount;
    } else {
      map.set(item.categoryName, {
        categoryName: item.categoryName,
        products: [item],
        totalQty: item.quantitySold,
        totalAmount: item.grossAmount,
      });
    }
  }

  const groups = Array.from(map.values());
  // Sort categories alphabetically
  groups.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  // Sort products within each category by quantity descending
  for (const group of groups) {
    group.products.sort((a, b) => b.quantitySold - a.quantitySold);
  }
  return groups;
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

  const categories = groupByCategory(productSales);
  const totalQty = productSales.reduce((sum, item) => sum + item.quantitySold, 0);
  const totalAmount = productSales.reduce((sum, item) => sum + item.grossAmount, 0);

  return (
    <YStack gap={8}>
      <XStack justifyContent="space-between" alignItems="center">
        <Text variant="heading" size="base">
          Items Sold
        </Text>
        <Text variant="muted" size="sm">
          {productSales.length} product(s)
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

        {/* Category groups */}
        {categories.map((category) => (
          <YStack key={category.categoryName}>
            {/* Category header */}
            <XStack
              paddingVertical={8}
              paddingHorizontal={14}
              backgroundColor="#EFF6FF"
              borderBottomWidth={1}
              borderColor="#DBEAFE"
            >
              <Text size="sm" style={{ flex: 1, fontWeight: "700", color: "#1E40AF" }}>
                {category.categoryName}
              </Text>
            </XStack>

            {/* Product rows */}
            {category.products.map((item) => (
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

            {/* Category subtotal */}
            <XStack
              paddingVertical={8}
              paddingHorizontal={14}
              backgroundColor="#F0F9FF"
              borderBottomWidth={1}
              borderColor="#E0F2FE"
            >
              <Text size="xs" style={{ flex: 1, fontWeight: "600", color: "#0369A1" }}>
                Subtotal
              </Text>
              <Text size="xs" style={{ width: 50, textAlign: "right", fontWeight: "600", color: "#0369A1" }}>
                {category.totalQty}
              </Text>
              <Text size="xs" style={{ width: 90, textAlign: "right", fontWeight: "600", color: "#0369A1" }}>
                {formatCurrency(category.totalAmount)}
              </Text>
            </XStack>
          </YStack>
        ))}

        {/* Grand totals row */}
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

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/day-closing/components/ItemBreakdownCard.tsx
git commit -m "feat(native): group products by category in ItemBreakdownCard"
```

---

## Chunk 3: Native App — Payment Transactions Card + Day Closing Screen

### Task 5: Create `PaymentTransactionsCard` component

**Files:**
- Create: `apps/native/src/features/day-closing/components/PaymentTransactionsCard.tsx`

- [ ] **Step 1: Create the component file**

```tsx
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface PaymentTransaction {
  orderId: string;
  orderNumber: string;
  referenceNumber: string;
  amount: number;
  paidAt: number;
}

interface PaymentTypeGroup {
  paymentType: string;
  transactions: PaymentTransaction[];
  subtotal: number;
}

interface PaymentTransactionsCardProps {
  paymentGroups: PaymentTypeGroup[] | undefined;
  isLoading: boolean;
}

export const PaymentTransactionsCard = ({
  paymentGroups,
  isLoading,
}: PaymentTransactionsCardProps) => {
  const formatCurrency = useFormatCurrency();

  if (isLoading) {
    return null;
  }

  if (!paymentGroups || paymentGroups.length === 0) {
    return null;
  }

  const grandTotal = paymentGroups.reduce((sum, g) => sum + g.subtotal, 0);
  const totalTransactions = paymentGroups.reduce((sum, g) => sum + g.transactions.length, 0);

  return (
    <YStack gap={8}>
      <XStack justifyContent="space-between" alignItems="center">
        <Text variant="heading" size="base">
          Payment Transactions
        </Text>
        <Text variant="muted" size="sm">
          {totalTransactions} transaction(s)
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
            Order / Ref #
          </Text>
          <Text variant="muted" size="sm" style={{ width: 90, textAlign: "right" }}>
            Amount
          </Text>
        </XStack>

        {paymentGroups.map((group) => (
          <YStack key={group.paymentType}>
            {/* Payment type header */}
            <XStack
              paddingVertical={8}
              paddingHorizontal={14}
              backgroundColor="#F0FDF4"
              borderBottomWidth={1}
              borderColor="#DCFCE7"
            >
              <Text size="sm" style={{ flex: 1, fontWeight: "700", color: "#166534" }}>
                {group.paymentType}
              </Text>
              <Text size="sm" style={{ fontWeight: "600", color: "#166534" }}>
                {group.transactions.length}
              </Text>
            </XStack>

            {/* Transaction rows */}
            {group.transactions.map((tx) => (
              <XStack
                key={tx.orderId}
                paddingVertical={10}
                paddingHorizontal={14}
                borderBottomWidth={1}
                borderColor="#F3F4F6"
                alignItems="center"
              >
                <YStack style={{ flex: 1 }}>
                  <Text size="sm" style={{ fontWeight: "500" }}>
                    #{tx.orderNumber}
                  </Text>
                  <Text variant="muted" size="xs">
                    {tx.referenceNumber}
                  </Text>
                </YStack>
                <Text size="sm" style={{ width: 90, textAlign: "right", fontWeight: "600" }}>
                  {formatCurrency(tx.amount)}
                </Text>
              </XStack>
            ))}

            {/* Group subtotal */}
            <XStack
              paddingVertical={8}
              paddingHorizontal={14}
              backgroundColor="#F0FDF4"
              borderBottomWidth={1}
              borderColor="#DCFCE7"
            >
              <Text size="xs" style={{ flex: 1, fontWeight: "600", color: "#166534" }}>
                Subtotal
              </Text>
              <Text size="xs" style={{ width: 90, textAlign: "right", fontWeight: "600", color: "#166534" }}>
                {formatCurrency(group.subtotal)}
              </Text>
            </XStack>
          </YStack>
        ))}

        {/* Grand total */}
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
          <Text size="sm" style={{ width: 90, textAlign: "right", fontWeight: "700" }}>
            {formatCurrency(grandTotal)}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/day-closing/components/PaymentTransactionsCard.tsx
git commit -m "feat(native): add PaymentTransactionsCard component"
```

---

### Task 6: Update `DayClosingScreen` to query and display payment transactions

**Files:**
- Modify: `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx`

- [ ] **Step 1: Add import for the new component and query**

Add to the imports at the top of the file:

```typescript
import { PaymentTransactionsCard } from "../components/PaymentTransactionsCard";
```

- [ ] **Step 2: Add the payment transactions query**

After the existing `store` query (line 44), add:

```typescript
  const paymentTransactions = useQuery(
    api.reports.getDailyPaymentTransactions,
    storeId ? { storeId, reportDate } : "skip",
  );
```

- [ ] **Step 3: Add `PaymentTransactionsCard` to the ScrollView content**

In the ScrollView's `<YStack gap={16}>`, add the card after `ItemBreakdownCard`:

```tsx
            <PaymentTransactionsCard
              paymentGroups={paymentTransactions ?? undefined}
              isLoading={paymentTransactions === undefined}
            />
```

- [ ] **Step 4: Pass payment transactions data to the thermal print handler**

Update the `handlePrintZReport` callback. Change the `printZReportToThermal` call to include the 4th argument:

```typescript
      await printZReportToThermal(
        { /* ...existing data object stays the same... */ },
        charsPerLine,
        productSales ?? [],
        paymentTransactions ?? [],
      );
```

Also add `paymentTransactions` to the dependency array of the `useCallback`.

- [ ] **Step 5: Verify typecheck passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: May show type error in `printZReportToThermal` call (4th arg not yet supported) — that's OK, will be fixed in Task 7.

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/day-closing/screens/DayClosingScreen.tsx
git commit -m "feat(native): wire payment transactions query and card into DayClosingScreen"
```

---

## Chunk 4: Thermal Print — Category Grouping + Payment Transactions

### Task 7: Update `zReportFormatter.ts` for category-grouped items and payment transactions

**Files:**
- Modify: `apps/native/src/features/day-closing/utils/zReportFormatter.ts`

- [ ] **Step 1: Update the `ProductSaleItem` interface to include `categoryName`**

Replace the existing `ProductSaleItem` interface:

```typescript
export interface ProductSaleItem {
  productName: string;
  categoryName: string;
  quantitySold: number;
  grossAmount: number;
}
```

- [ ] **Step 2: Add `PaymentTransactionGroup` interface**

After `ProductSaleItem`, add:

```typescript
export interface PaymentTransaction {
  orderNumber: string;
  referenceNumber: string;
  amount: number;
}

export interface PaymentTransactionGroup {
  paymentType: string;
  transactions: PaymentTransaction[];
  subtotal: number;
}
```

- [ ] **Step 3: Update the function signature to accept payment transactions**

Change the function signature:

```typescript
export async function printZReportToThermal(
  data: ZReportData,
  charsPerLine: number,
  productSales: ProductSaleItem[] = [],
  paymentTransactions: PaymentTransactionGroup[] = [],
): Promise<void> {
```

- [ ] **Step 4: Replace the "ITEMS SOLD" print section with category-grouped version**

Replace everything from the `// Items sold breakdown` comment (line 189) to the closing `}` of the `if (productSales.length > 0)` block (line 234) with:

```typescript
  // Items sold breakdown — grouped by category
  if (productSales.length > 0) {
    await p.printText("\n", normal());
    await p.printerAlign(ALIGN.CENTER);
    await p.printText("ITEMS SOLD\n", bold());
    await p.printerAlign(ALIGN.LEFT);
    await p.printText(`${line("-", w)}\n`, normal());

    // Column widths
    const qtyCol = 5;
    const amtCol = 10;
    const nameCol = w - qtyCol - amtCol - 2;

    // Group by category
    const categoryMap = new Map<string, { items: ProductSaleItem[]; totalQty: number; totalAmt: number }>();
    for (const item of productSales) {
      const cat = item.categoryName || "Uncategorized";
      const existing = categoryMap.get(cat);
      if (existing) {
        existing.items.push(item);
        existing.totalQty += item.quantitySold;
        existing.totalAmt += item.grossAmount;
      } else {
        categoryMap.set(cat, {
          items: [item],
          totalQty: item.quantitySold,
          totalAmt: item.grossAmount,
        });
      }
    }

    // Sort categories alphabetically
    const categories = Array.from(categoryMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    let grandTotalQty = 0;
    let grandTotalAmt = 0;

    for (const [categoryName, group] of categories) {
      // Category header
      const catLabel = `-- ${categoryName} `;
      const catLine = catLabel + line("-", Math.max(0, w - catLabel.length));
      await p.printText(`${catLine}\n`, bold());

      // Sort products by qty descending
      group.items.sort((a, b) => b.quantitySold - a.quantitySold);

      for (const item of group.items) {
        const name =
          item.productName.length > nameCol
            ? item.productName.slice(0, nameCol)
            : item.productName.padEnd(nameCol);
        const qty = String(item.quantitySold).padStart(qtyCol);
        const amt = formatCurrency(item.grossAmount).padStart(amtCol);
        await p.printText(`${name} ${qty} ${amt}\n`, normal());
      }

      // Category subtotal
      const subLabel = "Subtotal".padEnd(nameCol);
      const subQty = String(group.totalQty).padStart(qtyCol);
      const subAmt = formatCurrency(group.totalAmt).padStart(amtCol);
      await p.printText(`${subLabel} ${subQty} ${subAmt}\n`, normal());

      grandTotalQty += group.totalQty;
      grandTotalAmt += group.totalAmt;
    }

    await p.printText(`${line("-", w)}\n`, normal());
    const totalLabel = "TOTAL".padEnd(nameCol);
    const totalQtyStr = String(grandTotalQty).padStart(qtyCol);
    const totalAmtStr = formatCurrency(grandTotalAmt).padStart(amtCol);
    await p.printText(`${totalLabel} ${totalQtyStr} ${totalAmtStr}\n`, bold());
    await p.printText(`${line("=", w)}\n`, normal());
  }

  // Payment transactions breakdown
  if (paymentTransactions.length > 0) {
    await p.printText("\n", normal());
    await p.printerAlign(ALIGN.CENTER);
    await p.printText("PAYMENT TRANSACTIONS\n", bold());
    await p.printerAlign(ALIGN.LEFT);
    await p.printText(`${line("-", w)}\n`, normal());

    for (const group of paymentTransactions) {
      // Payment type header
      const typeLabel = `-- ${group.paymentType} `;
      const typeLine = typeLabel + line("-", Math.max(0, w - typeLabel.length));
      await p.printText(`${typeLine}\n`, bold());

      for (const tx of group.transactions) {
        const orderRef = `#${tx.orderNumber}`;
        const ref = tx.referenceNumber;
        const amt = formatCurrency(tx.amount);

        // Print order number + ref on one line, amount right-aligned
        const leftPart = `${orderRef}  ${ref}`;
        await p.printText(`${formatRow(leftPart, amt, w)}\n`, normal());
      }

      // Subtotal
      await p.printText(`${formatRow("Subtotal", formatCurrency(group.subtotal), w)}\n`, normal());
    }

    await p.printText(`${line("=", w)}\n`, normal());
  }
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/day-closing/utils/zReportFormatter.ts
git commit -m "feat(native): category-grouped items and payment transactions in thermal print"
```

---

## Chunk 5: Web App — Category-Grouped Product Sales + Payment Transactions

### Task 8: Update web reports page — Product Sales tab (category grouping) + Payment Methods card

**Files:**
- Modify: `apps/web/src/app/(admin)/reports/page.tsx`

- [ ] **Step 1: Add payment transactions query**

After the existing `dateRangeReport` query (~line 85), add:

```typescript
  const paymentTransactions = useQuery(
    api.reports.getDailyPaymentTransactions,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId, reportDate } : "skip",
  );
```

- [ ] **Step 2: Replace the Product Sales tab content with category-grouped table**

Replace the Product Sales `TabsContent` (lines 449-504) — the entire `<TabsContent value="products">` block — with:

```tsx
        {/* Product Sales Tab — grouped by category */}
        <TabsContent value="products">
          <Card>
            <CardHeader>
              <CardTitle>Product Sales</CardTitle>
              <CardDescription>
                {productSales?.length ?? 0} product(s) sold on {reportDate}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedStoreId ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                  <ShoppingCart className="h-8 w-8 mb-2" />
                  <p>Please select a store to view product sales.</p>
                </div>
              ) : !productSales || productSales.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                  <ShoppingCart className="h-8 w-8 mb-2" />
                  <p>No product sales for this date.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty Sold</TableHead>
                      <TableHead className="text-right">Gross Amount</TableHead>
                      <TableHead className="text-right">Voided</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      // Group by category
                      const categoryMap = new Map<string, typeof productSales>();
                      for (const p of productSales) {
                        const cat = p.categoryName;
                        const existing = categoryMap.get(cat);
                        if (existing) existing.push(p);
                        else categoryMap.set(cat, [p]);
                      }
                      const categories = Array.from(categoryMap.entries()).sort((a, b) =>
                        a[0].localeCompare(b[0]),
                      );

                      return categories.flatMap(([catName, products]) => {
                        const catQty = products.reduce((s, p) => s + p.quantitySold, 0);
                        const catAmt = products.reduce((s, p) => s + p.grossAmount, 0);
                        const sorted = [...products].sort((a, b) => b.quantitySold - a.quantitySold);

                        return [
                          <TableRow key={`cat-${catName}`} className="bg-blue-50/50">
                            <TableCell colSpan={4} className="font-semibold text-blue-900">
                              {catName}
                            </TableCell>
                          </TableRow>,
                          ...sorted.map((product) => (
                            <TableRow key={product.productId}>
                              <TableCell className="font-medium pl-8">
                                {product.productName}
                              </TableCell>
                              <TableCell className="text-right">{product.quantitySold}</TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(product.grossAmount)}
                              </TableCell>
                              <TableCell className="text-right">
                                {product.voidedQuantity > 0 ? (
                                  <span className="text-red-600">
                                    {product.voidedQuantity} ({formatCurrency(product.voidedAmount)})
                                  </span>
                                ) : (
                                  "-"
                                )}
                              </TableCell>
                            </TableRow>
                          )),
                          <TableRow key={`sub-${catName}`} className="bg-sky-50/50">
                            <TableCell className="font-semibold text-sky-800 pl-8">
                              Subtotal
                            </TableCell>
                            <TableCell className="text-right font-semibold text-sky-800">
                              {catQty}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-sky-800">
                              {formatCurrency(catAmt)}
                            </TableCell>
                            <TableCell />
                          </TableRow>,
                        ];
                      });
                    })()}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
```

- [ ] **Step 3: Update the Payment Methods card in the Daily Report tab**

Replace the existing Payment Methods card (lines 404-419) with:

```tsx
                {/* Payment Methods */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Payment Methods</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <DetailRow label="Cash" value={formatCurrency(dailyReport.cashTotal)} />
                    <DetailRow
                      label="Card/E-Wallet"
                      value={formatCurrency(dailyReport.cardEwalletTotal)}
                    />
                    <div className="border-t pt-3">
                      <DetailRow label="Total" value={formatCurrency(dailyReport.netSales)} bold />
                    </div>

                    {/* Payment transaction details */}
                    {paymentTransactions && paymentTransactions.length > 0 && (
                      <div className="border-t pt-3 space-y-4">
                        <p className="text-sm font-semibold text-gray-700">Transaction Details</p>
                        {paymentTransactions.map((group) => (
                          <div key={group.paymentType} className="space-y-1">
                            <div className="flex justify-between items-center bg-green-50 px-3 py-1.5 rounded">
                              <span className="text-sm font-semibold text-green-800">
                                {group.paymentType}
                              </span>
                              <span className="text-xs text-green-700">
                                {group.transactions.length} txn(s)
                              </span>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="py-1 text-xs">Order #</TableHead>
                                  <TableHead className="py-1 text-xs">Reference #</TableHead>
                                  <TableHead className="py-1 text-xs text-right">Amount</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {group.transactions.map((tx) => (
                                  <TableRow key={tx.orderId}>
                                    <TableCell className="py-1.5 text-xs">
                                      #{tx.orderNumber}
                                    </TableCell>
                                    <TableCell className="py-1.5 text-xs font-mono">
                                      {tx.referenceNumber}
                                    </TableCell>
                                    <TableCell className="py-1.5 text-xs text-right">
                                      {formatCurrency(tx.amount)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                                <TableRow className="bg-green-50/50">
                                  <TableCell
                                    colSpan={2}
                                    className="py-1.5 text-xs font-semibold text-green-800"
                                  >
                                    Subtotal
                                  </TableCell>
                                  <TableCell className="py-1.5 text-xs text-right font-semibold text-green-800">
                                    {formatCurrency(group.subtotal)}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
```

- [ ] **Step 4: Pass `paymentTransactions` to `DownloadPdfButton` data prop and update guard**

First, update the guard condition that controls rendering of `DownloadPdfButton`. The existing guard is:

```tsx
{store && productSales && categorySales && hourlySales && (
```

Add `paymentTransactions` so the PDF button only appears once all data is loaded:

```tsx
{store && productSales && categorySales && hourlySales && paymentTransactions && (
```

Then, in the `DownloadPdfButton` `data` object, add `paymentTransactions` (after `hourlySales`):

```typescript
                            paymentTransactions,
```

(No `?? []` fallback needed since the guard ensures it's defined.)

- [ ] **Step 5: Verify typecheck passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: Type error in DownloadPdfButton/ReportPdfDocument (paymentTransactions not yet in their types) — will be fixed in Task 9.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/(admin)/reports/page.tsx
git commit -m "feat(web): category-grouped products and payment transaction details in reports page"
```

---

## Chunk 6: Web App — PDF Document Update

### Task 9: Update `ReportPdfDocument` for category grouping and payment transactions

**Files:**
- Modify: `apps/web/src/app/(admin)/reports/_components/ReportPdfDocument.tsx`

- [ ] **Step 1: Add `PaymentTransactionGroup` type to the interfaces**

After the `HourlySaleRow` interface, add:

```typescript
interface PaymentTransactionRow {
  orderId: string;
  orderNumber: string;
  referenceNumber: string;
  amount: number;
  paidAt: number;
}

interface PaymentTransactionGroup {
  paymentType: string;
  transactions: PaymentTransactionRow[];
  subtotal: number;
}
```

- [ ] **Step 2: Add `paymentTransactions` to `ReportPdfDocumentProps`**

Add to the interface:

```typescript
  paymentTransactions: PaymentTransactionGroup[];
```

- [ ] **Step 3: Destructure `paymentTransactions` in the component**

Add to the component's destructured props:

```typescript
  paymentTransactions,
```

- [ ] **Step 4: Replace the Product Sales Breakdown table with category-grouped version**

Replace the "Product Sales Breakdown" `<View style={s.section}>` block (lines 289-317) with:

```tsx
        {/* Product Sales Breakdown — grouped by category */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>
            Product Sales Breakdown ({productSales.length} products)
          </Text>
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.thText, { flex: 3 }]}>Product</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Qty</Text>
              <Text style={[s.thText, { flex: 1.5, textAlign: "right" }]}>Gross</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Void Qty</Text>
              <Text style={[s.thText, { flex: 1.5, textAlign: "right" }]}>Void Amt</Text>
            </View>
            {(() => {
              const catMap = new Map<string, ProductSaleRow[]>();
              for (const p of productSales) {
                const existing = catMap.get(p.categoryName);
                if (existing) existing.push(p);
                else catMap.set(p.categoryName, [p]);
              }
              const cats = Array.from(catMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

              return cats.flatMap(([catName, products]) => {
                const catQty = products.reduce((s, p) => s + p.quantitySold, 0);
                const catAmt = products.reduce((s, p) => s + p.grossAmount, 0);
                const sorted = [...products].sort((a, b) => b.quantitySold - a.quantitySold);

                return [
                  <View key={`cat-${catName}`} style={[s.tableRow, { backgroundColor: "#EFF6FF" }]}>
                    <Text style={[s.tdText, { flex: 8, fontFamily: "Helvetica-Bold", color: "#1E40AF" }]}>
                      {catName}
                    </Text>
                  </View>,
                  ...sorted.map((p, i) => (
                    <View key={p.productId} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                      <Text style={[s.tdText, { flex: 3, paddingLeft: 8 }]}>{p.productName}</Text>
                      <Text style={[s.tdRight, { flex: 1 }]}>{p.quantitySold}</Text>
                      <Text style={[s.tdRight, { flex: 1.5 }]}>{fmt(p.grossAmount)}</Text>
                      <Text style={[p.voidedQuantity > 0 ? s.tdRed : s.tdRight, { flex: 1 }]}>
                        {p.voidedQuantity > 0 ? p.voidedQuantity : "-"}
                      </Text>
                      <Text style={[p.voidedAmount > 0 ? s.tdRed : s.tdRight, { flex: 1.5 }]}>
                        {p.voidedAmount > 0 ? fmt(p.voidedAmount) : "-"}
                      </Text>
                    </View>
                  )),
                  <View key={`sub-${catName}`} style={[s.tableRow, { backgroundColor: "#F0F9FF" }]}>
                    <Text style={[s.tdText, { flex: 3, paddingLeft: 8, fontFamily: "Helvetica-Bold", color: "#0369A1" }]}>
                      Subtotal
                    </Text>
                    <Text style={[s.tdRight, { flex: 1, fontFamily: "Helvetica-Bold", color: "#0369A1" }]}>
                      {catQty}
                    </Text>
                    <Text style={[s.tdRight, { flex: 1.5, fontFamily: "Helvetica-Bold", color: "#0369A1" }]}>
                      {fmt(catAmt)}
                    </Text>
                    <Text style={[s.tdRight, { flex: 1 }]} />
                    <Text style={[s.tdRight, { flex: 1.5 }]} />
                  </View>,
                ];
              });
            })()}
          </View>
        </View>
```

- [ ] **Step 5: Add Payment Transactions section after the Payment Methods section**

After the existing Payment Methods `<View style={s.section}>` block (lines 282-286), add:

```tsx
        {/* Payment Transactions Detail */}
        {paymentTransactions.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Payment Transaction Details</Text>
            <View style={s.table}>
              <View style={s.tableHeader}>
                <Text style={[s.thText, { flex: 1.5 }]}>Order #</Text>
                <Text style={[s.thText, { flex: 2.5 }]}>Reference #</Text>
                <Text style={[s.thText, { flex: 1.5, textAlign: "right" }]}>Amount</Text>
              </View>
              {paymentTransactions.flatMap((group) => [
                <View key={`type-${group.paymentType}`} style={[s.tableRow, { backgroundColor: "#F0FDF4" }]}>
                  <Text style={[s.tdText, { flex: 4, fontFamily: "Helvetica-Bold", color: "#166534" }]}>
                    {group.paymentType} ({group.transactions.length})
                  </Text>
                  <Text style={[s.tdRight, { flex: 1.5, fontFamily: "Helvetica-Bold", color: "#166534" }]}>
                    {fmt(group.subtotal)}
                  </Text>
                </View>,
                ...group.transactions.map((tx, i) => (
                  <View key={tx.orderId} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                    <Text style={[s.tdText, { flex: 1.5 }]}>#{tx.orderNumber}</Text>
                    <Text style={[s.tdText, { flex: 2.5, fontFamily: "Courier" }]}>{tx.referenceNumber}</Text>
                    <Text style={[s.tdRight, { flex: 1.5 }]}>{fmt(tx.amount)}</Text>
                  </View>
                )),
              ])}
            </View>
          </View>
        )}
```

- [ ] **Step 6: Verify typecheck passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No type errors across the entire project

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/(admin)/reports/_components/ReportPdfDocument.tsx
git commit -m "feat(web): category-grouped products and payment transactions in PDF report"
```

---

## Chunk 7: Final Verification

### Task 10: Full typecheck and lint

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run lint and format check**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm check`
Expected: No errors (or auto-fixable only)

- [ ] **Step 3: Fix any lint issues**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm check --write`

- [ ] **Step 4: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "chore: fix lint and formatting"
```
