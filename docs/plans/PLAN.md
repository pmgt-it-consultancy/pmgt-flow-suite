# Running Bill Feature — Implementation Plan

## Summary

Transform the POS from "add items → checkout immediately" to a **running bill** model where dine-in orders accumulate items across multiple kitchen sends. The order is only created on the first "Send to Kitchen" and only finalized when the cashier explicitly closes the table. Takeout remains pay-first with a distinct order numbering sequence.

---

## Task 1: Add `isSentToKitchen` field to `orderItems` schema

**File:** `packages/backend/convex/schema.ts`

Add to the `orderItems` table definition:

```typescript
isSentToKitchen: v.boolean(),
```

Default: `false`. Set to `true` when the cashier sends items to the kitchen.

**Verification:** Run `npm run typecheck` from root — expect type errors in files that create orderItems (these get fixed in subsequent tasks).

---

## Task 2: Update order numbering to use prefixed sequences

**File:** `packages/backend/convex/orders.ts`

Replace the `getNextOrderNumber` function. Currently it generates a single sequence (`001`, `002`, ...). Change to:

- Dine-in: `D-001`, `D-002`, ...
- Takeout: `T-001`, `T-002`, ...

The function signature becomes:

```typescript
async function getNextOrderNumber(
  ctx: { db: any },
  storeId: Id<"stores">,
  orderType: "dine_in" | "takeout"
): Promise<string> {
  const today = new Date();
  const dateString = today.toISOString().split("T")[0];
  const startOfDay = new Date(dateString).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

  const prefix = orderType === "dine_in" ? "D" : "T";

  const todaysOrders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q.eq("storeId", storeId).gte("createdAt", startOfDay),
    )
    .filter((q: any) =>
      q.and(
        q.lt(q.field("createdAt"), endOfDay),
        q.eq(q.field("orderType"), orderType)
      )
    )
    .collect();

  const nextNumber = todaysOrders.length + 1;
  return `${prefix}-${nextNumber.toString().padStart(3, "0")}`;
}
```

Update the call site in `create` mutation to pass `args.orderType`.

**Verification:** `npm run typecheck` passes.

---

## Task 3: Add `isSentToKitchen` to `addItem` mutation

**File:** `packages/backend/convex/orders.ts`

In the `addItem` handler, add `isSentToKitchen: false` to the `ctx.db.insert("orderItems", { ... })` call at line ~423.

**Verification:** `npm run typecheck` passes.

---

## Task 4: Create `sendToKitchen` mutation

**File:** `packages/backend/convex/orders.ts`

Add a new exported mutation:

```typescript
export const sendToKitchen = mutation({
  args: {
    orderId: v.id("orders"),
  },
  returns: v.object({
    sentItemIds: v.array(v.id("orderItems")),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") throw new Error("Order is not open");

    // Get unsent items
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    const unsentItems = items.filter((i) => !i.isVoided && !i.isSentToKitchen);
    if (unsentItems.length === 0) throw new Error("No new items to send");

    // Mark all unsent items as sent
    const sentItemIds: Id<"orderItems">[] = [];
    for (const item of unsentItems) {
      await ctx.db.patch(item._id, { isSentToKitchen: true });
      sentItemIds.push(item._id);
    }

    return { sentItemIds };
  },
});
```

**Verification:** `npm run typecheck` passes.

---

## Task 5: Create `createAndSendToKitchen` mutation for first-time table orders

**File:** `packages/backend/convex/orders.ts`

This mutation handles the case where a table has no order yet. It creates the order, then marks items as sent. However, since items are added individually before this call, the actual flow is:

1. TablesScreen: tap available table → navigate to OrderScreen with `tableId` but **no orderId**
2. OrderScreen: operates in "draft mode" — items stored in local state (not yet in DB)
3. "Send to Kitchen" pressed → this mutation creates the order + inserts all items + marks them as sent + marks table occupied

```typescript
export const createAndSendToKitchen = mutation({
  args: {
    storeId: v.id("stores"),
    tableId: v.id("tables"),
    items: v.array(v.object({
      productId: v.id("products"),
      quantity: v.number(),
      notes: v.optional(v.string()),
    })),
  },
  returns: v.object({
    orderId: v.id("orders"),
    sentItemIds: v.array(v.id("orderItems")),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    if (args.items.length === 0) throw new Error("No items to send");

    // Check table availability
    const table = await ctx.db.get(args.tableId);
    if (!table) throw new Error("Table not found");
    if (table.status === "occupied") throw new Error("Table is already occupied");

    // Generate order number
    const orderNumber = await getNextOrderNumber(ctx, args.storeId, "dine_in");

    // Create order
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      storeId: args.storeId,
      orderNumber,
      orderType: "dine_in",
      tableId: args.tableId,
      customerName: undefined,
      status: "open",
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      paymentMethod: undefined,
      cashReceived: undefined,
      changeGiven: undefined,
      createdBy: user._id,
      createdAt: now,
      paidAt: undefined,
      paidBy: undefined,
    });

    // Mark table as occupied
    await ctx.db.patch(args.tableId, {
      status: "occupied",
      currentOrderId: orderId,
    });

    // Insert items and mark as sent
    const sentItemIds: Id<"orderItems">[] = [];
    for (const item of args.items) {
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error(`Product not found: ${item.productId}`);
      if (!product.isActive) throw new Error(`Product not available: ${product.name}`);

      const itemId = await ctx.db.insert("orderItems", {
        orderId,
        productId: item.productId,
        productName: product.name,
        productPrice: product.price,
        quantity: item.quantity,
        notes: item.notes,
        isVoided: false,
        isSentToKitchen: true,
        voidedBy: undefined,
        voidedAt: undefined,
        voidReason: undefined,
      });
      sentItemIds.push(itemId);
    }

    // Recalculate order totals
    await recalculateOrderTotals(ctx, orderId);

    return { orderId, sentItemIds };
  },
});
```

**Verification:** `npm run typecheck` passes.

---

## Task 6: Add `transferTable` mutation

**File:** `packages/backend/convex/orders.ts`

```typescript
export const transferTable = mutation({
  args: {
    orderId: v.id("orders"),
    newTableId: v.id("tables"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") throw new Error("Order is not open");
    if (!order.tableId) throw new Error("Order is not a dine-in order");

    // Check new table is available
    const newTable = await ctx.db.get(args.newTableId);
    if (!newTable) throw new Error("Table not found");
    if (newTable.status === "occupied") throw new Error("Target table is already occupied");

    // Release old table
    await ctx.db.patch(order.tableId, {
      status: "available",
      currentOrderId: undefined,
    });

    // Assign new table
    await ctx.db.patch(args.newTableId, {
      status: "occupied",
      currentOrderId: args.orderId,
    });

    // Update order
    await ctx.db.patch(args.orderId, { tableId: args.newTableId });

    return null;
  },
});
```

**Verification:** `npm run typecheck` passes.

---

## Task 7: Update `orders.get` query to include `isSentToKitchen` in items

**File:** `packages/backend/convex/orders.ts`

In the `get` query:
1. Add `isSentToKitchen: v.boolean()` to the items validator in the return type (line ~136 area).
2. Add `isSentToKitchen: item.isSentToKitchen` to the `itemsWithTotals` mapping (line ~168 area).

**Verification:** `npm run typecheck` passes.

---

## Task 8: Update `removeItem` to require void reason for sent items

**File:** `packages/backend/convex/orders.ts`

Modify `removeItem` mutation:
1. Add optional args: `voidReason: v.optional(v.string())`
2. In handler, check `item.isSentToKitchen`:
   - If `true` and no `voidReason` provided → throw error "Void reason required for kitchen-sent items"
   - If `true` → instead of deleting, mark as voided: `await ctx.db.patch(args.orderItemId, { isVoided: true, voidedBy: user._id, voidedAt: Date.now(), voidReason: args.voidReason })`
   - If `false` → keep existing behavior (delete or reduce quantity)

Also update `updateItemQuantity` to block changes on sent items:
- Add check: if `item.isSentToKitchen`, throw `"Cannot modify quantity of kitchen-sent items"`

**Verification:** `npm run typecheck` passes.

---

## Task 9: Update `cancelOrder` to only allow before first kitchen send

**File:** `packages/backend/convex/checkout.ts`

In `cancelOrder` handler, after getting the order, add:

```typescript
// Check if any items have been sent to kitchen
const items = await ctx.db
  .query("orderItems")
  .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
  .collect();

const hasSentItems = items.some((i) => i.isSentToKitchen);
if (hasSentItems) {
  throw new Error("Cannot cancel order with items already sent to kitchen. Void individual items instead.");
}
```

**Verification:** `npm run typecheck` passes.

---

## Task 10: Update `OrderScreen` for running bill flow (draft mode + existing order mode)

**File:** `apps/native/src/features/orders/screens/OrderScreen.tsx`

This is the biggest UI change. The screen needs two modes:

### Mode A: Draft Mode (new table, no order yet)
- `route.params` has `tableId` and `tableName` but NO `orderId`
- Items are stored in **local state** (not in DB)
- CartFooter shows "Send to Kitchen" button (replaces "Proceed to Checkout")
- "Cancel" button navigates back (no DB cleanup needed)
- On "Send to Kitchen": call `createAndSendToKitchen` mutation → receive `orderId` → update route params or navigate to self with new orderId

### Mode B: Existing Order (occupied table with running bill)
- `route.params` has `orderId`, `tableId`, `tableName`
- Items come from `useQuery(api.orders.get)` as before
- **Sent items** (where `isSentToKitchen === true`): shown with a kitchen icon indicator, quantity buttons hidden, swipe or tap to void (shows void reason prompt)
- **Unsent items** (where `isSentToKitchen === false`): fully editable as current behavior
- CartFooter has:
  - **"Send to Kitchen"** — calls `sendToKitchen` mutation, prints kitchen ticket with only the newly sent items, disabled if no unsent items
  - **"Close Table"** — navigates to `CheckoutScreen` (replaces "Proceed to Checkout"), disabled if no items at all
  - **"View Bill"** — opens a modal or navigates to a read-only bill summary
  - **"Cancel Order"** — only shown if no items have been sent to kitchen yet

### Specific changes:

**Route params update** — make `orderId` optional:
```typescript
interface OrderScreenProps {
  route: {
    params: {
      orderId?: Id<"orders">;  // optional now
      tableId: Id<"tables">;
      tableName: string;
      storeId: Id<"stores">;   // needed for draft mode
    };
  };
}
```

**Local draft state** (for Mode A):
```typescript
interface DraftItem {
  localId: string; // uuid for key
  productId: Id<"products">;
  productName: string;
  productPrice: number;
  quantity: number;
  notes?: string;
}
const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
```

**Unified item list** — merge sent + unsent for display, with `isSentToKitchen` indicator.

**Verification:** App compiles. Tap available table → OrderScreen in draft mode. Add items → "Send to Kitchen" → order created, items marked sent, kitchen ticket prints. Tap table again → OrderScreen in existing order mode. Add more → send again. "Close Table" → CheckoutScreen.

---

## Task 11: Update `CartFooter` component for running bill actions

**File:** `apps/native/src/features/orders/components/CartFooter.tsx`

Replace current props with:

```typescript
interface CartFooterProps {
  subtotal: number;
  itemCount: number;
  hasUnsentItems: boolean;
  hasSentItems: boolean;
  isDraftMode: boolean;
  onSendToKitchen: () => void;
  onCloseTable: () => void;
  onViewBill: () => void;
  onCancelOrder: () => void;
}
```

Layout:
- **"Send to Kitchen"** button (green, primary) — disabled when `!hasUnsentItems`, hidden in draft mode when `itemCount === 0`
- **"Close Table"** button (blue) — disabled in draft mode (no order yet), disabled when `itemCount === 0`
- **"View Bill"** button (outline/secondary) — disabled in draft mode
- **"Cancel Order"** button (red, small text link) — only shown when `!hasSentItems` (before first kitchen send, or in draft mode)

**Verification:** Visual inspection — correct buttons shown per state.

---

## Task 12: Update `CartItem` component for sent-item indicator and void flow

**File:** `apps/native/src/features/orders/components/CartItem.tsx`

Add props:
```typescript
isSentToKitchen: boolean;
onVoidItem?: (id: Id<"orderItems">) => void;
```

When `isSentToKitchen === true`:
- Show a small kitchen/checkmark icon next to the product name (e.g., `Ionicons "checkmark-circle"` in green or a utensils icon)
- Hide the +/- quantity buttons
- Show a "Void" button (small, red text) that calls `onVoidItem`

When `isSentToKitchen === false`:
- Current behavior unchanged (show +/- buttons)

**Verification:** Visual inspection — sent items show indicator and void button, unsent items show +/- buttons.

---

## Task 13: Create `VoidItemModal` component

**File:** `apps/native/src/features/orders/components/VoidItemModal.tsx`

A modal that appears when voiding a sent item:
- Shows item name and quantity
- Text input for void reason (required)
- "Confirm Void" button — calls `removeItem` mutation with `voidReason`
- "Cancel" button

```typescript
interface VoidItemModalProps {
  visible: boolean;
  itemName: string;
  itemQuantity: number;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}
```

**Verification:** Modal opens, requires reason, calls mutation.

---

## Task 14: Create `ViewBillModal` component

**File:** `apps/native/src/features/orders/components/ViewBillModal.tsx`

A read-only modal showing the current bill:
- Store name header
- Table name
- List of all non-voided items with name, qty, line total
- Subtotal / VAT / Total
- No payment info (not paid yet)

Uses the existing `order` query data.

```typescript
interface ViewBillModalProps {
  visible: boolean;
  order: {
    orderNumber: string;
    items: Array<{ productName: string; quantity: number; productPrice: number; lineTotal: number; isVoided: boolean }>;
    grossSales: number;
    vatAmount: number;
    netSales: number;
  };
  tableName?: string;
  onClose: () => void;
}
```

**Verification:** Modal opens, shows correct running total.

---

## Task 15: Update `TablesScreen` to navigate without creating order

**File:** `apps/native/src/features/tables/screens/TablesScreen.tsx`

Change `handleSelectTable`:

**Available table (no order):**
- Instead of `Alert.alert → createOrder → navigate`, just navigate directly:
  ```typescript
  navigation.navigate("OrderScreen", {
    tableId,
    tableName,
    storeId: user.storeId!,
    // no orderId — draft mode
  });
  ```
- Remove the `createOrder` mutation usage from this file entirely.

**Occupied table (has order):**
- Same as current: navigate with `orderId`, `tableId`, `tableName`, `storeId`.

**Verification:** Tap available table → goes to OrderScreen in draft mode (no alert). Tap occupied table → goes to OrderScreen with existing order.

---

## Task 16: Update `Navigation.tsx` route params

**File:** `apps/native/src/navigation/Navigation.tsx`

Update `RootStackParamList`:

```typescript
OrderScreen: {
  orderId?: Id<"orders">;   // optional now (draft mode has none)
  tableId: Id<"tables">;
  tableName: string;
  storeId: Id<"stores">;
};
```

**Verification:** `npm run typecheck` passes.

---

## Task 17: Wire up kitchen ticket printing on "Send to Kitchen"

**File:** `apps/native/src/features/orders/screens/OrderScreen.tsx`

After successfully calling `sendToKitchen` or `createAndSendToKitchen`:

1. Build `KitchenTicketData` with **only the newly sent items** (not all items):
   ```typescript
   const kitchenData: KitchenTicketData = {
     orderNumber: order.orderNumber,  // or the returned order's number
     tableName,
     orderType: "dine_in",
     items: newlySentItems.map(item => ({
       name: item.productName,
       quantity: item.quantity,
       notes: item.notes,
     })),
     timestamp: new Date(),
   };
   ```
2. Call `printKitchenTicket(kitchenData)` from `usePrinterStore`.

**Verification:** Add items to table → Send to Kitchen → kitchen printer prints only the new items.

---

## Task 18: Update `CheckoutScreen` to NOT print kitchen ticket

**File:** `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`

In the `ReceiptPreviewModal` `onPrint` handler (line ~366-379), remove the kitchen ticket printing:

```typescript
// REMOVE this block:
// const kitchenData: KitchenTicketData = { ... };
// await printKitchenTicket(kitchenData);
```

Kitchen tickets are now printed at "Send to Kitchen" time, not at checkout. The checkout only prints the receipt.

**Verification:** Complete a payment → only receipt prints, no kitchen ticket.

---

## Task 19: Add `TransferTableModal` component

**File:** `apps/native/src/features/orders/components/TransferTableModal.tsx`

Modal for transferring a running bill to another table:
- Shows list of available tables (use `useQuery(api.tables.getAvailable, { storeId })`)
- Tap a table → call `transferTable` mutation
- Close modal

```typescript
interface TransferTableModalProps {
  visible: boolean;
  storeId: Id<"stores">;
  orderId: Id<"orders">;
  currentTableName: string;
  onTransferred: (newTableId: Id<"tables">, newTableName: string) => void;
  onClose: () => void;
}
```

Add a "Transfer Table" button to the OrderScreen header (in `OrderHeader` or directly in OrderScreen). Only shown when in existing-order mode (not draft).

**Verification:** Open occupied table → tap "Transfer Table" → select new table → order moves, old table freed, new table occupied.

---

## Task 20: Update barrel exports

**Files:**
- `apps/native/src/features/orders/components/index.ts` — add `VoidItemModal`, `ViewBillModal`, `TransferTableModal`

**Verification:** `npm run typecheck` passes.

---

## Task 21: End-to-end flow verification

Manually verify the complete flows:

### Dine-in Running Bill Flow:
1. TablesScreen → tap available table → OrderScreen (draft mode, no alert)
2. Add 3 items → "Send to Kitchen" → order created (D-001), items marked sent, kitchen ticket prints with 3 items
3. Return to TablesScreen → table shows occupied with 3 items and total
4. Tap occupied table → OrderScreen (existing order mode)
5. See 3 sent items with kitchen indicator (no +/- buttons)
6. Add 2 more items (unsent, with +/- buttons)
7. "Send to Kitchen" → 2 items sent, kitchen ticket prints with only 2 new items
8. Void a sent item → VoidItemModal → enter reason → item voided
9. "View Bill" → see running total without voided item
10. "Close Table" → CheckoutScreen → pay → receipt prints (no kitchen ticket) → table freed

### Takeout Flow (unchanged):
1. Quick action → create takeout order (T-001)
2. Add items → Checkout → pay → receipt + kitchen ticket print

### Table Transfer:
1. Open occupied table → "Transfer Table" → select new table → old freed, new occupied

### Cancel Order:
1. Open new table → add items (draft, not sent) → "Cancel Order" → back to TablesScreen
2. Open table with sent items → "Cancel Order" button not visible

---

## Dependency Order

```
Task 1 (schema)
  → Task 3 (addItem fix)
  → Task 2 (order numbering)
  → Task 4 (sendToKitchen)
  → Task 5 (createAndSendToKitchen)
  → Task 6 (transferTable)
  → Task 7 (orders.get update)
  → Task 8 (removeItem update)
  → Task 9 (cancelOrder update)
  → Task 16 (navigation params)
  → Task 15 (TablesScreen)
  → Task 11 (CartFooter)
  → Task 12 (CartItem)
  → Task 13 (VoidItemModal)
  → Task 14 (ViewBillModal)
  → Task 19 (TransferTableModal)
  → Task 10 (OrderScreen — biggest, depends on all above)
  → Task 17 (kitchen ticket wiring)
  → Task 18 (checkout kitchen ticket removal)
  → Task 20 (exports)
  → Task 21 (e2e verification)
```

Backend tasks (1-9) can be done first as a batch. UI tasks (10-20) depend on backend being complete.
