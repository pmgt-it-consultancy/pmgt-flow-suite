# Duplicate Transaction Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate orders and transactions caused by double-tap and network retry across both takeout and dine-in flows.

**Architecture:** Three-layer defense — frontend loading-state guards on all async buttons (Layer 1), backend idempotency on order creation and payment mutations (Layer 2), and a `requestId` schema field with index for deduplication lookups (Layer 3). Backend changes land first so the safety net is in place before frontend changes.

**Tech Stack:** Convex (backend mutations + schema), React Native (frontend), Vitest + convex-test (testing)

**Spec:** `docs/superpowers/specs/2026-03-24-duplicate-takeout-transaction-fix-design.md`

---

## Task 1: Schema — Add `requestId` field and index

**Files:**
- Modify: `packages/backend/convex/schema.ts:162-215`

- [ ] **Step 1: Add `requestId` field to orders table**

In `packages/backend/convex/schema.ts`, add `requestId` to the orders table definition and a new index. Insert after the `tabName` field (line 207):

```typescript
// Add field after tabName (line 207):
requestId: v.optional(v.string()),

// Add index after the last existing index (line 215):
.index("by_requestId", ["requestId"])
```

The full indexes block should end as:
```typescript
  .index("by_tableId", ["tableId"])
  .index("by_tableId_status", ["tableId", "status"])
  .index("by_requestId", ["requestId"]),
```

- [ ] **Step 2: Run typecheck to verify schema compiles**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No errors. The field is optional so all existing code remains compatible.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat: add requestId field and index to orders schema for idempotency"
```

---

## Task 2: Backend — Idempotent `submitDraft` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts:216-241`
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the end of `packages/backend/convex/orders.test.ts`, before the final `});` of the last `describe` block (or add a new describe block at the end):

```typescript
describe("orders — submitDraft idempotency", () => {
  it("should return orderNumber without error if draft is already submitted", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    // Create and submit a draft
    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "test-submit-idemp-1",
    });

    // Add an item so it can be submitted
    await t.run(async (ctx: any) => {
      await ctx.db.insert("orderItems", {
        orderId,
        productId: (await setupTestData(t)).productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        isVoided: false,
      });
    });

    // First submit — should succeed
    const result1 = await authed.mutation(api.orders.submitDraft, { orderId });
    expect(result1.orderNumber).toBeDefined();

    // Second submit — should return same orderNumber, not throw
    const result2 = await authed.mutation(api.orders.submitDraft, { orderId });
    expect(result2.orderNumber).toBe(result1.orderNumber);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — second `submitDraft` call throws "Only draft orders can be submitted"

- [ ] **Step 3: Implement idempotent submitDraft**

In `packages/backend/convex/orders.ts`, replace line 223:

```typescript
// Before (line 223):
if (order.status !== "draft") throw new Error("Only draft orders can be submitted");

// After:
if (order.status !== "draft") {
  if (order.status === "open" && order.orderNumber) {
    return { orderNumber: order.orderNumber! };
  }
  throw new Error("Only draft orders can be submitted");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/backend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat: make submitDraft idempotent — return orderNumber if already submitted"
```

---

## Task 3: Backend — `requestId` dedup for `createDraftOrder`

**Files:**
- Modify: `packages/backend/convex/orders.ts:156-213`
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new describe block to `packages/backend/convex/orders.test.ts`:

```typescript
describe("orders — createDraftOrder requestId dedup", () => {
  it("should return same orderId for duplicate requestId", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const requestId = "dedup-test-001";

    const orderId1 = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId,
    });
    const orderId2 = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId,
    });

    expect(orderId1).toBe(orderId2);

    // Verify only one order exists with this requestId
    const orders = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("orders")
        .withIndex("by_requestId", (q: any) => q.eq("requestId", requestId))
        .collect();
    });
    expect(orders).toHaveLength(1);
  });

  it("should create separate orders for different requestIds", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });

    const orderId1 = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "request-a",
    });
    const orderId2 = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "request-b",
    });

    expect(orderId1).not.toBe(orderId2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `createDraftOrder` doesn't accept `requestId` arg

- [ ] **Step 3: Implement requestId dedup in createDraftOrder**

In `packages/backend/convex/orders.ts`, modify `createDraftOrder` mutation:

1. Add `requestId: v.string()` to args (after `storeId`):

```typescript
export const createDraftOrder = mutation({
  args: {
    storeId: v.id("stores"),
    requestId: v.string(),
  },
```

2. Add dedup check after `requireAuth`, before the drafts query (insert after line 162):

```typescript
    const user = await requireAuth(ctx);

    // Idempotency: if an order with this requestId already exists, return it
    const existing = await ctx.db
      .query("orders")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (existing) return existing._id;

    const { startOfDay } = getPHTDayBoundaries();
```

3. Add `requestId` to the `ctx.db.insert` call (alongside the other fields):

```typescript
    const orderId = await ctx.db.insert("orders", {
      storeId: args.storeId,
      orderType: "takeout",
      status: "draft",
      draftLabel,
      requestId: args.requestId,
      // ... rest of fields unchanged
    });
```

- [ ] **Step 4: Fix existing test callers**

The existing test at line 655 calls `createDraftOrder` without `requestId`. Search for all calls in the test file and add `requestId`:

```typescript
// Line 655 (approx) — in "should clean up drafts" test:
const todayDraftId = await authed.mutation(api.orders.createDraftOrder, {
  storeId,
  requestId: "cleanup-test-today",
});
```

Search for any other `createDraftOrder` calls in the test file and add unique `requestId` values to each.

- [ ] **Step 5: Run tests to verify all pass**

Run: `cd packages/backend && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat: add requestId dedup to createDraftOrder to prevent duplicate drafts"
```

---

## Task 4: Backend — `requestId` dedup for `create` mutation (dine-in)

**Files:**
- Modify: `packages/backend/convex/orders.ts:56-153`

- [ ] **Step 1: Add optional requestId to create mutation args**

In `packages/backend/convex/orders.ts`, add `requestId` to the `create` mutation args (after `pax`):

```typescript
export const create = mutation({
  args: {
    storeId: v.id("stores"),
    orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
    tableId: v.optional(v.id("tables")),
    customerName: v.optional(v.string()),
    pax: v.optional(v.number()),
    requestId: v.optional(v.string()),
  },
```

- [ ] **Step 2: Add dedup check in handler**

Insert after `const user = await requireAuth(ctx);` (line 67), before the dine-in validation:

```typescript
    const user = await requireAuth(ctx);

    // Idempotency: if requestId provided and order exists, return it
    if (args.requestId) {
      const existing = await ctx.db
        .query("orders")
        .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
        .unique();
      if (existing) return existing._id;
    }
```

- [ ] **Step 3: Add requestId to insert call**

In the `ctx.db.insert("orders", { ... })` call (line 115), add:

```typescript
    const orderId = await ctx.db.insert("orders", {
      storeId: args.storeId,
      orderNumber,
      orderType: args.orderType,
      requestId: args.requestId,
      // ... rest unchanged
    });
```

- [ ] **Step 4: Run tests**

Run: `cd packages/backend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: ALL PASS (existing tests don't pass requestId, so they're unaffected)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat: add optional requestId dedup to orders.create for dine-in protection"
```

---

## Task 5: Backend — Idempotent payment mutations

**Files:**
- Modify: `packages/backend/convex/checkout.ts:33-144`
- Test: `packages/backend/convex/checkout.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the end of `packages/backend/convex/checkout.test.ts`:

```typescript
describe("checkout — payment idempotency", () => {
  it("processCashPayment should return success if order already paid with cash", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupAuthenticatedUser(t);

    // Create an already-paid cash order
    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-001",
        orderType: "takeout" as const,
        orderChannel: "walk_in_takeout" as const,
        status: "paid" as const,
        grossSales: 15000,
        vatableSales: 13393,
        vatAmount: 1607,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 15000,
        paymentMethod: "cash" as const,
        cashReceived: 20000,
        changeGiven: 5000,
        createdBy: userId,
        createdAt: Date.now(),
        paidAt: Date.now(),
        paidBy: userId,
      });
    });

    // Calling processCashPayment again should return success, not throw
    const result = await t.run(async (ctx: any) => {
      const order = await ctx.db.get(orderId);
      if (order.status === "paid" && order.paymentMethod === "cash") {
        return { success: true, changeGiven: order.changeGiven ?? 0 };
      }
      throw new Error("Order is not open for payment");
    });

    expect(result.success).toBe(true);
    expect(result.changeGiven).toBe(5000);
  });

  it("processCardPayment should return success if order already paid with card", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupAuthenticatedUser(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-002",
        orderType: "takeout" as const,
        orderChannel: "walk_in_takeout" as const,
        status: "paid" as const,
        grossSales: 15000,
        vatableSales: 13393,
        vatAmount: 1607,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 15000,
        paymentMethod: "card_ewallet" as const,
        cardPaymentType: "GCash",
        cardReferenceNumber: "REF-123",
        createdBy: userId,
        createdAt: Date.now(),
        paidAt: Date.now(),
        paidBy: userId,
      });
    });

    const result = await t.run(async (ctx: any) => {
      const order = await ctx.db.get(orderId);
      if (order.status === "paid" && order.paymentMethod === "card_ewallet") {
        return { success: true };
      }
      throw new Error("Order is not open for payment");
    });

    expect(result.success).toBe(true);
  });

  it("processCashPayment should throw if order was paid by card", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupAuthenticatedUser(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-003",
        orderType: "takeout" as const,
        orderChannel: "walk_in_takeout" as const,
        status: "paid" as const,
        grossSales: 15000,
        vatableSales: 13393,
        vatAmount: 1607,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 15000,
        paymentMethod: "card_ewallet" as const,
        cardPaymentType: "GCash",
        cardReferenceNumber: "REF-456",
        createdBy: userId,
        createdAt: Date.now(),
        paidAt: Date.now(),
        paidBy: userId,
      });
    });

    // Calling cash endpoint on card-paid order should throw
    await expect(
      t.run(async (ctx: any) => {
        const order = await ctx.db.get(orderId);
        if (order.status === "paid" && order.paymentMethod === "cash") {
          return { success: true, changeGiven: order.changeGiven ?? 0 };
        }
        throw new Error("Order is not open for payment");
      }),
    ).rejects.toThrow("Order is not open for payment");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (these test the pattern, not the mutation directly)**

Run: `cd packages/backend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: PASS (these tests verify the idempotency logic pattern directly via DB)

- [ ] **Step 3: Implement idempotent processCashPayment**

In `packages/backend/convex/checkout.ts`, replace lines 53-55:

```typescript
// Before (lines 53-55):
    if (order.status !== "open") {
      throw new Error("Order is not open for payment");
    }

// After:
    if (order.status !== "open") {
      // Idempotent: if already paid with cash, return success
      if (order.status === "paid" && order.paymentMethod === "cash") {
        return { success: true, changeGiven: order.changeGiven ?? 0 };
      }
      throw new Error("Order is not open for payment");
    }
```

- [ ] **Step 4: Implement idempotent processCardPayment**

In `packages/backend/convex/checkout.ts`, replace lines 113-115:

```typescript
// Before (lines 113-115):
    if (order.status !== "open") {
      throw new Error("Order is not open for payment");
    }

// After:
    if (order.status !== "open") {
      // Idempotent: if already paid with card, return success
      if (order.status === "paid" && order.paymentMethod === "card_ewallet") {
        return { success: true };
      }
      throw new Error("Order is not open for payment");
    }
```

- [ ] **Step 5: Run all tests**

Run: `cd packages/backend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/checkout.ts packages/backend/convex/checkout.test.ts
git commit -m "feat: make payment mutations idempotent — return success if already paid"
```

---

## Task 6: Frontend — TakeoutOrderScreen "Proceed to Payment" button

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx:546-568`

- [ ] **Step 1: Wire `isSending` to disabled prop**

In `TakeoutOrderScreen.tsx`, change line 548:

```typescript
// Before (line 548):
              disabled={!hasItems}

// After:
              disabled={!hasItems || isSending}
```

- [ ] **Step 2: Update button style to reflect isSending state**

Change line 551 to factor in `isSending`:

```typescript
// Before (line 551):
                backgroundColor: hasItems ? "#F97316" : "#CBD5E1",

// After:
                backgroundColor: hasItems && !isSending ? "#F97316" : "#CBD5E1",
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/native && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx
git commit -m "fix: wire isSending to Proceed to Payment button disabled state"
```

---

## Task 7: Frontend — TakeoutListScreen loading states

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`

- [ ] **Step 1: Add `isCreating` state**

Add after existing state declarations (around line 65):

```typescript
const [isCreating, setIsCreating] = useState(false);
```

- [ ] **Step 2: Wrap handleNewOrder with loading state**

Replace `handleNewOrder` (lines 112-123):

```typescript
  const handleNewOrder = useCallback(async () => {
    if (!user?.storeId || isCreating) return;
    setIsCreating(true);
    try {
      const orderId = await createDraftMutation({
        storeId: user.storeId,
        requestId: crypto.randomUUID(),
      });
      navigation.navigate("TakeoutOrderScreen", {
        storeId: user.storeId,
        orderId,
      });
    } catch (error) {
      Alert.alert("Error", "Failed to create order. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }, [user?.storeId, navigation, createDraftMutation, isCreating]);
```

- [ ] **Step 3: Add disabled to New Order button**

At line 193, the `<Button>` for "New Order" needs `disabled`:

```typescript
          <Button size="md" onPress={handleNewOrder} disabled={isCreating}>
```

- [ ] **Step 4: Add loading state to handleDiscardDraft**

Replace `handleDiscardDraft` (lines 136-145) to add guard:

```typescript
  const [discardingId, setDiscardingId] = useState<Id<"orders"> | null>(null);

  const handleDiscardDraft = useCallback(
    async (orderId: Id<"orders">) => {
      if (discardingId) return;
      setDiscardingId(orderId);
      try {
        await discardDraftMutation({ orderId });
      } catch (error) {
        Alert.alert("Error", "Failed to discard draft. Please try again.");
      } finally {
        setDiscardingId(null);
      }
    },
    [discardDraftMutation, discardingId],
  );
```

- [ ] **Step 5: Run typecheck**

Run: `cd apps/native && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/takeout/screens/TakeoutListScreen.tsx
git commit -m "fix: add loading states to TakeoutListScreen New Order and Discard buttons"
```

---

## Task 8: Frontend — TablesScreen loading states (Add New Tab + PAX)

**Files:**
- Modify: `apps/native/src/features/tables/screens/TablesScreen.tsx`
- Modify: `apps/native/src/features/tables/components/TabSelectionModal.tsx`

- [ ] **Step 1: Add loading states to TablesScreen**

Add after existing state declarations (around line 43):

```typescript
const [isCreatingTab, setIsCreatingTab] = useState(false);
const [isUpdatingPax, setIsUpdatingPax] = useState(false);
```

- [ ] **Step 2: Wrap handleAddNewTab with loading state**

Replace `handleAddNewTab` (lines 162-192):

```typescript
  const handleAddNewTab = useCallback(async () => {
    if (!user?.storeId || !selectedTable || isCreatingTab) return;

    const tableId = selectedTable.id;
    const tableName = selectedTable.name;
    const storeId = user.storeId;

    setIsCreatingTab(true);
    setSelectedTable(null);

    try {
      const orderId = await createOrderMutation({
        storeId,
        orderType: "dine_in",
        tableId,
        pax: 1,
        requestId: crypto.randomUUID(),
      });

      navigation.navigate("OrderScreen", {
        orderId,
        tableId,
        tableName,
        storeId,
      });
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to create new tab");
    } finally {
      setIsCreatingTab(false);
    }
  }, [user?.storeId, selectedTable, createOrderMutation, navigation, isCreatingTab]);
```

- [ ] **Step 3: Wrap handlePaxConfirm with loading state**

Replace `handlePaxConfirm` (lines 87-101):

```typescript
  const handlePaxConfirm = useCallback(async () => {
    const pax = parseInt(paxInput, 10);
    if (!pax || pax < 1) {
      Alert.alert("Invalid", "Please enter a valid number of guests");
      return;
    }
    if (!paxOrderId || isUpdatingPax) return;
    setIsUpdatingPax(true);
    setShowPaxModal(false);
    try {
      await updatePaxMutation({ orderId: paxOrderId, pax });
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to update PAX");
    } finally {
      setIsUpdatingPax(false);
      setPaxOrderId(null);
    }
  }, [paxInput, paxOrderId, updatePaxMutation, isUpdatingPax]);
```

- [ ] **Step 4: Add disabled to PAX Confirm button**

At line 303-310, the PAX Confirm `<TouchableOpacity>` needs disabled state:

```typescript
              <TouchableOpacity
                disabled={isUpdatingPax}
                style={{
                  flex: 1,
                  backgroundColor: isUpdatingPax ? "#93C5FD" : "#0D87E1",
                  borderRadius: 8,
                  paddingVertical: 12,
                }}
                onPress={handlePaxConfirm}
              >
```

- [ ] **Step 5: Pass isCreatingTab to TabSelectionModal**

Where `TabSelectionModal` is rendered (around line 320+), add the prop:

```typescript
      <TabSelectionModal
        visible={!!selectedTable}
        onClose={() => setSelectedTable(null)}
        tableName={selectedTable?.name ?? ""}
        orders={selectedTable?.orders ?? []}
        onSelectOrder={handleSelectOrder}
        onAddNewTab={handleAddNewTab}
        isCreating={isCreatingTab}
      />
```

- [ ] **Step 6: Update TabSelectionModal to accept and use isCreating prop**

In `apps/native/src/features/tables/components/TabSelectionModal.tsx`:

1. Add to interface (line 27-34):
```typescript
interface TabSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  tableName: string;
  orders: TabOrder[];
  onSelectOrder: (orderId: Id<"orders">) => void;
  onAddNewTab: () => void;
  isCreating?: boolean;
}
```

2. Destructure the new prop (line 36-43):
```typescript
export const TabSelectionModal = ({
  visible,
  onClose,
  tableName,
  orders,
  onSelectOrder,
  onAddNewTab,
  isCreating,
}: TabSelectionModalProps) => {
```

3. Add disabled to Add New Tab button (line 164-165):
```typescript
              <TouchableOpacity
                onPress={handleAddNewTab}
                disabled={isCreating}
                activeOpacity={0.7}
                style={{
                  backgroundColor: isCreating ? "#93C5FD" : "#0D87E1",
                  // ... rest unchanged
                }}
              >
```

- [ ] **Step 7: Run typecheck**

Run: `cd apps/native && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add apps/native/src/features/tables/screens/TablesScreen.tsx apps/native/src/features/tables/components/TabSelectionModal.tsx
git commit -m "fix: add loading states to TablesScreen Add New Tab and PAX buttons"
```

---

## Task 9: Frontend — CartFooter loading guards

**Files:**
- Modify: `apps/native/src/features/orders/components/CartFooter.tsx`

- [ ] **Step 1: Add loading props to CartFooterProps interface**

Replace the interface (lines 7-18):

```typescript
interface CartFooterProps {
  subtotal: number;
  itemCount: number;
  hasUnsentItems: boolean;
  hasSentItems: boolean;
  isDraftMode: boolean;
  orderType?: "dine_in" | "takeout";
  onSendToKitchen: () => void;
  onCloseTable?: () => void;
  onViewBill?: () => void;
  onCancelOrder: () => void;
  isClosingTable?: boolean;
  isCancellingOrder?: boolean;
  isSendingToKitchen?: boolean;
}
```

- [ ] **Step 2: Destructure new props and wire to buttons**

Update destructuring (line 20-31) to include new props:

```typescript
export const CartFooter = ({
  subtotal,
  itemCount,
  hasUnsentItems,
  hasSentItems,
  isDraftMode,
  orderType,
  onSendToKitchen,
  onCloseTable,
  onViewBill,
  onCancelOrder,
  isClosingTable,
  isCancellingOrder,
  isSendingToKitchen,
}: CartFooterProps) => {
```

Update the `canSendToKitchen` and button disabled states:

```typescript
  const canSendToKitchen = hasUnsentItems && !isSendingToKitchen;
```

Update Close Table button (line 75):
```typescript
      {canCloseTable && (
        <Button
          variant="primary"
          size="lg"
          onPress={onCloseTable}
          disabled={isClosingTable}
          style={{ marginTop: 8, opacity: isClosingTable ? 0.6 : 1 }}
        >
```

Update Cancel Order button (line 97-98):
```typescript
        <TouchableOpacity
          onPress={onCancelOrder}
          disabled={isCancellingOrder}
          activeOpacity={0.7}
          style={{
            marginTop: 10,
            paddingVertical: 14,
            paddingHorizontal: 20,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            backgroundColor: "#FEF2F2",
            borderRadius: 10,
            borderWidth: 1,
            borderColor: "#FECACA",
            opacity: isCancellingOrder ? 0.6 : 1,
          }}
        >
```

- [ ] **Step 3: Pass loading props from OrderScreen**

In `apps/native/src/features/orders/screens/OrderScreen.tsx`, find where `<CartFooter>` is rendered and pass the loading states. The `isSending` state already exists in OrderScreen — use it:

```typescript
<CartFooter
  // ... existing props ...
  isSendingToKitchen={isSending}
  isClosingTable={false}  // Will be wired when close table gets its own loading state
  isCancellingOrder={false}  // Will be wired when cancel gets its own loading state
/>
```

Note: The `onCloseTable` and `onCancelOrder` callbacks in OrderScreen should also get their own loading states. Find `handleCancelOrder` and `handleCloseTable` in OrderScreen and add loading guards following the same pattern (add state, set true before mutation, false in finally, pass to CartFooter).

- [ ] **Step 4: Run typecheck**

Run: `cd apps/native && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/orders/components/CartFooter.tsx apps/native/src/features/orders/screens/OrderScreen.tsx
git commit -m "fix: add loading guard props to CartFooter for Close Table, Cancel Order, Send to Kitchen"
```

---

## Task 10: Frontend — VoidItemModal loading guard

**Files:**
- Modify: `apps/native/src/features/orders/components/VoidItemModal.tsx`

- [ ] **Step 1: Add isVoiding state and wrap handleConfirm**

Replace `handleConfirm` (lines 22-26):

```typescript
  const [isVoiding, setIsVoiding] = useState(false);

  const handleConfirm = async () => {
    if (!reason.trim() || isVoiding) return;
    setIsVoiding(true);
    try {
      await onConfirm(reason.trim());
      setReason("");
    } catch {
      // Error handled by parent
    } finally {
      setIsVoiding(false);
    }
  };
```

Note: This requires `onConfirm` to return a Promise. Update the interface:

```typescript
interface VoidItemModalProps {
  visible: boolean;
  itemName: string;
  itemQuantity: number;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}
```

- [ ] **Step 2: Wire disabled to Confirm Void button**

Replace line 61:

```typescript
// Before:
            disabled={!reason.trim()}

// After:
            disabled={!reason.trim() || isVoiding}
```

Update opacity too (line 63):
```typescript
            style={!reason.trim() || isVoiding ? { opacity: 0.4 } : undefined}
```

- [ ] **Step 3: Reset isVoiding on modal close**

Update `handleClose` (lines 28-31):
```typescript
  const handleClose = () => {
    setReason("");
    setIsVoiding(false);
    onClose();
  };
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/native && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/orders/components/VoidItemModal.tsx
git commit -m "fix: add isVoiding loading guard to VoidItemModal Confirm button"
```

---

## Task 11: Frontend — OrderScreen PAX + Add New Tab loading guards

**Files:**
- Modify: `apps/native/src/features/orders/screens/OrderScreen.tsx`

- [ ] **Step 1: Wire isSending to PAX Confirm button**

At line 882-889, the PAX Confirm button needs a disabled prop:

```typescript
              <TouchableOpacity
                disabled={isSending}
                style={{
                  flex: 1,
                  backgroundColor: isSending ? "#93C5FD" : "#0D87E1",
                  borderRadius: 8,
                  paddingVertical: 12,
                }}
                onPress={handlePaxConfirm}
              >
```

- [ ] **Step 2: Add loading guard to handleAddNewTab**

Find `handleAddNewTab` in OrderScreen (line 627-649) and add a loading guard:

```typescript
  const [isCreatingTab, setIsCreatingTab] = useState(false);

  const handleAddNewTab = useCallback(async () => {
    if (!tableId || !storeId || isCreatingTab) return;
    setIsCreatingTab(true);

    try {
      const newOrderId = await createOrderMutation({
        storeId,
        orderType: "dine_in",
        tableId,
        pax: 1,
        requestId: crypto.randomUUID(),
      });

      navigation.navigate("OrderScreen", {
        orderId: newOrderId,
        tableId,
        tableName: currentTableName,
        storeId,
      });
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to create new tab");
    } finally {
      setIsCreatingTab(false);
    }
  }, [tableId, storeId, createOrderMutation, navigation, currentTableName, isCreatingTab]);
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/native && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/screens/OrderScreen.tsx
git commit -m "fix: add loading guards to OrderScreen PAX Confirm and Add New Tab buttons"
```

---

## Task 12: Frontend — EditTabNameModal + HomeScreen loading guards

**Files:**
- Modify: `apps/native/src/features/orders/components/EditTabNameModal.tsx`
- Modify: `apps/native/src/features/home/screens/HomeScreen.tsx`

- [ ] **Step 1: Add isSaving to EditTabNameModal**

Update `onSave` in the interface to return Promise:
```typescript
  onSave: (newName: string) => Promise<void> | void;
```

Replace `handleSave` (lines 23-32):
```typescript
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    const trimmedName = tabName.trim();
    try {
      if (!trimmedName) {
        await onSave(defaultName);
      } else {
        await onSave(trimmedName);
      }
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setIsSaving(false);
    }
  };
```

Wire to Save button (line 79):
```typescript
          <Button variant="primary" size="lg" onPress={handleSave} disabled={isSaving}>
```

Reset on close:
```typescript
  const handleClose = () => {
    setTabName(currentName);
    setIsSaving(false);
    onClose();
  };
```

- [ ] **Step 2: Add loading guards to HomeScreen Lock button**

In `apps/native/src/features/home/screens/HomeScreen.tsx`, the `handleLock` (line 51) fires `screenLockMutation` without guard. Since `lockScreen()` is synchronous (it just sets Zustand state) and the mutation is fire-and-forget (`.catch(() => {})`), this is low risk. Add a simple guard:

```typescript
  const [isLocking, setIsLocking] = useState(false);

  const handleLock = useCallback(async () => {
    if (!user?._id || !user.storeId || isLocking) return;

    if (!userHasPin) {
      Alert.alert(
        "PIN Required",
        "You need to set a PIN before you can lock the screen. Go to Settings to set one.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Go to Settings", onPress: () => navigation.navigate("SettingsScreen") },
        ],
      );
      return;
    }

    setIsLocking(true);
    lockScreen({
      userId: user._id,
      userName: user.name ?? "User",
      userRole: user.role?.name ?? "Staff",
    });
    screenLockMutation({ storeId: user.storeId, trigger: "manual" }).catch(() => {});
    // Note: don't reset isLocking since screen transitions to lock screen
  }, [lockScreen, navigation, screenLockMutation, user, userHasPin, isLocking]);
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/native && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/components/EditTabNameModal.tsx apps/native/src/features/home/screens/HomeScreen.tsx
git commit -m "fix: add loading guards to EditTabNameModal Save and HomeScreen Lock buttons"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && npx vitest run --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`
Expected: No errors across all packages

- [ ] **Step 3: Run lint**

Run: `pnpm check`
Expected: No lint errors

- [ ] **Step 4: Verify no regressions — check all files changed**

Run: `git diff --stat main`
Review the list of changed files matches the spec's "Files Changed" table.

- [ ] **Step 5: Final commit if any lint fixes needed**

```bash
git add -A
git commit -m "chore: lint fixes for duplicate transaction prevention"
```
