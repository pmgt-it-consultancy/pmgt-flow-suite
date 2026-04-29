# Phase 4 — Local-First Write Paths Design

**Date:** 2026-04-29
**Status:** Approved
**Scope:** Native tablet app (`apps/native`), shared package (`packages/shared`), minor backend changes (`packages/backend/convex/lib/taxCalculations.ts`)

## Problem

Phase 3 made reads work offline — the tablet queries products, categories, modifiers, tables, and order history from WatermelonDB. But writes still require live Convex WebSocket round-trips via `useMutation(api.orders.create)`, `useMutation(api.checkout.processPayment)`, etc. If the connection drops mid-mutation, the UI hangs waiting for a server response that never arrives.

## Goal

Make every order-related mutation write directly to WatermelonDB. Never block the UI on a network round-trip. SyncManager pushes changes to Convex in the background. The tablet is fully local-first — reads and writes both hit SQLite.

## Architecture

```
┌─────────────────────────────────────────────┐
│  OrderScreen / CheckoutScreen               │
│                                             │
│  Calls service functions directly            │
│  (no useQuery, no useMutation)              │
├─────────────────────────────────────────────┤
│  Feature services (new)                      │
│  features/orders/services/                  │
│    - orderMutations.ts   (create, addItem,  │
│      removeItem, updateQuantity, etc.)      │
│    - recalculateOrder.ts (tax totals)       │
│  features/checkout/services/               │
│    - checkoutMutations.ts (processPayment,  │
│      cancelOrder)                           │
│  features/takeout/services/                │
│    - takeoutMutations.ts (createDraft,      │
│      discardDraft, submitDraft, etc.)      │
├─────────────────────────────────────────────┤
│  packages/shared/src/taxCalculations.ts    │
│  Pure functions used by tablet + server     │
│  No drift between local and server totals   │
├─────────────────────────────────────────────┤
│  SyncManager (background)                    │
│  pushChanges → /sync/push → Convex         │
│  pullChanges ← /sync/pull ← Convex         │
├─────────────────────────────────────────────┤
│  Convex backend (source of truth)           │
│  Reuses existing business mutations via     │
│  /sync/push — unchanged                     │
└─────────────────────────────────────────────┘
```

**Key decisions:**
- No feature flags. Entire deployment is controlled centrally.
- No dual-path hooks. No `if (offline) { WatermelonDB } else { Convex }` anywhere in write code.
- Service functions are async functions that take params, write to WatermelonDB, recalculate totals, and trigger sync. Screens call them like they used to call mutations.
- Tax logic moves from `packages/backend/convex/lib/` to `packages/shared/src/` so tablet and server share identical calculation code.

## Non-Goals

- Offline catalog editing (products, modifiers, categories). Tablet still rejects these writes.
- Z-Report from local data. Z-Report forces full sync first (Phase 6).
- Multi-tablet conflict resolution changes. Existing "origin tablet wins" rule applies server-side during push.
- Order numbering rewrite. Phase 5 handles `T-A042` format separately.

---

## File Inventory

| File | Action | Purpose |
|---|---|---|
| `packages/shared/src/taxCalculations.ts` | Create | Pure tax functions extracted from backend |
| `packages/shared/src/taxCalculations.test.ts` | Create | Unit tests for tax logic |
| `packages/shared/src/index.ts` | Modify | Re-export tax functions and types |
| `packages/backend/convex/lib/taxCalculations.ts` | Modify | Re-export from shared; keep existing exports for backward compat |
| `apps/native/src/features/orders/services/orderMutations.ts` | Create | `createOrder`, `addItemToOrder`, `removeItemFromOrder`, `updateItemQuantity`, `updateItemServiceType`, `updateOrderPax`, `updateTabName`, `updateCustomerName`, `sendToKitchen`, `createAndSendToKitchen` |
| `apps/native/src/features/orders/services/recalculateOrder.ts` | Create | `recalculateOrderTotals(orderId)` — reads items+discounts from WatermelonDB, calls shared tax functions, patches order totals |
| `apps/native/src/features/orders/services/index.ts` | Create | Barrel export |
| `apps/native/src/features/orders/hooks/useCartMutations.ts` | Delete | Replaced by service functions |
| `apps/native/src/features/orders/screens/OrderScreen.tsx` | Modify | Remove `useMutation`/`useCartMutations`, import service functions, rewrite draft-mode logic to use WatermelonDB instead of in-memory state |
| `apps/native/src/features/checkout/services/checkoutMutations.ts` | Create | `processPayment`, `cancelOrder` |
| `apps/native/src/features/checkout/services/index.ts` | Create | Barrel export |
| `apps/native/src/features/checkout/screens/CheckoutScreen.tsx` | Modify | Remove `useMutation`, import service functions |
| `apps/native/src/features/takeout/services/takeoutMutations.ts` | Create | `createDraftOrder`, `discardDraft`, `submitDraft`, `updateTakeoutStatus`, `updateCustomerName`, `updateTableMarker`, `sendToKitchenWithoutPayment`, `cancelTakeoutOrder` |
| `apps/native/src/features/takeout/services/index.ts` | Create | Barrel export |
| `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx` | Modify | Remove `useMutation`, import service functions |
| `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx` | Modify | Same |
| `apps/native/src/features/discounts/services/discountMutations.ts` | Create | `applyBulkScPwdDiscount`, `removeDiscount` |
| `apps/native/src/sync/SyncManager.ts` | Modify | Add `triggerPush()` public method for service functions to call after writes |

---

## Tax Calculation Rebuild

### Shared types (`packages/shared/src/taxCalculations.ts`)

```typescript
export interface LineItem {
  price: number;
  quantity: number;
  isVatable: boolean;
  priceIncludesVat: boolean;
  modifiers: Array<{ priceAdjustment: number }>;
  isVoided: boolean;
}

export interface DiscountEntry {
  discountAmount: number;
  vatExemptAmount: number;
  quantityApplied: number;
}

export interface ItemCalculation {
  vatableSales: number;
  vatExemptSales: number;
  nonVatSales: number;
  grossSales: number;
}

export interface OrderTotals {
  grossSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  nonVatSales: number;
  discountAmount: number;
  netSales: number;
}

export function calculateItemTotals(items: LineItem[]): ItemCalculation[];
export function aggregateOrderTotals(
  items: ItemCalculation[],
  discounts: DiscountEntry[],
  storeVatRate: number,
): OrderTotals;
```

These are extracted verbatim from `packages/backend/convex/lib/taxCalculations.ts`. The existing backend module becomes a thin re-export:

```typescript
// packages/backend/convex/lib/taxCalculations.ts
export {
  calculateItemTotals,
  aggregateOrderTotals,
  type LineItem,
  type DiscountEntry,
  type ItemCalculation,
  type OrderTotals,
} from "@packages/shared";
```

### Recalculate utility (`apps/native/src/features/orders/services/recalculateOrder.ts`)

```typescript
export async function recalculateOrderTotals(orderId: string): Promise<void> {
  const db = getDatabase();
  const order = await db.collections.get<Order>("orders").find(orderId);

  const lineItems = await db.collections.get<OrderItem>("order_items")
    .query(Q.where("order_id", orderId), Q.where("is_voided", false))
    .fetch();

  const modifierRecords = await db.collections.get<OrderItemModifier>("order_item_modifiers")
    .query().fetch();
  const modifiersByItemId = groupBy(modifierRecords, "orderItemId");

  const discountRecords = await db.collections.get<OrderDiscount>("order_discounts")
    .query(Q.where("order_id", orderId))
    .fetch();

  const storeRecord = await db.collections.get<Store>("stores").find(order.storeId);
  const vatRate = storeRecord.vatRate ?? 0.12;

  const lineItemsMapped: LineItem[] = lineItems.map((item) => {
    const product = /* find product by item.productId to get isVatable */;
    return {
      price: item.productPrice,
      quantity: item.quantity,
      isVatable: product?.isVatable ?? false,
      priceIncludesVat: true,
      modifiers: (modifiersByItemId.get(item.id) ?? []).map((m) => ({ priceAdjustment: m.priceAdjustment })),
      isVoided: item.isVoided,
    };
  });

  const discountsMapped: DiscountEntry[] = discountRecords.map((d) => ({
    discountAmount: d.discountAmount,
    vatExemptAmount: d.vatExemptAmount,
    quantityApplied: d.quantityApplied,
  }));

  const itemCalcs = calculateItemTotals(lineItemsMapped);
  const totals = aggregateOrderTotals(itemCalcs, discountsMapped, vatRate);

  await db.write(async (writer) => {
    const orderPatches = await writer.collections.get<Order>("orders").find(orderId);
    await orderPatches.update(() => {
      orderPatches.grossSales = totals.grossSales;
      orderPatches.vatableSales = totals.vatableSales;
      orderPatches.vatAmount = totals.vatAmount;
      orderPatches.vatExemptSales = totals.vatExemptSales;
      orderPatches.nonVatSales = totals.nonVatSales;
      orderPatches.discountAmount = totals.discountAmount;
      orderPatches.netSales = totals.netSales;
    });
  });
}
```

---

## Order Mutation Functions

### `orderMutations.ts`

Each function follows this pattern:
1. Open `database.write()` transaction
2. Create/patch WatermelonDB rows
3. Call `recalculateOrderTotals(orderId)` if the mutation affects line items or discounts
4. Call `syncManager.triggerPush()` to initiate background sync
5. Return result matching existing Convex return shape

```typescript
// ─── createOrder ──────────────────────────────────────────
// Returns: string (the new order's UUID id)
export async function createOrder(params: {
  storeId: string;
  orderType: "dine_in" | "takeout";
  tableId?: string;
  customerName?: string;
  pax?: number;
  requestId?: string;
}): Promise<string> {
  const db = getDatabase();
  let orderId = "";

  // Idempotency: if requestId provided, check for existing
  if (params.requestId) {
    const existing = await db.collections.get<Order>("orders")
      .query(Q.where("request_id", params.requestId))
      .fetch();
    if (existing.length > 0) return existing[0].id;
  }

  // Generate idempotent order number (will be replaced by Phase 5 device-prefixed format)
  const orderNumber = `${params.orderType === "dine_in" ? "D" : "T"}-${Date.now().toString().slice(-6)}`;

  await db.write(async (writer) => {
    const order = await writer.collections.get<Order>("orders").create((o) => {
      o._raw.id = _generateId();
      orderId = o._raw.id;
      o.storeId = params.storeId;
      o.orderNumber = orderNumber;
      o.orderType = params.orderType;
      o.tableId = params.tableId;
      o.customerName = params.customerName;
      o.pax = params.pax ?? 1;
      o.status = "open";
      o.createdBy = _currentUserId();
      o.createdAt = Date.now();
      o.requestId = params.requestId;
      o.grossSales = 0;
      o.vatableSales = 0;
      o.vatAmount = 0;
      o.vatExemptSales = 0;
      o.nonVatSales = 0;
      o.discountAmount = 0;
      o.netSales = 0;
    });

    // Update table status
    if (params.tableId) {
      const table = await writer.collections.get<TableModel>("tables").find(params.tableId);
      await table.update((t) => { t.status = "occupied"; });
    }
  });

  syncManager.triggerPush();
  return orderId;
}

// ─── addItemToOrder ───────────────────────────────────────
// Returns: void (matching existing behavior)
export async function addItemToOrder(params: {
  orderId: string;
  productId: string;
  quantity: number;
  notes?: string;
  modifiers?: Array<{ modifierGroupName: string; modifierOptionName: string; priceAdjustment: number }>;
  customPrice?: number;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const product = await writer.collections.get<Product>("products").find(params.productId);
    const price = params.customPrice ?? product.price;

    const orderItem = await writer.collections.get<OrderItem>("order_items").create((oi) => {
      oi._raw.id = _generateId();
      oi.orderId = params.orderId;
      oi.productId = params.productId;
      oi.productName = product.name;
      oi.productPrice = price;
      oi.quantity = params.quantity;
      oi.notes = params.notes;
      oi.isVoided = false;
      oi.serviceType = undefined;
      oi.isSentToKitchen = false;
    });

    if (params.modifiers) {
      for (const mod of params.modifiers) {
        await writer.collections.get<OrderItemModifier>("order_item_modifiers").create((oim) => {
          oim._raw.id = _generateId();
          oim.orderItemId = orderItem.id;
          oim.modifierGroupName = mod.modifierGroupName;
          oim.modifierOptionName = mod.modifierOptionName;
          oim.priceAdjustment = mod.priceAdjustment;
        });
      }
    }
  });

  await recalculateOrderTotals(params.orderId);
  syncManager.triggerPush();
}

// Similar pattern for:
//   removeItemFromOrder({ orderItemId, voidReason? })
//   updateItemQuantity({ orderItemId, quantity })
//   updateItemServiceType({ orderItemId, serviceType })
//   updateOrderPax({ orderId, pax })
//   updateTabName({ orderId, tabName })
//   updateCustomerName({ orderId, customerName })
//   sendToKitchen({ orderId, storeId })
//   createAndSendToKitchen(params) — combines create + addItem + sendToKitchen
```

### `checkoutMutations.ts`

```typescript
// ─── processPayment ───────────────────────────────────────
// Returns: void
export async function processPayment(params: {
  orderId: string;
  payments: Array<{
    paymentMethod: "cash" | "card_ewallet";
    amount: number;
    cashReceived?: number;
    changeGiven?: number;
    cardPaymentType?: string;
    cardReferenceNumber?: string;
  }>;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections.get<Order>("orders").find(params.orderId);

    for (const p of params.payments) {
      await writer.collections.get<OrderPayment>("order_payments").create((op) => {
        op._raw.id = _generateId();
        op.orderId = params.orderId;
        op.storeId = order.storeId;
        op.paymentMethod = p.paymentMethod;
        op.amount = p.amount;
        op.cashReceived = p.cashReceived;
        op.changeGiven = p.changeGiven;
        op.cardPaymentType = p.cardPaymentType;
        op.cardReferenceNumber = p.cardReferenceNumber;
        op.createdAt = Date.now();
        op.createdBy = _currentUserId();
      });
    }

    // Patch order to paid
    const primaryPayment = params.payments[0];
    await order.update((o) => {
      o.status = "paid";
      o.paymentMethod = primaryPayment.paymentMethod;
      o.cashReceived = primaryPayment.cashReceived;
      o.changeGiven = primaryPayment.changeGiven;
      o.cardPaymentType = primaryPayment.cardPaymentType;
      o.cardReferenceNumber = primaryPayment.cardReferenceNumber;
      o.paidAt = Date.now();
      o.paidBy = _currentUserId();
    });

    // Free the table if no other open tabs
    if (order.tableId) {
      const otherOpen = await writer.collections.get<Order>("orders")
        .query(Q.where("table_id", order.tableId), Q.where("status", "open"))
        .fetch();
      if (otherOpen.length === 0) {
        const table = await writer.collections.get<TableModel>("tables").find(order.tableId);
        await table.update((t) => { t.status = "available"; });
      }
    }
  });

  syncManager.triggerPush();
}

// Similar pattern for:
//   cancelOrder({ orderId }) — marks as voided, inserts orderVoid, cleans up table
```

### `takeoutMutations.ts`

```typescript
// createDraftOrder({ storeId, draftLabel? }) → draft order id
// discardDraft({ orderId }) → deletes draft
// submitDraft({ orderId }) → draft → open
// updateTakeoutStatus({ orderId, status }) → patches takeoutStatus
// plus re-exports of order mutation functions needed by takeout screens
```

### `discountMutations.ts`

```typescript
// applyBulkScPwdDiscount({ orderId, items, discountType, customerName, customerId, managerId })
// removeDiscount({ discountId, managerId })
// Both recalculate order totals after write
```

---

## Screen Changes

### OrderScreen.tsx

**Remove:**
- `useCartMutations()` hook call and all destructured mutations
- `useMutation(api.checkout.cancelOrder)`
- `useMutation(api.orders.sendToKitchen)`
- `useMutation(api.orders.createAndSendToKitchen)`
- `useMutation(api.orders.create)`
- `useMutation(api.orders.updatePax)`
- `useMutation(api.orders.updateTabName)`
- `useQuery(api.orders.get, ...)` — replaced by WatermelonDB observable for `orders`

**Add:**
- Import service functions from `../services/orderMutations`
- Import from `../../checkout/services/checkoutMutations`
- Replace `useCartMutations()` with direct function calls
- Replace `useMutation(api.xxx.yyy)` calls with direct function calls
- Replace `useQuery(api.orders.get, ...)` with a WatermelonDB observable (Phase 3 pattern)

**Draft mode:** Currently uses in-memory `draftItems: DraftItem[]` state. With local-first, drafts become real order rows in WatermelonDB with `status: "draft"`. The `createOrder` function handles this — it creates the order and the screen navigates to it. No more in-memory draft state.

### CheckoutScreen.tsx

**Remove:**
- `useMutation(api.checkout.processPayment)`
- `useMutation(api.discounts.applyBulkScPwdDiscount)`
- `useMutation(api.discounts.removeDiscount)`
- `useQuery(api.orders.get, ...)` — replaced by WatermelonDB observable
- `useQuery(api.discounts.getOrderDiscounts, ...)` — replaced by WatermelonDB observable

**Add:**
- Import from `../../checkout/services/checkoutMutations`
- Import from `../../discounts/services/discountMutations`
- Replace all mutation calls with service function calls

### TakeoutOrderScreen.tsx

Same pattern as OrderScreen — remove `useMutation` calls, replace with service function calls. Remove `useQuery(api.orders.get, ...)` for WatermelonDB observable.

### TakeoutListScreen.tsx

Remove `useMutation(api.orders.updateTakeoutStatus)`, `useMutation(api.orders.createDraftOrder)`, `useMutation(api.orders.discardDraft)`. Replace with takeout service functions.

---

## SyncManager Change

Add public method for service functions:

```typescript
// apps/native/src/sync/SyncManager.ts
/** Called by service functions after any local write. Pushes immediately.
 *  Debounced internally — multiple calls within 500ms collapse into one push. */
triggerPush(): void {
  clearTimeout(this._pushDebounce);
  this._pushDebounce = setTimeout(() => void this.syncOnce(), 500);
}
```

Service functions call `syncManager.triggerPush()` after every write. The debounce prevents excessive pushes when adding multiple items in rapid succession.

---

## Testing

Phase 4 introduces no test runner changes. Key testing strategy:

1. **Shared tax functions** — tested in `packages/shared/src/taxCalculations.test.ts` (Vitest, matches backend conventions)
2. **Service functions** — manual testing on real tablet (no RN test runner configured)
3. **End-to-end** — the spike from Phase 0 already validated: create order offline → process payment → reconnect → verify sync

---

## Future Work (out of scope for this phase)

- Phase 5: Device-prefixed order numbers (`T-A042`)
- Phase 6: Z-Report sync enforcement
- Offline catalog editing
- Multi-tablet concurrent order editing
