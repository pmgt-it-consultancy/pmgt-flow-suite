# Split Payment & Counter Ordering Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add split payment support, counter ordering category toggle, table marker field, fix daily order number reset, and fix kitchen receipt order type bug.

**Architecture:** New `orderPayments` table for unlimited payment splits per order. New `orderCategory` and `tableMarker` fields on orders. ESC/POS formatter refactored to use dedicated fields instead of overloading `tableName`. Order number generator restricted to today-only queries.

**Tech Stack:** Convex (backend schema/mutations/queries), React Native (native checkout/takeout screens), ESC/POS thermal printing

**Spec:** `docs/superpowers/specs/2026-03-28-split-payment-counter-ordering-design.md`

---

## Chunk 1: Schema, Order Number Fix, Kitchen Receipt Bug Fix

### Task 1: Add `orderPayments` table and new order fields to schema

**Files:**
- Modify: `packages/backend/convex/schema.ts:162-217` (orders table), end of file (new table)

- [ ] **Step 1: Add new fields to orders table**

In `packages/backend/convex/schema.ts`, add these fields to the `orders` table definition (after `cardReferenceNumber` around line 199):

```typescript
orderCategory: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
tableMarker: v.optional(v.string()),
```

- [ ] **Step 2: Add `orderPayments` table**

At the end of the schema (before the closing `export default` or final schema call), add:

```typescript
orderPayments: defineTable({
  orderId: v.id("orders"),
  storeId: v.id("stores"),
  paymentMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
  amount: v.number(),
  cashReceived: v.optional(v.number()),
  changeGiven: v.optional(v.number()),
  cardPaymentType: v.optional(v.string()),
  cardReferenceNumber: v.optional(v.string()),
  createdAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_order", ["orderId"])
  .index("by_store", ["storeId"])
  .index("by_store_and_method", ["storeId", "paymentMethod"]),
```

- [ ] **Step 3: Run typecheck to verify schema compiles**

Run: `cd packages/backend && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add orderPayments table and order category/marker fields"
```

---

### Task 2: Fix daily order number reset

**Files:**
- Modify: `packages/backend/convex/orders.ts:12-52` (getNextOrderNumber function)
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write failing test for daily reset**

In `packages/backend/convex/orders.test.ts`, add a test that verifies order numbers reset daily. The test should:
- Create an order with a previous day's timestamp and orderNumber "T-005"
- Leave that order in "open" status
- Call the order creation for today
- Assert the new order gets "T-001", not "T-006"

```typescript
describe("order number daily reset", () => {
  it("should start at T-001 regardless of open orders from previous days", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, categoryId, productId } = await setupAuthenticatedUser(t);

    // Insert a previous-day open order directly
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-005",
        orderType: "takeout",
        orderChannel: "walk_in_takeout",
        status: "open",
        grossSales: 100,
        vatableSales: 89.29,
        vatAmount: 10.71,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 100,
        createdBy: userId,
        createdAt: yesterday,
      });
    });

    // Create a new draft order today — should get T-001, not T-006
    const asUser = t.withIdentity({ subject: userId });
    const orderId = await asUser.mutation(api.orders.createDraftOrder, {
      storeId,
    });

    const result = await asUser.mutation(api.orders.submitDraft, { orderId });
    expect(result.orderNumber).toBe("T-001");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && pnpm vitest run orders.test.ts -t "daily reset"`
Expected: FAIL — returns "T-006" instead of "T-001"

- [ ] **Step 3: Fix getNextOrderNumber to only count today's orders**

In `packages/backend/convex/orders.ts`, modify the `getNextOrderNumber` function (lines 12-52). Remove the query for `openOrdersFromPreviousDays` and only use `todaysOrders`:

```typescript
async function getNextOrderNumber(
  ctx: { db: any },
  storeId: Id<"stores">,
  orderType: "dine_in" | "takeout",
): Promise<string> {
  const prefix = orderType === "dine_in" ? "D" : "T";
  const { startOfDay, endOfDay } = getPHTDayBoundaries();

  // Get today's orders of this type only (using PHT day boundaries)
  const todaysOrders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q.eq("storeId", storeId).gte("createdAt", startOfDay),
    )
    .filter((q: any) =>
      q.and(q.lt(q.field("createdAt"), endOfDay), q.eq(q.field("orderType"), orderType)),
    )
    .collect();

  // Find the highest existing number from today only
  let maxNumber = 0;
  for (const order of todaysOrders) {
    const match = order.orderNumber?.match(/\d+$/);
    if (match) {
      maxNumber = Math.max(maxNumber, Number.parseInt(match[0], 10));
    }
  }

  const nextNumber = maxNumber + 1;
  return `${prefix}-${nextNumber.toString().padStart(3, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/backend && pnpm vitest run orders.test.ts -t "daily reset"`
Expected: PASS

- [ ] **Step 5: Run all order tests to check for regressions**

Run: `cd packages/backend && pnpm vitest run orders.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "fix(backend): reset order numbers daily, ignore previous day open orders"
```

---

### Task 3: Fix kitchen receipt bug — order type lost when customer name set

**Files:**
- Modify: `apps/native/src/features/settings/services/escposFormatter.ts:11-17` (KitchenTicketData interface), `187-227` (printKitchenTicketToThermal)
- Modify: `apps/native/src/features/checkout/screens/CheckoutScreen.tsx:342-359` (kitchen ticket data construction)

- [ ] **Step 1: Update KitchenTicketData interface**

In `apps/native/src/features/settings/services/escposFormatter.ts`, replace the `KitchenTicketData` interface (lines 11-17). Remove `tableName`, add `tableMarker`, `customerName`, and `orderCategory`:

```typescript
interface KitchenTicketData {
  orderNumber: string;
  orderType: "dine_in" | "take_out" | "delivery";
  orderCategory?: "dine_in" | "takeout";
  tableMarker?: string;
  customerName?: string;
  items: KitchenTicketItem[];
  timestamp: Date;
}
```

- [ ] **Step 2: Update printKitchenTicketToThermal function**

In the same file, update the `printKitchenTicketToThermal` function (lines 187-227). Replace the `tableName` logic (lines 200-204) with the new field formatting:

The order of display should be:
1. Order number — large and bold (already exists)
2. Table marker — if set, prominent and centered between separator lines
3. Order category (or orderType fallback) — always shown
4. Customer name — if set, own line

Replace the `tableName` block (lines 200-204) with the following, using the existing imperative `p.printText()` API with `bold()`, `large()`, `normal()` helpers:

```typescript
// Table marker — prominent, centered, between separators
if (data.tableMarker) {
  await p.printText(`==================\n`, normal());
  await p.printText(`${data.tableMarker}\n`, large());
  await p.printText(`==================\n`, normal());
}

// Order category or type — always shown
const categoryLabel = data.orderCategory
  ? (data.orderCategory === "dine_in" ? "DINE-IN" : "TAKEOUT")
  : orderTypeLabel(data.orderType).toUpperCase();
await p.printText(`${categoryLabel}\n`, bold());

// Customer name — if set
if (data.customerName) {
  await p.printText(`Customer: ${data.customerName}\n`, normal());
}
```

Note: `large()`, `bold()`, `normal()` are existing helper functions in the file. `large()` applies `widthtimes: 1, heigthtimes: 1` for prominent text.

- [ ] **Step 3: Update CheckoutScreen kitchen ticket construction**

In `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`, update the kitchen ticket data construction (lines 342-359). Replace the `tableName` line with the new fields:

Replace:
```typescript
tableName: isTakeout ? order.customerName || "Takeout" : tableName || "",
```

With:
```typescript
tableMarker: order.tableMarker,
customerName: order.customerName,
orderCategory: order.orderCategory,
```

This requires that the order object passed to checkout has the new `tableMarker` and `orderCategory` fields. These come from the Convex query, so they'll be available once the schema is updated (Task 1).

- [ ] **Step 4: Update customer receipt formatting**

In `escposFormatter.ts`, update the `printReceiptToThermal` function (lines 53-185). In the order info section, add table marker to the order number display:

Find where `orderNumber` is printed and change it to append the marker:
```typescript
const receiptNumber = data.tableMarker
  ? `${data.orderNumber} | ${data.tableMarker}`
  : data.orderNumber;
```

Use `receiptNumber` wherever the order number is displayed on the customer receipt.

Also add `orderCategory` display in the receipt info section (as "Type: DINE-IN" or "Type: TAKEOUT").

- [ ] **Step 5: Run typecheck on native app**

Run: `cd apps/native && pnpm tsc --noEmit`
Expected: May show errors for other files still using old `tableName` — fix any remaining references.

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/settings/services/escposFormatter.ts apps/native/src/features/checkout/screens/CheckoutScreen.tsx
git commit -m "fix(native): show order type on kitchen ticket, add table marker to receipts"
```

---

## Chunk 2: Counter Ordering (Category + Table Marker on Takeout Screen)

### Task 4: Add orderCategory and tableMarker to backend mutations

**Files:**
- Modify: `packages/backend/convex/orders.ts:167-235` (createDraftOrder), `1087-1106` (updateCustomerName)
- Modify: `packages/backend/convex/checkout.ts:153-280` (getReceipt return type)

- [ ] **Step 1: Update createDraftOrder to accept orderCategory and tableMarker**

In `packages/backend/convex/orders.ts`, find `createDraftOrder` (line 167). Add `orderCategory` and `tableMarker` to the `args` validator:

```typescript
args: {
  storeId: v.id("stores"),
  orderCategory: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
  tableMarker: v.optional(v.string()),
},
```

In the handler, include the new fields when inserting the order:

```typescript
orderCategory: args.orderCategory,
tableMarker: args.tableMarker,
```

- [ ] **Step 2: Update updateCustomerName to also update tableMarker and orderCategory**

In `packages/backend/convex/orders.ts`, find `updateCustomerName` (line 1087). Rename to `updateOrderDetails` or add new args:

```typescript
args: {
  orderId: v.id("orders"),
  customerName: v.optional(v.string()),
  tableMarker: v.optional(v.string()),
  orderCategory: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
},
```

In the handler, patch all provided fields:

```typescript
const updates: Record<string, any> = {};
if (args.customerName !== undefined) updates.customerName = args.customerName;
if (args.tableMarker !== undefined) updates.tableMarker = args.tableMarker;
if (args.orderCategory !== undefined) updates.orderCategory = args.orderCategory;
await ctx.db.patch(args.orderId, updates);
```

- [ ] **Step 3: Update getReceipt to include new fields**

In `packages/backend/convex/checkout.ts`, find `getReceipt` (line 153). Add `orderCategory` and `tableMarker` to the return validator and handler response:

Add to returns:
```typescript
orderCategory: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
tableMarker: v.optional(v.string()),
```

Add to handler return object:
```typescript
orderCategory: order.orderCategory,
tableMarker: order.tableMarker,
```

- [ ] **Step 4: Run typecheck**

Run: `cd packages/backend && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/checkout.ts
git commit -m "feat(backend): accept orderCategory and tableMarker in order mutations"
```

---

### Task 5: Add category toggle and table marker to TakeoutOrderScreen

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx:404-451` (customer name area)

- [ ] **Step 1: Add state variables for orderCategory and tableMarker**

Near the existing state declarations (around line 47), add:

```typescript
const [orderCategory, setOrderCategory] = useState<"dine_in" | "takeout">("takeout");
const [tableMarker, setTableMarker] = useState("");
```

- [ ] **Step 2: Add category toggle UI above table marker and customer name**

Before the existing customer name input (line 404), add a category toggle. Use the same toggle button pattern as `PaymentMethodSelector`:

```tsx
{/* Order Category Toggle */}
<XStack gap={8} paddingHorizontal={16} paddingTop={12}>
  <TouchableOpacity
    onPress={() => setOrderCategory("dine_in")}
    style={{
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: orderCategory === "dine_in" ? "#DBEAFE" : "#F3F4F6",
      borderWidth: 1.5,
      borderColor: orderCategory === "dine_in" ? "#0D87E1" : "#E5E7EB",
      alignItems: "center",
    }}
  >
    <Text style={{
      fontWeight: "600",
      color: orderCategory === "dine_in" ? "#0D87E1" : "#6B7280",
    }}>
      Dine-in
    </Text>
  </TouchableOpacity>
  <TouchableOpacity
    onPress={() => setOrderCategory("takeout")}
    style={{
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: orderCategory === "takeout" ? "#DBEAFE" : "#F3F4F6",
      borderWidth: 1.5,
      borderColor: orderCategory === "takeout" ? "#0D87E1" : "#E5E7EB",
      alignItems: "center",
    }}
  >
    <Text style={{
      fontWeight: "600",
      color: orderCategory === "takeout" ? "#0D87E1" : "#6B7280",
    }}>
      Takeout
    </Text>
  </TouchableOpacity>
</XStack>
```

- [ ] **Step 3: Add table marker input next to customer name**

Modify the customer name input area (lines 404-451) to be a row with table marker and customer name side by side:

```tsx
<XStack gap={8} paddingHorizontal={16} paddingTop={8}>
  {/* Table Marker — short input */}
  <YStack flex={0} width={100}>
    <Text style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>Marker</Text>
    <TextInput
      value={tableMarker}
      onChangeText={setTableMarker}
      onBlur={handleTableMarkerBlur}
      placeholder="e.g. 15"
      style={{
        backgroundColor: tableMarker ? "#FFF7ED" : "#F9FAFB",
        borderWidth: 1,
        borderColor: tableMarker ? "#FDBA74" : "#E5E7EB",
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 16,
        fontWeight: "600",
        textAlign: "center",
      }}
    />
  </YStack>

  {/* Customer Name — flex fill */}
  <YStack flex={1}>
    <Text style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>Customer Name</Text>
    {/* Keep existing customer name TextInput, just wrapped in this YStack */}
  </YStack>
</XStack>
```

- [ ] **Step 4: Wire up mutations to save orderCategory and tableMarker**

**Important:** In the current flow, the draft order is created in the parent screen (TakeoutListScreen) before navigating to TakeoutOrderScreen. The `orderId` already exists by the time this screen loads. Therefore, do NOT modify the `createDraftOrder` call. Instead, use the `updateCustomerName` mutation (renamed to `updateOrderDetails` in Task 4) to save `orderCategory` and `tableMarker` after the screen loads.

On category toggle change, save immediately:

```typescript
const handleCategoryChange = useCallback(async (category: "dine_in" | "takeout") => {
  setOrderCategory(category);
  if (orderId) {
    await updateOrderDetailsMutation({
      orderId,
      orderCategory: category,
    });
  }
}, [orderId]);
```

On table marker blur, save:

```typescript
const handleTableMarkerBlur = useCallback(async () => {
  if (orderId) {
    await updateOrderDetailsMutation({
      orderId,
      tableMarker: tableMarker || undefined,
    });
  }
}, [orderId, tableMarker]);
```

On screen load, set the default category ("takeout") on the order:

```typescript
useEffect(() => {
  if (orderId) {
    updateOrderDetailsMutation({ orderId, orderCategory: "takeout" });
  }
}, [orderId]);
```

- [ ] **Step 5: Pass orderCategory to checkout navigation**

Update the navigation to CheckoutScreen (line 328) to include the new fields:

```typescript
navigation.navigate("CheckoutScreen", {
  orderId,
  orderType: "takeout",
  orderCategory,
  tableMarker: tableMarker || undefined,
});
```

- [ ] **Step 6: Run typecheck on native app**

Run: `cd apps/native && pnpm tsc --noEmit`
Expected: No errors (or fix any type mismatches in navigation params)

- [ ] **Step 7: Commit**

```bash
git add apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx
git commit -m "feat(native): add category toggle and table marker to takeout screen"
```

---

## Chunk 3: Split Payment Backend

### Task 6: Write processPayment mutation with tests

**Files:**
- Modify: `packages/backend/convex/checkout.ts`
- Test: `packages/backend/convex/checkout.test.ts`

- [ ] **Step 1: Write failing test for single cash payment via new processPayment**

In `packages/backend/convex/checkout.test.ts`, add:

```typescript
describe("checkout — processPayment (split payments)", () => {
  it("should process a single cash payment", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupAuthenticatedUser(t);
    const orderId = await createOpenOrder(t, storeId, userId, 10000);

    const asUser = t.withIdentity({ subject: userId });
    const result = await asUser.mutation(api.checkout.processPayment, {
      orderId,
      payments: [{
        paymentMethod: "cash",
        amount: 10000,
        cashReceived: 12000,
      }],
    });

    expect(result.success).toBe(true);

    // Verify order is paid
    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("paid");
    expect(order?.paidAt).toBeDefined();

    // Verify orderPayments row
    const payments = await t.run(async (ctx) =>
      ctx.db.query("orderPayments").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].paymentMethod).toBe("cash");
    expect(payments[0].amount).toBe(10000);
    expect(payments[0].cashReceived).toBe(12000);
    expect(payments[0].changeGiven).toBe(2000);
  });

  it("should process split payment (cash + card)", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupAuthenticatedUser(t);
    const orderId = await createOpenOrder(t, storeId, userId, 39000);

    const asUser = t.withIdentity({ subject: userId });
    const result = await asUser.mutation(api.checkout.processPayment, {
      orderId,
      payments: [
        {
          paymentMethod: "cash",
          amount: 29000,
          cashReceived: 29000,
        },
        {
          paymentMethod: "card_ewallet",
          amount: 10000,
          cardPaymentType: "GCash",
          cardReferenceNumber: "REF123456",
        },
      ],
    });

    expect(result.success).toBe(true);

    // Verify 2 payment rows
    const payments = await t.run(async (ctx) =>
      ctx.db.query("orderPayments").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()
    );
    expect(payments).toHaveLength(2);
    expect(payments.find((p) => p.paymentMethod === "cash")?.amount).toBe(29000);
    expect(payments.find((p) => p.paymentMethod === "card_ewallet")?.cardPaymentType).toBe("GCash");
  });

  it("should reject if total payments < netSales", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupAuthenticatedUser(t);
    const orderId = await createOpenOrder(t, storeId, userId, 10000);

    const asUser = t.withIdentity({ subject: userId });
    await expect(
      asUser.mutation(api.checkout.processPayment, {
        orderId,
        payments: [{
          paymentMethod: "cash",
          amount: 5000,
          cashReceived: 5000,
        }],
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && pnpm vitest run checkout.test.ts -t "processPayment"`
Expected: FAIL — `processPayment` does not exist yet

- [ ] **Step 3: Implement processPayment mutation**

In `packages/backend/convex/checkout.ts`, add the new mutation:

```typescript
export const processPayment = mutation({
  args: {
    orderId: v.id("orders"),
    payments: v.array(
      v.object({
        paymentMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
        amount: v.number(),
        cashReceived: v.optional(v.number()),
        cardPaymentType: v.optional(v.string()),
        cardReferenceNumber: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    success: v.boolean(),
    totalChange: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");

    // Idempotency: if already paid, return success
    if (order.status === "paid") {
      return { success: true, totalChange: 0 };
    }
    if (order.status !== "open") throw new Error("Order is not open");

    // Validate total payments >= netSales
    const totalPayments = args.payments.reduce((sum, p) => sum + p.amount, 0);
    if (totalPayments < order.netSales) {
      throw new Error("Total payments insufficient");
    }

    // Validate each payment line
    for (const payment of args.payments) {
      if (payment.amount <= 0) throw new Error("Payment amount must be positive");
      if (payment.paymentMethod === "card_ewallet") {
        if (!payment.cardPaymentType) throw new Error("Card payment type required");
        if (!payment.cardReferenceNumber) throw new Error("Reference number required");
      }
    }

    // Insert payment rows
    let totalChange = 0;
    for (const payment of args.payments) {
      let changeGiven: number | undefined;
      if (payment.paymentMethod === "cash" && payment.cashReceived) {
        changeGiven = payment.cashReceived - payment.amount;
        if (changeGiven > 0) totalChange += changeGiven;
        if (changeGiven < 0) changeGiven = 0;
      }

      await ctx.db.insert("orderPayments", {
        orderId: args.orderId,
        storeId: order.storeId,
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
        cashReceived: payment.cashReceived,
        changeGiven,
        cardPaymentType: payment.cardPaymentType,
        cardReferenceNumber: payment.cardReferenceNumber,
        createdAt: Date.now(),
        createdBy: user._id,
      });
    }

    // Update order status
    await ctx.db.patch(args.orderId, {
      status: "paid",
      paidAt: Date.now(),
      paidBy: user._id,
    });

    // Release table if dine-in
    if (order.tableId) {
      await releaseTableIfLastOrder(ctx, order.tableId, args.orderId);
    }

    // Advance takeout status
    if (order.orderType === "takeout" && order.takeoutStatus === "pending") {
      await ctx.db.patch(args.orderId, { takeoutStatus: "preparing" });
    }

    return { success: true, totalChange };
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && pnpm vitest run checkout.test.ts -t "processPayment"`
Expected: All 3 tests PASS

- [ ] **Step 5: Update old mutations to delegate to shared logic**

Extract the core payment processing into an internal helper `processPaymentCore(ctx, orderId, payments, userId)`. Then:

- `processPayment` calls `processPaymentCore` directly
- `processCashPayment` constructs a single-element payments array and calls `processPaymentCore`. It also still patches the legacy order fields (`paymentMethod: "cash"`, `cashReceived`, `changeGiven`) for backward compatibility
- `processCardPayment` constructs a single-element payments array and calls `processPaymentCore`. It also still patches the legacy order fields (`paymentMethod: "card_ewallet"`, `cardPaymentType`, `cardReferenceNumber`)

This ensures old mutations write to both `orderPayments` AND the legacy order fields, so `getReceipt` legacy fallback still works for orders created via old mutations.

```typescript
async function processPaymentCore(
  ctx: MutationCtx,
  orderId: Id<"orders">,
  payments: Array<{ paymentMethod: "cash" | "card_ewallet"; amount: number; cashReceived?: number; cardPaymentType?: string; cardReferenceNumber?: string }>,
  userId: Id<"users">,
): Promise<{ success: boolean; totalChange: number }> {
  // ... shared validation, insert orderPayments rows, update order status, release table, advance takeout
}
```

- [ ] **Step 6: Run all checkout tests**

Run: `cd packages/backend && pnpm vitest run checkout.test.ts`
Expected: All tests pass (old + new)

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/checkout.ts packages/backend/convex/checkout.test.ts
git commit -m "feat(backend): add processPayment mutation for split payments"
```

---

### Task 7: Update getReceipt to return payments array

**Files:**
- Modify: `packages/backend/convex/checkout.ts:153-280` (getReceipt query)
- Test: `packages/backend/convex/checkout.test.ts`

- [ ] **Step 1: Write failing test for getReceipt with split payments**

```typescript
describe("checkout — getReceipt with split payments", () => {
  it("should return payments array for new split payment orders", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupAuthenticatedUser(t);
    const orderId = await createOpenOrder(t, storeId, userId, 39000);

    // Process split payment
    const asUser = t.withIdentity({ subject: userId });
    await asUser.mutation(api.checkout.processPayment, {
      orderId,
      payments: [
        { paymentMethod: "cash", amount: 29000, cashReceived: 29000 },
        { paymentMethod: "card_ewallet", amount: 10000, cardPaymentType: "GCash", cardReferenceNumber: "REF123" },
      ],
    });

    const receipt = await asUser.query(api.checkout.getReceipt, { orderId });
    expect(receipt.payments).toHaveLength(2);
    expect(receipt.payments[0].paymentMethod).toBe("cash");
    expect(receipt.payments[1].cardPaymentType).toBe("GCash");
  });

  it("should return single-element payments array for legacy orders", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupAuthenticatedUser(t);

    // Create a legacy paid order (payment data on order, no orderPayments rows)
    const orderId = await t.run(async (ctx) => {
      return ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-001",
        orderType: "dine_in",
        orderChannel: "walk_in_dine_in",
        status: "paid",
        grossSales: 10000,
        vatableSales: 8929,
        vatAmount: 1071,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 10000,
        paymentMethod: "cash",
        cashReceived: 12000,
        changeGiven: 2000,
        paidAt: Date.now(),
        paidBy: userId,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    const asUser = t.withIdentity({ subject: userId });
    const receipt = await asUser.query(api.checkout.getReceipt, { orderId });
    expect(receipt.payments).toHaveLength(1);
    expect(receipt.payments[0].paymentMethod).toBe("cash");
    expect(receipt.payments[0].cashReceived).toBe(12000);
    expect(receipt.payments[0].changeGiven).toBe(2000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && pnpm vitest run checkout.test.ts -t "getReceipt with split"`
Expected: FAIL — `payments` field not in return type

- [ ] **Step 3: Update getReceipt return validator and handler**

Add `payments` to the return validator:

```typescript
payments: v.array(v.object({
  paymentMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
  amount: v.number(),
  cashReceived: v.optional(v.number()),
  changeGiven: v.optional(v.number()),
  cardPaymentType: v.optional(v.string()),
  cardReferenceNumber: v.optional(v.string()),
})),
```

Also add `orderCategory` and `tableMarker` to the return validator:

```typescript
orderCategory: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
tableMarker: v.optional(v.string()),
```

In the handler, query `orderPayments` and build the array:

```typescript
// Fetch payment rows
const paymentRows = await ctx.db
  .query("orderPayments")
  .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
  .collect();

// Build payments array — use orderPayments if available, else legacy fields
const payments = paymentRows.length > 0
  ? paymentRows.map((p) => ({
      paymentMethod: p.paymentMethod,
      amount: p.amount,
      cashReceived: p.cashReceived,
      changeGiven: p.changeGiven,
      cardPaymentType: p.cardPaymentType,
      cardReferenceNumber: p.cardReferenceNumber,
    }))
  : order.paymentMethod
    ? [{
        paymentMethod: order.paymentMethod,
        amount: order.netSales,
        cashReceived: order.cashReceived,
        changeGiven: order.changeGiven,
        cardPaymentType: order.cardPaymentType,
        cardReferenceNumber: order.cardReferenceNumber,
      }]
    : [];
```

Include `payments`, `orderCategory`, and `tableMarker` in the return object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && pnpm vitest run checkout.test.ts -t "getReceipt with split"`
Expected: PASS

- [ ] **Step 5: Write test for orderCategory and tableMarker in getReceipt**

```typescript
it("should return orderCategory and tableMarker in receipt", async () => {
  const t = convexTest(schema, modules);
  const { storeId, userId } = await setupAuthenticatedUser(t);

  // Create a paid order with orderCategory and tableMarker
  const orderId = await t.run(async (ctx) => {
    return ctx.db.insert("orders", {
      storeId,
      orderNumber: "T-001",
      orderType: "takeout",
      orderChannel: "walk_in_takeout",
      status: "paid",
      orderCategory: "dine_in",
      tableMarker: "15",
      grossSales: 10000,
      vatableSales: 8929,
      vatAmount: 1071,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 10000,
      paymentMethod: "cash",
      cashReceived: 10000,
      changeGiven: 0,
      paidAt: Date.now(),
      paidBy: userId,
      createdBy: userId,
      createdAt: Date.now(),
    });
  });

  const asUser = t.withIdentity({ subject: userId });
  const receipt = await asUser.query(api.checkout.getReceipt, { orderId });
  expect(receipt.orderCategory).toBe("dine_in");
  expect(receipt.tableMarker).toBe("15");
});
```

- [ ] **Step 6: Run test and verify it passes**

Run: `cd packages/backend && pnpm vitest run checkout.test.ts -t "orderCategory and tableMarker"`
Expected: PASS (since Task 4 Step 3 already added these to getReceipt)

- [ ] **Step 7: Run all checkout tests**

Run: `cd packages/backend && pnpm vitest run checkout.test.ts`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add packages/backend/convex/checkout.ts packages/backend/convex/checkout.test.ts
git commit -m "feat(backend): return payments array from getReceipt with legacy fallback"
```

---

## Chunk 4: Split Payment Native UI

### Task 8: Build split payment UI on CheckoutScreen

**Files:**
- Modify: `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`
- Create: `apps/native/src/features/checkout/components/PaymentLineItem.tsx`

- [ ] **Step 1: Create PaymentLineItem component**

Create a new component for each payment row in the split payment UI.

File: `apps/native/src/features/checkout/components/PaymentLineItem.tsx`

```tsx
import React from "react";
import { TextInput, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../shared/components/ui";

interface PaymentLine {
  id: string;
  paymentMethod: "cash" | "card_ewallet";
  amount: string;
  cashReceived: string;
  cardPaymentType: string;
  cardReferenceNumber: string;
  customPaymentType: string;
}

interface PaymentLineItemProps {
  line: PaymentLine;
  index: number;
  canRemove: boolean;
  onUpdate: (id: string, updates: Partial<PaymentLine>) => void;
  onRemove: (id: string) => void;
}

export function PaymentLineItem({ line, index, canRemove, onUpdate, onRemove }: PaymentLineItemProps) {
  // Render payment method toggle (Cash / Card/E-Wallet)
  // Render amount input
  // If cash: render cash tendered input
  // If card: render payment type selector + reference number
  // Remove button (if canRemove)
  // Follow existing PaymentMethodSelector, CashInput, CardPaymentDetails patterns
}
```

The component should reuse the existing styling patterns from `PaymentMethodSelector`, `CashInput`, and `CardPaymentDetails` — adapt them to work inline within a payment line.

- [ ] **Step 2: Refactor CheckoutScreen payment state**

Replace the single-payment state variables (lines 49-53) with a payment lines array:

```typescript
interface PaymentLine {
  id: string;
  paymentMethod: "cash" | "card_ewallet";
  amount: string;
  cashReceived: string;
  cardPaymentType: string;
  cardReferenceNumber: string;
  customPaymentType: string;
}

const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
  {
    id: "1",
    paymentMethod: "cash",
    amount: "",
    cashReceived: "",
    cardPaymentType: "",
    cardReferenceNumber: "",
    customPaymentType: "",
  },
]);
```

Add helper functions:

```typescript
const addPaymentLine = () => {
  setPaymentLines((prev) => [
    ...prev,
    {
      id: String(Date.now()),
      paymentMethod: "card_ewallet",
      amount: "",
      cashReceived: "",
      cardPaymentType: "",
      cardReferenceNumber: "",
      customPaymentType: "",
    },
  ]);
};

const removePaymentLine = (id: string) => {
  setPaymentLines((prev) => prev.filter((l) => l.id !== id));
};

const updatePaymentLine = (id: string, updates: Partial<PaymentLine>) => {
  setPaymentLines((prev) =>
    prev.map((l) => (l.id === id ? { ...l, ...updates } : l)),
  );
};
```

- [ ] **Step 3: Add remaining balance display and "Add Payment" button**

Calculate and display the remaining balance:

```typescript
const totalPayments = paymentLines.reduce(
  (sum, l) => sum + (parseFloat(l.amount) || 0),
  0,
);
const remaining = (order?.netSales ?? 0) - totalPayments;
```

Render:
```tsx
{/* Remaining balance */}
<XStack justifyContent="space-between" paddingHorizontal={16} paddingVertical={8}>
  <Text variant="heading" size="lg">
    {remaining > 0 ? `Remaining: ₱${remaining.toFixed(2)}` : "Fully covered"}
  </Text>
</XStack>

{/* Add Payment button */}
<TouchableOpacity onPress={addPaymentLine} style={{
  marginHorizontal: 16,
  paddingVertical: 12,
  borderRadius: 10,
  borderWidth: 1.5,
  borderColor: "#0D87E1",
  borderStyle: "dashed",
  alignItems: "center",
}}>
  <Text style={{ color: "#0D87E1", fontWeight: "600" }}>+ Add Payment Method</Text>
</TouchableOpacity>
```

- [ ] **Step 4: Update handleProcessPayment to use payment lines**

Replace the existing payment processing logic (lines 293-391) to build the payments array from `paymentLines`:

```typescript
const payments = paymentLines.map((line) => ({
  paymentMethod: line.paymentMethod,
  amount: parseFloat(line.amount) || 0,
  cashReceived: line.paymentMethod === "cash" ? parseFloat(line.cashReceived) || undefined : undefined,
  cardPaymentType: line.paymentMethod === "card_ewallet"
    ? (line.cardPaymentType === "Other" ? line.customPaymentType : line.cardPaymentType) || undefined
    : undefined,
  cardReferenceNumber: line.paymentMethod === "card_ewallet" ? line.cardReferenceNumber || undefined : undefined,
}));

const result = await processPaymentMutation({ orderId, payments });
```

- [ ] **Step 5: Update createReceiptData for split payments**

Update `createReceiptData` (lines 221-291) to handle multiple payments. The receipt data structure needs a `payments` array instead of single payment fields.

- [ ] **Step 6: Run typecheck**

Run: `cd apps/native && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/native/src/features/checkout/
git commit -m "feat(native): add split payment UI with multiple payment lines"
```

---

### Task 9: Update receipt formatting for split payments

**Files:**
- Modify: `apps/native/src/features/shared/utils/receipt.ts` (ReceiptData type definition)
- Modify: `apps/native/src/features/settings/services/escposFormatter.ts:53-185` (printReceiptToThermal, payment section)
- Modify: `apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx`
- Modify: `apps/native/src/features/checkout/screens/CheckoutScreen.tsx:221-291` (createReceiptData)

- [ ] **Step 1: Update ReceiptData interface for split payments**

In `apps/native/src/features/shared/utils/receipt.ts`, add `payments` array, `orderCategory`, and `tableMarker` to the `ReceiptData` interface:

```typescript
payments: Array<{
  paymentMethod: "cash" | "card_ewallet";
  amount: number;
  cashReceived?: number;
  changeGiven?: number;
  cardPaymentType?: string;
  cardReferenceNumber?: string;
}>;
```

Also add `orderCategory` and `tableMarker` to the receipt data interface.

- [ ] **Step 2: Update printReceiptToThermal payment section**

In `escposFormatter.ts`, update the payment rendering section (lines 157-171) to iterate over payments array:

```typescript
// Payment section
for (const payment of data.payments) {
  if (payment.paymentMethod === "cash") {
    // Print: Cash  ₱X,XXX.XX
    // If cashReceived: Amount Tendered  ₱X,XXX.XX
    // If changeGiven: Change  ₱X,XXX.XX
  } else {
    // Print: [cardPaymentType]  ₱X,XXX.XX
    // Print: Ref: [cardReferenceNumber]
  }
}
```

Update the order number display to include table marker. The existing code at line 79 uses `data.receiptNumber`. Build the receipt number upstream in `createReceiptData` (CheckoutScreen.tsx):

```typescript
receiptNumber: order.tableMarker
  ? `${order.orderNumber} | ${order.tableMarker}`
  : order.orderNumber,
```

- [ ] **Step 3: Update createReceiptData in CheckoutScreen**

In `CheckoutScreen.tsx`, update `createReceiptData` (lines 221-291) to:
- Build `receiptNumber` with table marker appended (as shown above)
- Populate the `payments` array from the payment lines state
- Include `orderCategory` and `tableMarker` in the receipt data object

- [ ] **Step 4: Update ReceiptPreviewModal for split payments**

Update the receipt preview component to display multiple payment lines, matching the thermal printer format.

- [ ] **Step 5: Run typecheck**

Run: `cd apps/native && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/settings/services/escposFormatter.ts apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx apps/native/src/features/shared/utils/receipt.ts apps/native/src/features/checkout/screens/CheckoutScreen.tsx
git commit -m "feat(native): update receipt formatting for split payments and table marker"
```

---

## Chunk 5: Web App Updates & Final Integration

### Task 10: Update web order details for split payments

**Files:**
- Modify: `apps/web/src/app/(admin)/orders/page.tsx` (order details dialog, payment info section)

- [ ] **Step 1: Update payment info section in order details dialog**

In the order details dialog (lines 514-548), update the payment info section to handle the `payments` array from `getReceipt`:

```tsx
{receipt?.payments?.map((payment, index) => (
  <div key={index} className="flex justify-between">
    <span>{payment.paymentMethod === "cash" ? "Cash" : payment.cardPaymentType}</span>
    <span>₱{payment.amount.toFixed(2)}</span>
  </div>
))}
```

Show table marker in order info if present:

```tsx
{receipt?.tableMarker && (
  <div>Order: {receipt.orderNumber} | {receipt.tableMarker}</div>
)}
```

Show order category if present:

```tsx
{receipt?.orderCategory && (
  <div>Category: {receipt.orderCategory === "dine_in" ? "Dine-in" : "Takeout"}</div>
)}
```

- [ ] **Step 2: Run web lint**

Run: `cd apps/web && pnpm lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(admin)/orders/page.tsx
git commit -m "feat(web): display split payments and table marker in order details"
```

---

### Task 11: End-to-end verification and cleanup

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 2: Run typecheck across all packages**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run lint and format**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git commit -m "chore: cleanup and verify split payment integration"
```
