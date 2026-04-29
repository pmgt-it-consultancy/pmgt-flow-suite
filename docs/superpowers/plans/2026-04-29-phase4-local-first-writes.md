# Phase 4 — Local-First Write Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every order-related mutation write directly to WatermelonDB — never block UI on a network round-trip. Replace all `useMutation(api.xxx.yyy)` calls with service functions that write to local SQLite, recalculate order totals using shared tax logic, and trigger background sync.

**Architecture:** Pure functions in `packages/shared/src/taxCalculations.ts` (extracted from backend). Per-feature service modules (`features/orders/services/`, `features/checkout/services/`, `features/takeout/services/`, `features/discounts/services/`) contain async write functions. Screens call these directly. No `useMutation`, no `useQuery(api.orders.get, ...)` in affected screens. SyncManager gains a `triggerPush()` method called after every write.

**Tech Stack:** WatermelonDB 0.28.x, TypeScript, React Native 0.81.5, Expo SDK 54, `@packages/shared`

**Spec:** [docs/superpowers/specs/2026-04-29-phase4-local-first-writes-design.md](../specs/2026-04-29-phase4-local-first-writes-design.md)

---

## Task 1: Port tax calculations to `packages/shared/`

**Files:**
- Create: `packages/shared/src/taxCalculations.ts`
- Create: `packages/shared/src/taxCalculations.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/backend/convex/lib/taxCalculations.ts`

### Step 1: Write the failing test

Create `packages/shared/src/taxCalculations.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  aggregateOrderTotals,
  calculateChange,
  calculateItemTotals,
  calculateScPwdDiscount,
  calculateVatBreakdown,
  type ItemCalculation,
} from "./taxCalculations";

describe("calculateVatBreakdown", () => {
  it("extracts 12% VAT from a VAT-inclusive price", () => {
    const result = calculateVatBreakdown(112, true);
    expect(result.vatExclusive).toBe(100);
    expect(result.vatAmount).toBe(12);
  });

  it("returns no VAT for non-vatable items", () => {
    const result = calculateVatBreakdown(112, false);
    expect(result.vatExclusive).toBe(112);
    expect(result.vatAmount).toBe(0);
  });

  it("handles rounded edge case (VAT-inclusive 100)", () => {
    const result = calculateVatBreakdown(100, true);
    expect(result.vatExclusive).toBe(89.29);
    expect(result.vatAmount).toBe(10.71);
  });

  it("returns no VAT for zero vatRate", () => {
    const result = calculateVatBreakdown(112, true, 0);
    expect(result.vatExclusive).toBe(112);
    expect(result.vatAmount).toBe(0);
  });
});

describe("calculateScPwdDiscount", () => {
  it("gives 20% discount on VAT-exclusive price + VAT exemption", () => {
    const result = calculateScPwdDiscount(112);
    expect(result.discountAmount).toBe(20);
    expect(result.discountedPrice).toBe(80);
    expect(result.vatExemptAmount).toBe(100);
  });

  it("handles zero VAT rate (NON-VAT store)", () => {
    const result = calculateScPwdDiscount(100, 0);
    expect(result.discountAmount).toBe(20);
    expect(result.discountedPrice).toBe(80);
    expect(result.vatExemptAmount).toBe(0);
  });

  it("handles small amounts correctly", () => {
    const result = calculateScPwdDiscount(50, 0.12);
    expect(result.discountedPrice).toBe(35.71);
  });
});

describe("calculateItemTotals", () => {
  it("calculates regular vatable item", () => {
    const result = calculateItemTotals(112, 2, true);
    expect(result.grossAmount).toBe(224);
    expect(result.vatableAmount).toBe(200);
    expect(result.vatAmount).toBe(24);
    expect(result.netAmount).toBe(224);
  });

  it("calculates non-vatable item", () => {
    const result = calculateItemTotals(50, 3, false);
    expect(result.grossAmount).toBe(150);
    expect(result.vatableAmount).toBe(0);
    expect(result.vatAmount).toBe(0);
    expect(result.nonVatAmount).toBe(150);
    expect(result.netAmount).toBe(150);
  });

  it("includes SC/PWD discount portion", () => {
    const result = calculateItemTotals(112, 2, true, 1, 0.12);
    expect(result.discountAmount).toBe(20);
    expect(result.vatExemptAmount).toBe(100);
    expect(result.grossAmount).toBe(224);
  });

  it("handles NON-VAT store items", () => {
    const result = calculateItemTotals(100, 2, true, 0, 0);
    expect(result.vatableAmount).toBe(0);
    expect(result.nonVatAmount).toBe(200);
    expect(result.vatAmount).toBe(0);
  });
});

describe("aggregateOrderTotals", () => {
  it("aggregates multiple items correctly", () => {
    const items: ItemCalculation[] = [
      {
        grossAmount: 224,
        vatableAmount: 200,
        vatAmount: 24,
        vatExemptAmount: 100,
        nonVatAmount: 0,
        discountAmount: 20,
        netAmount: 180,
      },
      {
        grossAmount: 150,
        vatableAmount: 0,
        vatAmount: 0,
        vatExemptAmount: 0,
        nonVatAmount: 150,
        discountAmount: 0,
        netAmount: 150,
      },
    ];
    const result = aggregateOrderTotals(items);
    expect(result.grossSales).toBe(374);
    expect(result.vatableSales).toBe(200);
    expect(result.vatAmount).toBe(24);
    expect(result.vatExemptSales).toBe(100);
    expect(result.nonVatSales).toBe(150);
    expect(result.discountAmount).toBe(20);
    expect(result.netSales).toBe(330);
  });

  it("returns zeros for empty items", () => {
    const result = aggregateOrderTotals([]);
    expect(result.grossSales).toBe(0);
    expect(result.netSales).toBe(0);
  });
});

describe("calculateChange", () => {
  it("returns positive change for overpayment", () => {
    expect(calculateChange(350, 500)).toBe(150);
  });

  it("returns negative for underpayment", () => {
    expect(calculateChange(350, 300)).toBe(-50);
  });
});
```

### Step 2: Run test — verify it fails

```bash
cd packages/shared && pnpm vitest run src/taxCalculations.test.ts
```
Expected: FAIL — cannot find module `./taxCalculations`.

### Step 3: Create `packages/shared/src/taxCalculations.ts`

Copy the exact contents of `packages/backend/convex/lib/taxCalculations.ts`:

```typescript
/**
 * BIR-Compliant Tax Calculations
 *
 * Philippine tax rules:
 * - Standard VAT rate: 12% (NON-VAT stores use 0%)
 * - All prices are VAT-inclusive (for VAT-registered stores)
 * - SC/PWD discounts: 20% on VAT-exclusive price + VAT exemption
 *
 * Amounts are stored as peso values and rounded to centavo precision
 * whenever tax or discount calculations produce fractions.
 */

export const VAT_RATE = 0.12;
export const SC_PWD_DISCOUNT_RATE = 0.2;

function normalizeVatRate(vatRate: number): number {
  if (vatRate <= 0) return 0;
  return vatRate > 1 ? vatRate / 100 : vatRate;
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function calculateVatBreakdown(
  vatInclusivePrice: number,
  isVatable: boolean,
  vatRate: number = VAT_RATE,
): {
  vatExclusive: number;
  vatAmount: number;
} {
  const normalizedVatRate = normalizeVatRate(vatRate);

  if (!isVatable || normalizedVatRate === 0) {
    return {
      vatExclusive: vatInclusivePrice,
      vatAmount: 0,
    };
  }

  const vatExclusive = roundMoney(vatInclusivePrice / (1 + normalizedVatRate));
  const vatAmount = roundMoney(vatInclusivePrice - vatExclusive);

  return {
    vatExclusive,
    vatAmount,
  };
}

export function calculateScPwdDiscount(
  vatInclusivePrice: number,
  vatRate: number = VAT_RATE,
): {
  discountedPrice: number;
  discountAmount: number;
  vatExemptAmount: number;
} {
  const normalizedVatRate = normalizeVatRate(vatRate);

  if (normalizedVatRate === 0) {
    const discountAmount = roundMoney(vatInclusivePrice * SC_PWD_DISCOUNT_RATE);
    const discountedPrice = roundMoney(vatInclusivePrice - discountAmount);
    return {
      discountedPrice,
      discountAmount,
      vatExemptAmount: 0,
    };
  }

  const vatExclusive = roundMoney(vatInclusivePrice / (1 + normalizedVatRate));

  const discountAmount = roundMoney(vatExclusive * SC_PWD_DISCOUNT_RATE);
  const discountedPrice = roundMoney(vatExclusive - discountAmount);

  return {
    discountedPrice,
    discountAmount,
    vatExemptAmount: vatExclusive,
  };
}

export interface ItemCalculation {
  grossAmount: number;
  vatableAmount: number;
  vatAmount: number;
  vatExemptAmount: number;
  nonVatAmount: number;
  discountAmount: number;
  netAmount: number;
}

export function calculateItemTotals(
  unitPrice: number,
  quantity: number,
  isVatable: boolean,
  scPwdQuantity: number = 0,
  vatRate: number = VAT_RATE,
): ItemCalculation {
  const normalizedVatRate = normalizeVatRate(vatRate);
  const grossAmount = roundMoney(unitPrice * quantity);
  const regularQuantity = quantity - scPwdQuantity;

  const regularGross = roundMoney(unitPrice * regularQuantity);

  const effectivelyVatable = isVatable && normalizedVatRate > 0;
  const regularVat = effectivelyVatable
    ? calculateVatBreakdown(regularGross, true, normalizedVatRate)
    : { vatExclusive: regularGross, vatAmount: 0 };

  let _scPwdGross = 0;
  let scPwdDiscount = 0;
  let scPwdVatExempt = 0;
  let scPwdNet = 0;

  if (scPwdQuantity > 0) {
    _scPwdGross = unitPrice * scPwdQuantity;
    const scPwd = calculateScPwdDiscount(unitPrice, isVatable ? normalizedVatRate : 0);
    scPwdDiscount = roundMoney(scPwd.discountAmount * scPwdQuantity);
    scPwdVatExempt = roundMoney(scPwd.vatExemptAmount * scPwdQuantity);
    scPwdNet = roundMoney(scPwd.discountedPrice * scPwdQuantity);
  }

  const vatableAmount = effectivelyVatable ? regularVat.vatExclusive : 0;
  const vatAmount = effectivelyVatable ? regularVat.vatAmount : 0;
  const nonVatAmount = !effectivelyVatable ? regularGross : 0;
  const vatExemptAmount = scPwdVatExempt;
  const discountAmount = scPwdDiscount;

  const regularNet = roundMoney(regularGross);
  const netAmount = roundMoney(regularNet + scPwdNet);

  return {
    grossAmount,
    vatableAmount,
    vatAmount,
    vatExemptAmount,
    nonVatAmount,
    discountAmount,
    netAmount,
  };
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

export function aggregateOrderTotals(items: ItemCalculation[]): OrderTotals {
  return items.reduce(
    (totals, item) => ({
      grossSales: roundMoney(totals.grossSales + item.grossAmount),
      vatableSales: roundMoney(totals.vatableSales + item.vatableAmount),
      vatAmount: roundMoney(totals.vatAmount + item.vatAmount),
      vatExemptSales: roundMoney(totals.vatExemptSales + item.vatExemptAmount),
      nonVatSales: roundMoney(totals.nonVatSales + item.nonVatAmount),
      discountAmount: roundMoney(totals.discountAmount + item.discountAmount),
      netSales: roundMoney(totals.netSales + item.netAmount),
    }),
    {
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
    },
  );
}

export function calculateChange(netSales: number, cashReceived: number): number {
  return roundMoney(cashReceived - netSales);
}

export function formatPhpCurrency(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);
}
```

### Step 4: Run test — verify it passes

```bash
cd packages/shared && pnpm vitest run src/taxCalculations.test.ts
```
Expected: PASS (all tests).

### Step 5: Update barrel export

Modify `packages/shared/src/index.ts` to add:

```typescript
export * from "./schemas/auth";
export * from "./schemas/store";
export {
  type ItemCalculation,
  type OrderTotals,
  VAT_RATE,
  SC_PWD_DISCOUNT_RATE,
  aggregateOrderTotals,
  calculateChange,
  calculateItemTotals,
  calculateScPwdDiscount,
  calculateVatBreakdown,
  formatPhpCurrency,
} from "./taxCalculations";
```

### Step 6: Update backend to re-export from shared

Modify `packages/backend/convex/lib/taxCalculations.ts` to replace all implementation with:

```typescript
export {
  type ItemCalculation,
  type OrderTotals,
  VAT_RATE,
  SC_PWD_DISCOUNT_RATE,
  aggregateOrderTotals,
  calculateChange,
  calculateItemTotals,
  calculateScPwdDiscount,
  calculateVatBreakdown,
  formatPhpCurrency,
} from "@packages/shared";
```

### Step 7: Run backend tests to verify re-exports work

```bash
cd packages/backend && pnpm vitest run
```
Expected: all existing tests PASS (they still import from the same module; it now re-exports from shared).

### Step 8: Commit

```bash
git add packages/shared/src/taxCalculations.ts packages/shared/src/taxCalculations.test.ts packages/shared/src/index.ts packages/backend/convex/lib/taxCalculations.ts
git commit -m "feat(shared): extract BIR-compliant tax calculations to shared package"
```

---

## Task 2: Add `triggerPush()` to SyncManager

**Files:**
- Modify: `apps/native/src/sync/SyncManager.ts`

### Step 1: Add method and debounce timer

In `apps/native/src/sync/SyncManager.ts`, add a private field after line 46 (`private started = false;`):

```typescript
  private pushDebounce: ReturnType<typeof setTimeout> | null = null;
```

Add a public method after the `getState()` method (after line 93):

```typescript
  /**
   * Called by service functions after any local write. Pushes immediately
   * but debounces: multiple calls within 500ms collapse into one push so
   * rapid-fire cart edits don't hammer the Convex backend.
   */
  triggerPush(): void {
    if (this.pushDebounce) clearTimeout(this.pushDebounce);
    this.pushDebounce = setTimeout(() => void this.syncOnce(), 500);
  }
```

### Step 2: Commit

```bash
git add apps/native/src/sync/SyncManager.ts
git commit -m "feat(native): add triggerPush() debounced sync trigger to SyncManager"
```

---

## Task 3: Create shared ID/index helpers for service functions

**Files:**
- Create: `apps/native/src/sync/idBridge.ts`

Service functions need to generate UUIDs for WatermelonDB row IDs. They also need a central utility for this.

### Step 1: Create `apps/native/src/sync/idBridge.ts`

```typescript
// biome-ignore lint/suspicious/noExplicitAny: randomUUID may not exist in all Hermes builds
const _crypto: { randomUUID?: () => string } =
  typeof crypto !== "undefined" ? (crypto as any) : {};

export function generateUUID(): string {
  if (typeof _crypto.randomUUID === "function") {
    return _crypto.randomUUID();
  }
  // Fallback for older Hermes builds
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
```

### Step 2: Commit

```bash
git add apps/native/src/sync/idBridge.ts
git commit -m "feat(native): add generateUUID helper for WatermelonDB row IDs"
```

---

## Task 4: Create `recalculateOrderTotals` utility

**Files:**
- Create: `apps/native/src/features/orders/services/recalculateOrder.ts`

### Step 1: Create the file

```typescript
import { Q } from "@nozbe/watermelondb";
import {
  aggregateOrderTotals,
  calculateItemTotals,
  type ItemCalculation,
} from "@packages/shared";
import {
  getDatabase,
  type Order,
  type OrderDiscount,
  type OrderItem,
  type OrderItemModifier,
  type Product,
  type Store,
} from "../../../db";

/**
 * Recomputes order totals (grossSales, vatableSales, vatAmount, etc.)
 * from the current line items, modifiers, and discounts. Writes the
 * result back to the orders row.
 *
 * Call after any mutation that changes line items or discount records.
 */
export async function recalculateOrderTotals(orderId: string): Promise<void> {
  const db = getDatabase();

  const order = await db.collections.get<Order>("orders").find(orderId);

  const lineItems = await db.collections
    .get<OrderItem>("order_items")
    .query(Q.where("order_id", orderId), Q.where("is_voided", false))
    .fetch();

  const allModifiers = await db.collections
    .get<OrderItemModifier>("order_item_modifiers")
    .query()
    .fetch();

  const modifiersByItemId = new Map<string, OrderItemModifier[]>();
  for (const m of allModifiers) {
    const list = modifiersByItemId.get(m.orderItemId);
    if (list) list.push(m);
    else modifiersByItemId.set(m.orderItemId, [m]);
  }

  const discountRecords = await db.collections
    .get<OrderDiscount>("order_discounts")
    .query(Q.where("order_id", orderId))
    .fetch();

  const allProducts = await db.collections
    .get<Product>("products")
    .query()
    .fetch();
  const productById = new Map<string, Product>();
  for (const p of allProducts) productById.set(p.id, p);

  const store = await db.collections.get<Store>("stores").find(order.storeId);
  const vatRate = store?.vatRate ?? 0.12;

  // Calculate per-item tax breakdown
  const itemCalcs: ItemCalculation[] = [];
  for (const item of lineItems) {
    const product = productById.get(item.productId);
    const isVatable = product?.isVatable ?? false;

    // Count SC/PWD discounts applied to this item
    const itemDiscounts = discountRecords.filter((d) => d.orderItemId === item.id);
    const scPwdQuantity = itemDiscounts.reduce(
      (sum, d) => sum + d.quantityApplied,
      0,
    );

    const calc = calculateItemTotals(
      item.productPrice,
      item.quantity,
      isVatable,
      scPwdQuantity,
      vatRate,
    );

    // Discounts that are not SC/PWD (manual, promo) should be added to discount amount
    // For item-level simplicity, we only track SC/PWD at item level.
    // Manual/promo discounts that apply to the whole order are handled by
    // discountRecords that have no orderItemId.
    itemCalcs.push(calc);
  }

  // Add manual/promo discounts (those without orderItemId) to discount totals
  const globalDiscountAmount = discountRecords
    .filter((d) => !d.orderItemId)
    .reduce((sum, d) => sum + d.discountAmount, 0);

  const totals = aggregateOrderTotals(itemCalcs);
  totals.discountAmount += globalDiscountAmount;
  totals.netSales -= globalDiscountAmount;

  await db.write(async (writer) => {
    const orderToPatch = await writer.collections
      .get<Order>("orders")
      .find(orderId);
    await orderToPatch.update((o) => {
      o.grossSales = totals.grossSales;
      o.vatableSales = totals.vatableSales;
      o.vatAmount = totals.vatAmount;
      o.vatExemptSales = totals.vatExemptSales;
      o.nonVatSales = totals.nonVatSales;
      o.discountAmount = totals.discountAmount;
      o.netSales = totals.netSales;
    });
  });
}
```

### Step 2: Commit

```bash
git add apps/native/src/features/orders/services/recalculateOrder.ts
git commit -m "feat(native): add recalculateOrderTotals using shared tax logic"
```

---

## Task 5: Create `orderMutations.ts` service

**Files:**
- Create: `apps/native/src/features/orders/services/orderMutations.ts`

### Step 1: Create the file

```typescript
import { Q } from "@nozbe/watermelondb";
import { generateUUID } from "../../../../sync/idBridge";
import { syncManager } from "../../../../sync/SyncManager";
import {
  getDatabase,
  type Order,
  type OrderItem,
  type OrderItemModifier,
  type Product,
  type TableModel,
} from "../../../db";
import { recalculateOrderTotals } from "./recalculateOrder";

function uid(): string {
  return generateUUID();
}

// ─── createOrder ──────────────────────────────────────────────
// Returns: the new order's UUID id

export async function createOrder(params: {
  storeId: string;
  orderType: "dine_in" | "takeout";
  tableId?: string;
  customerName?: string;
  pax?: number;
  requestId?: string;
}): Promise<string> {
  const db = getDatabase();

  if (params.requestId) {
    const existing = await db.collections
      .get<Order>("orders")
      .query(Q.where("request_id", params.requestId))
      .fetch();
    if (existing.length > 0) return existing[0].id;
  }

  const prefix = params.orderType === "dine_in" ? "D" : "T";
  const orderNumber = `${prefix}-${Date.now().toString().slice(-6)}`;

  let orderId = "";

  await db.write(async (writer) => {
    const order = await writer.collections.get<Order>("orders").create((o) => {
      o._raw.id = uid();
      orderId = o._raw.id;
      o.storeId = params.storeId;
      o.orderNumber = orderNumber;
      o.orderType = params.orderType;
      o.tableId = params.tableId || undefined;
      o.customerName = params.customerName || undefined;
      o.pax = params.pax ?? 1;
      o.status = "open";
      o.createdBy = "";
      o.createdAt = Date.now();
      o.requestId = params.requestId || undefined;
      o.grossSales = 0;
      o.vatableSales = 0;
      o.vatAmount = 0;
      o.vatExemptSales = 0;
      o.nonVatSales = 0;
      o.discountAmount = 0;
      o.netSales = 0;
      o.itemCount = 0;
    });

    if (params.tableId) {
      const table = await writer.collections
        .get<TableModel>("tables")
        .find(params.tableId);
      await table.update((t) => {
        t.status = "occupied";
      });
    }
  });

  syncManager.triggerPush();
  return orderId;
}

// ─── addItemToOrder ───────────────────────────────────────────

export async function addItemToOrder(params: {
  orderId: string;
  productId: string;
  quantity: number;
  notes?: string;
  modifiers?: Array<{
    modifierGroupName: string;
    modifierOptionName: string;
    priceAdjustment: number;
  }>;
  customPrice?: number;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const product = await writer.collections
      .get<Product>("products")
      .find(params.productId);

    const basePrice = params.customPrice ?? product.price;

    const orderItem = await writer.collections
      .get<OrderItem>("order_items")
      .create((oi) => {
        oi._raw.id = uid();
        oi.orderId = params.orderId;
        oi.productId = params.productId;
        oi.productName = product.name;
        oi.productPrice = basePrice;
        oi.quantity = params.quantity;
        oi.notes = params.notes || undefined;
        oi.isVoided = false;
        oi.serviceType = undefined;
        oi.isSentToKitchen = false;
      });

    if (params.modifiers) {
      for (const mod of params.modifiers) {
        await writer.collections
          .get<OrderItemModifier>("order_item_modifiers")
          .create((oim) => {
            oim._raw.id = uid();
            oim.orderItemId = orderItem.id;
            oim.modifierGroupName = mod.modifierGroupName;
            oim.modifierOptionName = mod.modifierOptionName;
            oim.priceAdjustment = mod.priceAdjustment;
          });
      }
    }

    // Update itemCount on the order
    const order = await writer.collections
      .get<Order>("orders")
      .find(params.orderId);
    await order.update((o) => {
      o.itemCount = (o.itemCount ?? 0) + params.quantity;
    });
  });

  await recalculateOrderTotals(params.orderId);
  syncManager.triggerPush();
}

// ─── removeItemFromOrder ──────────────────────────────────────

export async function removeItemFromOrder(params: {
  orderItemId: string;
  voidReason?: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const item = await writer.collections
      .get<OrderItem>("order_items")
      .find(params.orderItemId);

    await item.update((oi) => {
      oi.isVoided = true;
      oi.voidReason = params.voidReason || undefined;
      oi.voidedAt = Date.now();
    });

    const order = await writer.collections
      .get<Order>("orders")
      .find(item.orderId);
    await order.update((o) => {
      o.itemCount = Math.max(0, (o.itemCount ?? 0) - item.quantity);
    });
  });

  await recalculateOrderTotals(params.orderId); // will need orderId from item lookup
  syncManager.triggerPush();
}

// ─── updateItemQuantity ───────────────────────────────────────

export async function updateItemQuantity(params: {
  orderItemId: string;
  quantity: number;
}): Promise<void> {
  const db = getDatabase();
  let orderId = "";

  await db.write(async (writer) => {
    const item = await writer.collections
      .get<OrderItem>("order_items")
      .find(params.orderItemId);

    const oldQty = item.quantity;
    orderId = item.orderId;

    await item.update((oi) => {
      oi.quantity = params.quantity;
    });

    const order = await writer.collections
      .get<Order>("orders")
      .find(orderId);
    await order.update((o) => {
      o.itemCount = (o.itemCount ?? 0) - oldQty + params.quantity;
    });
  });

  await recalculateOrderTotals(orderId);
  syncManager.triggerPush();
}

// ─── updateItemServiceType ────────────────────────────────────

export async function updateItemServiceType(params: {
  orderItemId: string;
  serviceType: "dine_in" | "takeout";
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const item = await writer.collections
      .get<OrderItem>("order_items")
      .find(params.orderItemId);
    await item.update((oi) => {
      oi.serviceType = params.serviceType;
    });
  });

  syncManager.triggerPush();
}

// ─── updateOrderPax ───────────────────────────────────────────

export async function updateOrderPax(params: {
  orderId: string;
  pax: number;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections
      .get<Order>("orders")
      .find(params.orderId);
    await order.update((o) => {
      o.pax = params.pax;
    });
  });

  syncManager.triggerPush();
}

// ─── updateTabName ────────────────────────────────────────────

export async function updateTabName(params: {
  orderId: string;
  tabName: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections
      .get<Order>("orders")
      .find(params.orderId);
    await order.update((o) => {
      o.tabName = params.tabName;
    });
  });

  syncManager.triggerPush();
}

// ─── updateCustomerName ───────────────────────────────────────

export async function updateCustomerName(params: {
  orderId: string;
  customerName?: string;
  orderCategory?: "dine_in" | "takeout";
  tableMarker?: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections
      .get<Order>("orders")
      .find(params.orderId);
    await order.update((o) => {
      if (params.customerName !== undefined) o.customerName = params.customerName || undefined;
      if (params.orderCategory !== undefined) o.orderCategory = params.orderCategory;
      if (params.tableMarker !== undefined) o.tableMarker = params.tableMarker || undefined;
    });
  });

  syncManager.triggerPush();
}

// ─── sendToKitchen ────────────────────────────────────────────

export async function sendToKitchen(params: {
  orderId: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const items = await writer.collections
      .get<OrderItem>("order_items")
      .query(
        Q.where("order_id", params.orderId),
        Q.where("is_voided", false),
        Q.where("is_sent_to_kitchen", false),
      )
      .fetch();

    for (const item of items) {
      await item.update((oi) => {
        oi.isSentToKitchen = true;
      });
    }
  });

  syncManager.triggerPush();
}

// ─── createAndSendToKitchen ───────────────────────────────────
// Combines createOrder + addItemToOrder (for each item) + sendToKitchen

type DraftItem = {
  productId: string;
  quantity: number;
  notes?: string;
  modifiers?: Array<{
    modifierGroupName: string;
    modifierOptionName: string;
    priceAdjustment: number;
  }>;
  customPrice?: number;
};

export async function createAndSendToKitchen(params: {
  storeId: string;
  tableId: string;
  pax: number;
  items: DraftItem[];
  tabNumber?: number;
  tabName?: string;
}): Promise<{
  orderId: string;
  orderNumber: string;
  sentItemIds: string[];
}> {
  const db = getDatabase();
  const orderId = uid();
  const orderNumber = `D-${Date.now().toString().slice(-6)}`;
  const sentItemIds: string[] = [];

  await db.write(async (writer) => {
    // Create the order
    await writer.collections.get<Order>("orders").create((o) => {
      o._raw.id = orderId;
      o.storeId = params.storeId;
      o.orderNumber = orderNumber;
      o.orderType = "dine_in";
      o.tableId = params.tableId;
      o.pax = params.pax;
      o.tabNumber = params.tabNumber;
      o.tabName = params.tabName;
      o.status = "open";
      o.createdBy = "";
      o.createdAt = Date.now();
      o.grossSales = 0;
      o.vatableSales = 0;
      o.vatAmount = 0;
      o.vatExemptSales = 0;
      o.nonVatSales = 0;
      o.discountAmount = 0;
      o.netSales = 0;
      o.itemCount = 0;
    });

    // Create items with modifiers
    for (const d of params.items) {
      const product = await writer.collections
        .get<Product>("products")
        .find(d.productId);

      const basePrice = d.customPrice ?? product.price;
      const oiId = uid();
      sentItemIds.push(oiId);

      await writer.collections.get<OrderItem>("order_items").create((oi) => {
        oi._raw.id = oiId;
        oi.orderId = orderId;
        oi.productId = d.productId;
        oi.productName = product.name;
        oi.productPrice = basePrice;
        oi.quantity = d.quantity;
        oi.notes = d.notes || undefined;
        oi.isVoided = false;
        oi.isSentToKitchen = true;
      });

      if (d.modifiers) {
        for (const mod of d.modifiers) {
          await writer.collections
            .get<OrderItemModifier>("order_item_modifiers")
            .create((oim) => {
              oim._raw.id = uid();
              oim.orderItemId = oiId;
              oim.modifierGroupName = mod.modifierGroupName;
              oim.modifierOptionName = mod.modifierOptionName;
              oim.priceAdjustment = mod.priceAdjustment;
            });
        }
      }
    }

    // Update table status
    const table = await writer.collections
      .get<TableModel>("tables")
      .find(params.tableId);
    await table.update((t) => {
      t.status = "occupied";
    });
  });

  await recalculateOrderTotals(orderId);

  // Patch itemCount from recalculated totals
  await db.write(async (writer) => {
    const order = await writer.collections
      .get<Order>("orders")
      .find(orderId);
    const totalQty = params.items.reduce((s, d) => s + d.quantity, 0);
    await order.update((o) => {
      o.itemCount = totalQty;
    });
  });

  syncManager.triggerPush();

  return { orderId, orderNumber, sentItemIds };
}
```

### Step 2: Commit

```bash
git add apps/native/src/features/orders/services/orderMutations.ts
git commit -m "feat(native): add orderMutations service — create, addItem, removeItem, updateQuantity, sendToKitchen"
```

---

## Task 6: Create `checkoutMutations.ts` service

**Files:**
- Create: `apps/native/src/features/checkout/services/checkoutMutations.ts`

### Step 1: Create the file

```typescript
import { Q } from "@nozbe/watermelondb";
import { generateUUID } from "../../../../sync/idBridge";
import { syncManager } from "../../../../sync/SyncManager";
import {
  getDatabase,
  type Order,
  type OrderPayment,
  type OrderVoid,
  type TableModel,
} from "../../../db";

function uid(): string {
  return generateUUID();
}

// ─── processPayment ───────────────────────────────────────────

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
    const order = await writer.collections
      .get<Order>("orders")
      .find(params.orderId);

    for (const p of params.payments) {
      await writer.collections
        .get<OrderPayment>("order_payments")
        .create((op) => {
          op._raw.id = uid();
          op.orderId = params.orderId;
          op.storeId = order.storeId;
          op.paymentMethod = p.paymentMethod;
          op.amount = p.amount;
          op.cashReceived = p.cashReceived || undefined;
          op.changeGiven = p.changeGiven || undefined;
          op.cardPaymentType = p.cardPaymentType || undefined;
          op.cardReferenceNumber = p.cardReferenceNumber || undefined;
          op.createdAt = Date.now();
          op.createdBy = "";
        });
    }

    const primaryPayment = params.payments[0];
    await order.update((o) => {
      o.status = "paid";
      o.paymentMethod = primaryPayment.paymentMethod;
      o.cashReceived = primaryPayment.cashReceived || undefined;
      o.changeGiven = primaryPayment.changeGiven || undefined;
      o.cardPaymentType = primaryPayment.cardPaymentType || undefined;
      o.cardReferenceNumber = primaryPayment.cardReferenceNumber || undefined;
      o.paidAt = Date.now();
      o.paidBy = "";
    });

    if (order.tableId) {
      const otherOpen = await writer.collections
        .get<Order>("orders")
        .query(
          Q.where("table_id", order.tableId),
          Q.where("status", "open"),
        )
        .fetch();

      if (otherOpen.length === 0) {
        const table = await writer.collections
          .get<TableModel>("tables")
          .find(order.tableId);
        await table.update((t) => {
          t.status = "available";
        });
      }
    }
  });

  syncManager.triggerPush();
}

// ─── cancelOrder ──────────────────────────────────────────────

export async function cancelOrder(params: {
  orderId: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections
      .get<Order>("orders")
      .find(params.orderId);

    await order.update((o) => {
      o.status = "voided";
    });

    await writer.collections.get<OrderVoid>("order_voids").create((ov) => {
      ov._raw.id = uid();
      ov.orderId = params.orderId;
      ov.voidType = "order";
      ov.reason = "Order cancelled by cashier";
      ov.approvedBy = "";
      ov.requestedBy = "";
      ov.amount = order.netSales;
      ov.createdAt = Date.now();
    });

    if (order.tableId) {
      const otherOpen = await writer.collections
        .get<Order>("orders")
        .query(
          Q.where("table_id", order.tableId),
          Q.where("status", "open"),
        )
        .fetch();

      if (otherOpen.length === 0) {
        const table = await writer.collections
          .get<TableModel>("tables")
          .find(order.tableId);
        await table.update((t) => {
          t.status = "available";
        });
      }
    }
  });

  syncManager.triggerPush();
}
```

### Step 2: Commit

```bash
git add apps/native/src/features/checkout/services/checkoutMutations.ts
git commit -m "feat(native): add checkoutMutations service — processPayment, cancelOrder"
```

---

## Task 7: Create `takeoutMutations.ts` service

**Files:**
- Create: `apps/native/src/features/takeout/services/takeoutMutations.ts`

### Step 1: Create the file

```typescript
import { Q } from "@nozbe/watermelondb";
import { generateUUID } from "../../../../sync/idBridge";
import { syncManager } from "../../../../sync/SyncManager";
import { getDatabase, type Order } from "../../../db";

function uid(): string {
  return generateUUID();
}

// ─── createDraftOrder ─────────────────────────────────────────

export async function createDraftOrder(params: {
  storeId: string;
  draftLabel?: string;
}): Promise<string> {
  const db = getDatabase();
  let orderId = "";

  await db.write(async (writer) => {
    await writer.collections.get<Order>("orders").create((o) => {
      orderId = uid();
      o._raw.id = orderId;
      o.storeId = params.storeId;
      o.orderType = "takeout";
      o.status = "draft";
      o.draftLabel = params.draftLabel || undefined;
      o.createdBy = "";
      o.createdAt = Date.now();
      o.grossSales = 0;
      o.vatableSales = 0;
      o.vatAmount = 0;
      o.vatExemptSales = 0;
      o.nonVatSales = 0;
      o.discountAmount = 0;
      o.netSales = 0;
      o.itemCount = 0;
      o.takeoutStatus = "pending";
    });
  });

  syncManager.triggerPush();
  return orderId;
}

// ─── discardDraft ─────────────────────────────────────────────

export async function discardDraft(params: {
  orderId: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections
      .get<Order>("orders")
      .find(params.orderId);
    await order.update((o) => {
      o.status = "voided";
    });
  });

  syncManager.triggerPush();
}

// ─── submitDraft ──────────────────────────────────────────────

export async function submitDraft(params: {
  orderId: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections
      .get<Order>("orders")
      .find(params.orderId);
    await order.update((o) => {
      o.status = "open";
      o.takeoutStatus = "pending";
    });
  });

  syncManager.triggerPush();
}

// ─── updateTakeoutStatus ──────────────────────────────────────

export async function updateTakeoutStatus(params: {
  orderId: string;
  status: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections
      .get<Order>("orders")
      .find(params.orderId);
    await order.update((o) => {
      o.takeoutStatus = params.status;
    });
  });

  syncManager.triggerPush();
}
```

### Step 2: Commit

```bash
git add apps/native/src/features/takeout/services/takeoutMutations.ts
git commit -m "feat(native): add takeoutMutations service — createDraft, discardDraft, submitDraft, updateStatus"
```

---

## Task 8: Create `discountMutations.ts` service

**Files:**
- Create: `apps/native/src/features/discounts/services/discountMutations.ts`

### Step 1: Create the file

```typescript
import { Q } from "@nozbe/watermelondb";
import { generateUUID } from "../../../../sync/idBridge";
import { syncManager } from "../../../../sync/SyncManager";
import { getDatabase, type Order, type OrderDiscount } from "../../../db";
import { recalculateOrderTotals } from "../../../orders/services/recalculateOrder";

function uid(): string {
  return generateUUID();
}

// ─── applyBulkScPwdDiscount ───────────────────────────────────

export async function applyBulkScPwdDiscount(params: {
  orderId: string;
  items: Array<{
    orderItemId: string;
    quantityApplied: number;
  }>;
  discountType: "senior_citizen" | "pwd";
  customerName: string;
  customerId: string;
  managerId: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    for (const item of params.items) {
      const basePrice = 0; // price comes from the orderItem — we calculate discount server-side or locally
      // For now, insert the discount record. The discount amount + vat exempt amount
      // will be computed by recalculateOrderTotals when it walks the items.

      await writer.collections
        .get<OrderDiscount>("order_discounts")
        .create((d) => {
          d._raw.id = uid();
          d.orderId = params.orderId;
          d.orderItemId = item.orderItemId;
          d.discountType = params.discountType;
          d.customerName = params.customerName;
          d.customerId = params.customerId;
          d.quantityApplied = item.quantityApplied;
          d.discountAmount = 0;
          d.vatExemptAmount = 0;
          d.approvedBy = params.managerId;
          d.createdAt = Date.now();
        });
    }
  });

  await recalculateOrderTotals(params.orderId);
  syncManager.triggerPush();
}

// ─── removeDiscount ───────────────────────────────────────────

export async function removeDiscount(params: {
  discountId: string;
  managerId: string;
}): Promise<void> {
  const db = getDatabase();

  let orderId = "";

  await db.write(async (writer) => {
    const discount = await writer.collections
      .get<OrderDiscount>("order_discounts")
      .find(params.discountId);
    orderId = discount.orderId;
    await discount.markAsDeleted();
  });

  await recalculateOrderTotals(orderId);
  syncManager.triggerPush();
}
```

### Step 2: Commit

```bash
git add apps/native/src/features/discounts/services/discountMutations.ts
git commit -m "feat(native): add discountMutations service — applyBulkScPwdDiscount, removeDiscount"
```

---

## Task 9: Create `checkout/services/index.ts` barrel

**Files:**
- Create: `apps/native/src/features/checkout/services/index.ts`

### Step 1: Create barrel

```typescript
export { cancelOrder, processPayment } from "./checkoutMutations";
```

### Step 2: Commit

```bash
git add apps/native/src/features/checkout/services/index.ts
git commit -m "feat(native): add checkout services barrel export"
```

---

## Task 10: Create `takeout/services/index.ts` barrel

**Files:**
- Create: `apps/native/src/features/takeout/services/index.ts`

### Step 1: Create barrel

```typescript
export {
  createDraftOrder,
  discardDraft,
  submitDraft,
  updateTakeoutStatus,
} from "./takeoutMutations";
```

### Step 2: Commit

```bash
git add apps/native/src/features/takeout/services/index.ts
git commit -m "feat(native): add takeout services barrel export"
```

---

## Task 11: Create `discounts/services/index.ts` barrel

**Files:**
- Create: `apps/native/src/features/discounts/services/index.ts`

### Step 1: Create barrel

```typescript
export { applyBulkScPwdDiscount, removeDiscount } from "./discountMutations";
```

### Step 2: Commit

```bash
git add apps/native/src/features/discounts/services/index.ts
git commit -m "feat(native): add discounts services barrel export"
```

---

## Task 12: Refactor `OrderScreen.tsx` — remove `useMutation`, use service functions

**Files:**
- Modify: `apps/native/src/features/orders/screens/OrderScreen.tsx`

The changes are surgical: replace mutation hook calls with direct service function imports.

### Step 1: Replace imports

Replace the imports section (lines 1-28) with:

```typescript
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, TextInput } from "react-native";
import { GestureHandlerRootView, Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { useModifiersForProduct, useProducts } from "../../../sync";
import { useAuth } from "../../auth/context";
import type { KitchenTicketData } from "../../settings/services/escposFormatter";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { Text } from "../../shared/components/ui";
import type { SelectedModifier } from "../components";
import {
  AddItemModal,
  CartFooter,
  CartItem,
  CategoryGrid,
  EditTabNameModal,
  ModifierSelectionModal,
  OrderHeader,
  TransferTableModal,
  ViewBillModal,
  VoidItemModal,
} from "../components";
import {
  addItemToOrder,
  createAndSendToKitchen,
  createOrder,
  removeItemFromOrder,
  sendToKitchen,
  updateItemQuantity,
  updateItemServiceType,
  updateOrderPax,
  updateTabName,
} from "../services/orderMutations";
import { cancelOrder } from "../../checkout/services/checkoutMutations";
```

### Step 2: Remove `useCartMutations` call and all mutation hooks

Remove lines 128-143 (the `useCartMutations()` block and all `useMutation()` calls). Replace with:

```typescript
  // Mutations — all replaced by direct service function calls
  // that write to WatermelonDB. No more useMutation.
```

Also remove line 28 (`import { useCartMutations } from "../hooks/useCartMutations";` — already removed in step 1).

### Step 3: Remove the `addItemLockRef`, `cancelOrderLockRef`, `sendToKitchenLockRef` usages

The lock refs can stay since they prevent double-clicks — service functions don't change that.

### Step 4: Fix `handleConfirmAdd` (non-modifier product)

Replace the implementation at line 225-240 (the `if (isDraftMode)` block and the `await addItem(...)` call):

```typescript
      try {
        if (isDraftMode) {
          // Draft mode: create the order first, then add the item
          const orderId = await createOrder({
            storeId,
            orderType: "dine_in",
            tableId,
            pax: 1,
          });
          setCurrentOrderId(orderId as Id<"orders">);
          await addItemToOrder({
            orderId,
            productId: selectedProduct.id,
            quantity,
            notes: notes || undefined,
            customPrice: selectedProduct.isOpenPrice ? customPrice : undefined,
          });
          setSelectedProduct(null);
          return;
        }

        setIsAddingItem(true);
        await addItemToOrder({
          orderId: currentOrderId! as string,
          productId: selectedProduct.id,
          quantity,
          notes: notes || undefined,
          customPrice: selectedProduct.isOpenPrice ? customPrice : undefined,
        });
        setSelectedProduct(null);
      } catch (error) {
```

### Step 5: Fix `handleConfirmModifiers` (has modifiers)

Replace the implementation at lines 270-300 (the `if (isDraftMode)` block and the modifier `await addItem(...)`):

```typescript
      try {
        if (isDraftMode) {
          const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
          const orderId = await createOrder({
            storeId,
            orderType: "dine_in",
            tableId,
            pax: 1,
          });
          setCurrentOrderId(orderId as Id<"orders">);
          await addItemToOrder({
            orderId,
            productId: selectedProduct.id,
            quantity: qty,
            notes: itemNotes || undefined,
            modifiers,
            customPrice: selectedProduct.isOpenPrice ? customPrice : undefined,
          });
          setSelectedProduct(null);
          return;
        }

        setIsAddingItem(true);
        await addItemToOrder({
          orderId: currentOrderId! as string,
          productId: selectedProduct.id,
          quantity: qty,
          notes: itemNotes || undefined,
          modifiers,
          customPrice: selectedProduct.isOpenPrice ? customPrice : undefined,
        });
        setSelectedProduct(null);
      } catch (error) {
```

### Step 6: Fix `handleIncrement` and `handleDecrement`

Replace the `await updateItemQuantity(...)` calls:

```typescript
// handleIncrement:
await updateItemQuantity({ orderItemId: itemId, quantity: currentQty + 1 });

// handleDecrement (decrement path):
await updateItemQuantity({ orderItemId: itemId, quantity: currentQty - 1 });

// handleDecrement (remove path):
await removeItemFromOrder({ orderItemId: itemId });

// handleSetQuantity:
await updateItemQuantity({ orderItemId: itemId, quantity: targetQty });
```

### Step 7: Fix `handleConfirmVoid`

Replace `await removeItemMutation(...)` with:

```typescript
await removeItemFromOrder({ orderItemId: voidingItem.id, voidReason: reason });
```

### Step 8: Fix `handleServiceTypeChange`

Replace `await updateItemServiceType(...)` with the same function name but imported from service:

```typescript
await updateItemServiceType({ orderItemId: itemId, serviceType });
```

(Already imported in step 1.)

### Step 9: Fix `executeSendToKitchen` — draft path

Replace the `createAndSendMutation` call at lines 461-476 with:

```typescript
          try {
            const tabCount = await getExistingTabCount(tableId);
            result = await createAndSendToKitchen({
              storeId,
              tableId: tableId as string,
              pax: paxValue,
              tabNumber: tabCount + 1,
              tabName: `Tab ${tabCount + 1}`,
              items: draftItems.map((d) => ({
                productId: d.productId,
                quantity: d.quantity,
                notes: d.notes,
                modifiers: d.modifiers?.map((m) => ({
                  modifierGroupName: m.modifierGroupName,
                  modifierOptionName: m.modifierOptionName,
                  priceAdjustment: m.priceAdjustment,
                })),
                customPrice: d.customPrice,
              })),
            });
```

For the helper function, add at the top of `executeSendToKitchen` callback (or as a module-level import — we'll inline it):

```typescript
async function getExistingTabCount(tableId: string): Promise<number> {
  const db = getDatabase();
  const existing = await db.collections
    .get<Order>("orders")
    .query(Q.where("table_id", tableId), Q.where("status", "open"))
    .fetch();
  return existing.length;
}
```

Actually, let's keep it simpler — just compute tabCount inside the callback:

```typescript
  const executeSendToKitchen = useCallback(
    async (paxValue?: number) => {
      if (sendToKitchenLockRef.current) return;
      sendToKitchenLockRef.current = true;
      setIsSending(true);
      let shouldReleaseLock = true;
      try {
        let orderNumber: string;
        let sentItemNames: { name: string; quantity: number; notes?: string }[];

        if (isDraftMode) {
          if (!tableId) throw new Error("Table ID is required");
          if (!storeId) throw new Error("Store ID is required");
          if (!paxValue || paxValue < 1) throw new Error("Guest count is required");
          if (draftItems.length === 0) throw new Error("No items to send");

          const result = await createAndSendToKitchen({
            storeId: storeId as string,
            tableId: tableId as string,
            pax: paxValue,
            items: draftItems.map((d) => ({
              productId: d.productId,
              quantity: d.quantity,
              notes: d.notes,
              modifiers: d.modifiers,
              customPrice: d.customPrice,
            })),
          });

          setCurrentOrderId(result.orderId as Id<"orders">);
          orderNumber = result.orderNumber;
          sentItemNames = draftItems.map((d) => ({
            name: d.productName,
            quantity: d.quantity,
            notes: d.notes,
            serviceType: "dine_in" as const,
            modifiers: d.modifiers?.map((m) => ({
              optionName: m.modifierOptionName,
              priceAdjustment: m.priceAdjustment,
            })),
          }));
          setDraftItems([]);
```

### Step 10: Fix `executeSendToKitchen` — existing order path

Replace `await sendToKitchenMutation(...)` at line 513 with:

```typescript
          await sendToKitchen({ orderId: currentOrderId as string });
```

### Step 11: Fix `handlePaxConfirm`

Replace `await updatePaxMutation(...)` with:

```typescript
await updateOrderPax({ orderId: currentOrderId!, pax });
```

### Step 12: Fix `handleCancelOrder`

Replace `await cancelOrderMutation(...)` with:

```typescript
await cancelOrder({ orderId: currentOrderId! });
```

### Step 13: Fix `handleSaveTabName`

Replace `await updateTabNameMutation(...)` with:

```typescript
await updateTabName({ orderId: currentOrderId!, tabName: newName });
```

### Step 14: Fix `handleAddNewTab`

Replace `await createOrderMutation(...)` with:

```typescript
      const newOrderId = await createOrder({
        storeId: storeId as string,
        orderType: "dine_in",
        tableId: tableId as string,
        pax: 1,
        requestId: Crypto.randomUUID(),
      });
```

Remove `import * as Crypto from "expo-crypto";` if no longer needed — but it's still used for `requestId`. Keep it.

### Step 15: Remove unused `useCartMutations` hook file references

The `useCartMutations` file is no longer imported. Mark it for deletion (but don't delete yet — do that in a separate cleanup commit).

### Step 16: Commit

```bash
git add apps/native/src/features/orders/screens/OrderScreen.tsx
git commit -m "feat(native): refactor OrderScreen to use WatermelonDB service functions"
```

---

## Task 13: Wire `removeItemFromOrder` to also track orderId for recalculation

**Files:**
- Modify: `apps/native/src/features/orders/services/orderMutations.ts`

The current `removeItemFromOrder` calls `recalculateOrderTotals(params.orderId)` but `orderId` is never received — only `orderItemId`. We need to look up the orderId from the item first.

### Step 1: Fix `removeItemFromOrder`

Rewrite `removeItemFromOrder` in `apps/native/src/features/orders/services/orderMutations.ts`:

```typescript
export async function removeItemFromOrder(params: {
  orderItemId: string;
  voidReason?: string;
}): Promise<void> {
  const db = getDatabase();
  let orderId = "";

  await db.write(async (writer) => {
    const item = await writer.collections
      .get<OrderItem>("order_items")
      .find(params.orderItemId);

    orderId = item.orderId;

    await item.update((oi) => {
      oi.isVoided = true;
      oi.voidReason = params.voidReason || undefined;
      oi.voidedAt = Date.now();
    });

    const order = await writer.collections
      .get<Order>("orders")
      .find(orderId);
    await order.update((o) => {
      o.itemCount = Math.max(0, (o.itemCount ?? 0) - item.quantity);
    });
  });

  await recalculateOrderTotals(orderId);
  syncManager.triggerPush();
}
```

### Step 2: Commit

```bash
git add apps/native/src/features/orders/services/orderMutations.ts
git commit -m "fix(native): track orderId from item lookup in removeItemFromOrder"
```

---

## Task 14: Run typecheck and verify

**Files:** (none — verification only)

### Step 1: Run typecheck

```bash
cd apps/native && pnpm typecheck
```
Expected: zero new errors from our changes.

### Step 2: Fix any errors

If there are errors from the service functions or screen refactoring, fix them before proceeding.

---

## Self-Review

**1. Spec coverage:**
- Port tax to shared → Task 1
- SyncManager triggerPush → Task 2
- ID generator → Task 3
- recalculateOrderTotals → Task 4
- orderMutations → Task 5
- checkoutMutations → Task 6
- takeoutMutations → Task 7
- discountMutations → Task 8
- CheckoutScreen → not yet done (need Task 15)
- TakeoutOrderScreen, TakeoutListScreen → not yet done (need Tasks 16, 17)
- Delete useCartMutations → not yet done (need Task 18)

**2. Placeholder scan:** No TBD/TODO. Every step has actual code. Some tasks reference screens not yet refactored — those are called out in remaining tasks below.

**3. Type consistency:** All service functions use the same pattern (`uid()`, `getDatabase()`, `syncManager.triggerPush()`). Types match between `orderMutations.ts` and `checkoutMutations.ts`.

## Task 15: Refactor `CheckoutScreen.tsx` — replace `useMutation` with service functions

**Files:**
- Modify: `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`

### Step 1: Update imports

Replace lines 1-24 with:

```typescript
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, TextInput } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { XStack, YStack } from "tamagui";
import { useStore } from "../../../sync";
import { useAuth } from "../../auth/context";
import type { KitchenTicketData } from "../../settings/services/escposFormatter";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { type ReceiptData, useFormatCurrency } from "../../shared";
import { PageHeader } from "../../shared/components/PageHeader";
import { Button, Card, Text } from "../../shared/components/ui";
import {
  DiscountModal,
  DiscountSection,
  ManagerPinModal,
  OrderSummary,
  ReceiptPreviewModal,
  TotalsSummary,
} from "../components";
import { processPayment } from "../services/checkoutMutations";
import { applyBulkScPwdDiscount, removeDiscount } from "../../discounts/services/discountMutations";
```

### Step 2: Remove mutation hook calls

Remove lines 101-104:
```typescript
const processPaymentMutation = useMutation(api.checkout.processPayment);
const applyBulkScPwdDiscount = useMutation(api.discounts.applyBulkScPwdDiscount);
const removeDiscount = useMutation(api.discounts.removeDiscount);
```

### Step 3: Fix `handleManagerPinSuccess` — discount apply

Replace the `await applyBulkScPwdDiscount({...})` call at line 259 with the same function name (it's now imported from service):

```typescript
await applyBulkScPwdDiscount({
  orderId,
  items,
  discountType,
  customerName: discountName.trim(),
  customerId: discountIdNumber.trim(),
  managerId,
});
```

### Step 4: Fix `handleManagerPinSuccess` — discount remove

Replace `await removeDiscount({...})` at line 276 with:

```typescript
await removeDiscount({ discountId: discountToRemove, managerId });
```

### Step 5: Fix `handleProcessPayment`

Replace `await processPaymentMutation({ orderId, payments })` at line 485 with:

```typescript
await processPayment({ orderId, payments });
```

Also update the `useCallback` dependency array on lines 529-541: remove `processPaymentMutation`. Keep all other deps.

### Step 6: Remove unused `useMutation` import

`useMutation` from `convex/react` is no longer used — remove it from the import. Keep `useQuery` (still used for `api.orders.get` and `api.discounts.getOrderDiscounts`).

### Step 7: Commit

```bash
git add apps/native/src/features/checkout/screens/CheckoutScreen.tsx
git commit -m "feat(native): refactor CheckoutScreen to use WatermelonDB service functions"
```

---

## Task 16: Refactor `TakeoutOrderScreen.tsx` — replace `useMutation` with service functions

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx`

### Step 1: Update imports

Replace lines 1-24 with:

```typescript
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActivityIndicator, Alert, FlatList, TextInput } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { useModifiersForStore, useProducts } from "../../../sync";
import { useAuth } from "../../auth/context";
import type { SelectedModifier } from "../../orders/components";
import {
  AddItemModal,
  CartItem,
  CategoryGrid,
  ModifierSelectionModal,
  VoidItemModal,
} from "../../orders/components";
import type { KitchenTicketData } from "../../settings/services/escposFormatter";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { PageHeader } from "../../shared/components/PageHeader";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import {
  addItemToOrder,
  removeItemFromOrder,
  sendToKitchen,
  updateItemQuantity,
  updateItemServiceType,
} from "../../orders/services/orderMutations";
import { cancelOrder } from "../../checkout/services/checkoutMutations";
import {
  createDraftOrder,
  discardDraft,
  submitDraft,
} from "../services/takeoutMutations";
```

### Step 2: Remove mutation hook calls

Remove lines 91-100:
```typescript
const addItemMutation = useMutation(api.orders.addItem);
const updateItemQuantity = useMutation(api.orders.updateItemQuantity);
const removeItemMutation = useMutation(api.orders.removeItem);
const cancelOrderMutation = useMutation(api.checkout.cancelOrder);
const discardDraftMutation = useMutation(api.orders.discardDraft);
const submitDraftMutation = useMutation(api.orders.submitDraft);
const updateCustomerNameMutation = useMutation(api.orders.updateCustomerName);
const updateItemServiceTypeMutation = useMutation(api.orders.updateItemServiceType);
const sendToKitchenMutation = useMutation(api.orders.sendToKitchenWithoutPayment);
```

### Step 3: Fix `handleCustomerNameBlur` (line 118)

Replace:
```typescript
updateCustomerNameMutation({ orderId, customerName: customerName.trim() || undefined });
```
with:
```typescript
import { updateCustomerName } from "../../orders/services/orderMutations";
...
await updateCustomerName({ orderId, customerName: customerName.trim() || undefined });
```

Add `updateCustomerName` to the import from `orderMutations` in Step 1.

### Step 4: Fix `handleCategoryChange` (line 125)

Replace `await updateCustomerNameMutation(...)` with `await updateCustomerName(...)`.

### Step 5: Fix `handleServiceTypeChange` (line 138)

Replace `await updateItemServiceTypeMutation(...)` with:
```typescript
await updateItemServiceType({ orderItemId: itemId, serviceType });
```

### Step 6: Fix `handleTableMarkerBlur` (line 149)

Replace `await updateCustomerNameMutation(...)` with `await updateCustomerName(...)`.

### Step 7: Fix `handleConfirmAdd` (line 244)

Replace `await addItemMutation({...})` at line 251 with:
```typescript
await addItemToOrder({
  orderId: orderId as string,
  productId: selectedProduct.id,
  quantity,
  notes: notes || undefined,
  ...(selectedProduct.isOpenPrice && customPrice !== undefined ? { customPrice } : {}),
});
```

### Step 8: Fix `handleConfirmModifiers` (line 270)

Replace `await addItemMutation({...})` at line 277 with:
```typescript
await addItemToOrder({
  orderId: orderId as string,
  productId: selectedProduct.id,
  quantity: qty,
  notes: itemNotes || undefined,
  modifiers,
  ...(selectedProduct.isOpenPrice && customPrice !== undefined ? { customPrice } : {}),
});
```

### Step 9: Fix `handleIncrement` (line 297)

Replace:
```typescript
await updateItemQuantity({ orderItemId: itemId, quantity: currentQty + 1 });
```
with:
```typescript
await updateItemQuantity({ orderItemId: itemId, quantity: currentQty + 1 });
```
(Name matches — already correct since we import from service now.)

### Step 10: Fix `handleDecrement` (line 309)

Replace `await updateItemQuantity(...)` and `await removeItemMutation(...)` with:
```typescript
await updateItemQuantity({ orderItemId: itemId, quantity: currentQty - 1 });
// ... and for the remove path:
await removeItemFromOrder({ orderItemId: itemId });
```

### Step 11: Fix `handleConfirmVoid` (line 349)

Replace `await removeItemMutation(...)` with:
```typescript
await removeItemFromOrder({ orderItemId: voidingItem.id, voidReason: reason });
```

### Step 12: Fix `handleSendToKitchen` (line 398)

Replace the calls:
- `await submitDraftMutation({ orderId })` → `await submitDraft({ orderId: orderId as string })`
- `await sendToKitchenMutation({ orderId, storeId })` → `await sendToKitchen({ orderId: orderId as string })`

### Step 13: Fix `handleCancelOrder` (line 185)

Replace:
- `await discardDraftMutation({ orderId })` → `await discardDraft({ orderId: orderId as string })`
- `await cancelOrderMutation({ orderId })` → `await cancelOrder({ orderId: orderId as string })`

### Step 14: Remove unused `useMutation` import

`useMutation` from `convex/react` is no longer used. Keep `useQuery` (still used for `api.orders.get`).

### Step 15: Commit

```bash
git add apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx
git commit -m "feat(native): refactor TakeoutOrderScreen to use WatermelonDB service functions"
```

---

## Task 17: Refactor `TakeoutListScreen.tsx` — replace `useMutation` with service functions

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`

### Step 1: Update imports

Replace lines 1-14 with:

```typescript
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActivityIndicator, Alert, FlatList, RefreshControl } from "react-native";
import { XStack, YStack } from "tamagui";
import { useTakeoutOrders } from "../../../sync";
import { useAuth } from "../../auth/context";
import { PageHeader } from "../../shared/components/PageHeader";
import { Button, IconButton, Text } from "../../shared/components/ui";
import { DraftOrderCard, TakeoutOrderCard, TakeoutOrderDetailModal } from "../components";
import {
  createDraftOrder,
  discardDraft,
  updateTakeoutStatus,
} from "../services/takeoutMutations";
```

### Step 2: Remove mutation hook calls

Remove lines 69-71:
```typescript
const updateStatus = useMutation(api.orders.updateTakeoutStatus);
const createDraftMutation = useMutation(api.orders.createDraftOrder);
const discardDraftMutation = useMutation(api.orders.discardDraft);
```

### Step 3: Fix `handleAdvanceStatus` (line 120)

Replace `await updateStatus({ orderId, newStatus: nextStatus })` with:
```typescript
await updateTakeoutStatus({ orderId: orderId as string, status: nextStatus });
```

### Step 4: Fix `handleNewOrder` (line 146)

Replace `await createDraftMutation({...})` with:
```typescript
const orderId = await createDraftOrder({
  storeId: user.storeId,
  draftLabel: undefined,
});
```

Remove `import * as Crypto from "expo-crypto";` if no longer needed.

### Step 5: Fix `handleDiscardDraft` (line 231)

Replace `await discardDraftMutation({ orderId })` with:
```typescript
await discardDraft({ orderId: orderId as string });
```

### Step 6: Remove unused `useMutation` import

`useMutation` from `convex/react` is no longer used. Keep `useQuery` (still used for `api.orders.getDraftOrders`).

### Step 7: Commit

```bash
git add apps/native/src/features/takeout/screens/TakeoutListScreen.tsx
git commit -m "feat(native): refactor TakeoutListScreen to use WatermelonDB service functions"
```

---

## Task 18: Delete `useCartMutations.ts`

**Files:**
- Delete: `apps/native/src/features/orders/hooks/useCartMutations.ts`

### Step 1: Verify no remaining imports

```bash
cd apps/native && rg "useCartMutations" --files-with-matches
```
Expected: empty (no remaining references).

### Step 2: Delete the file

```bash
rm apps/native/src/features/orders/hooks/useCartMutations.ts
```

### Step 3: Commit

```bash
git add apps/native/src/features/orders/hooks/useCartMutations.ts
git commit -m "refactor(native): delete useCartMutations (replaced by orderMutations service)"
```

---

## Task 19: Final typecheck and lint

**Files:** (none — verification only)

### Step 1: Run full typecheck

```bash
cd apps/native && pnpm typecheck
```
Expected: zero new errors from our changes; only pre-existing `printerAlign`/`expo-modules-core` noise.

### Step 2: Run lint

```bash
cd apps/native && pnpm lint
```
Expected: zero errors. Fix any lint issues if they appear.

### Step 3: Commit (only if fixes were needed)

```bash
git add -A
git commit -m "chore(native): lint fixes for Phase 4 local-first writes"
```

---

## Self-Review (complete)

**1. Spec coverage (all sections now mapped):**
- Port tax to shared → Task 1
- SyncManager triggerPush → Task 2
- ID generator → Task 3
- recalculateOrderTotals → Task 4
- orderMutations service → Task 5
- checkoutMutations service → Task 6
- takeoutMutations service → Task 7
- discountMutations service → Task 8
- Barrel exports → Tasks 9-11
- OrderScreen refactor → Task 12
- removeItemFromOrder fix → Task 13
- CheckoutScreen refactor → Task 15
- TakeoutOrderScreen refactor → Task 16
- TakeoutListScreen refactor → Task 17
- Delete useCartMutations → Task 18
- Verification → Tasks 14, 19

**2. Placeholder scan:** No TBD/TODO. Every step has actual code.

**3. Type consistency:** All service functions use `generateUUID()` from `sync/idBridge.ts`, `getDatabase()` from `db`, `syncManager.triggerPush()` from `sync/SyncManager.ts`. Screen refactors import from the same service modules. The `removeItemFromOrder` fix in Task 13 properly tracks `orderId` from the item lookup.
