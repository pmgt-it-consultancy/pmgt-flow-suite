# Item-Level Service Type Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-item dine-in/takeout designation so kitchen tickets can group items by service type and customer receipts tag exception items.

**Architecture:** Add `serviceType` field to `orderItems` schema. Backend mutations (`addItem`, `createAndSendToKitchen`) default it from the parent order. New mutations (`updateItemServiceType`, `bulkUpdateItemServiceType`) allow changes with `isSentToKitchen` guard. Native UI adds a segmented control per cart item. Receipt formatters group/tag items by service type.

**Tech Stack:** Convex (backend schema + mutations), React Native + Tamagui (native UI), ESC/POS thermal printing, Next.js (web admin)

**Spec:** `docs/superpowers/specs/2026-03-28-item-level-service-type-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/backend/convex/schema.ts` | Add `serviceType` to `orderItems` |
| Modify | `packages/backend/convex/orders.ts` | Update `addItem`, `createAndSendToKitchen`, `get` return validator; add `updateItemServiceType`, `bulkUpdateItemServiceType` |
| Modify | `packages/backend/convex/orders.test.ts` | Tests for new/modified mutations |
| Modify | `apps/native/src/features/settings/services/escposFormatter.ts` | Update interfaces, kitchen ticket grouping, receipt tagging |
| Modify | `apps/native/src/features/shared/utils/receipt.ts` | Update `ReceiptItem` interface, `generateReceiptHtml` tagging |
| Modify | `apps/native/src/features/orders/components/CartItem.tsx` | Add DINE IN / TAKEOUT segmented control |
| Modify | `apps/native/src/features/orders/screens/OrderScreen.tsx` | Pass `serviceType` and handler to CartItem |
| Modify | `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx` | Pass `serviceType` and handler to CartItem; bulk update on category toggle |
| Modify | `apps/native/src/features/checkout/screens/CheckoutScreen.tsx` | Pass `serviceType` into kitchen and receipt data |
| Modify | `apps/web/src/app/(admin)/orders/page.tsx` | Show service type badge on exception items |

---

## Chunk 1: Backend Schema & Mutations

### Task 1: Add `serviceType` to schema

**Files:**
- Modify: `packages/backend/convex/schema.ts:221-233`

- [ ] **Step 1: Add serviceType field to orderItems table**

In `packages/backend/convex/schema.ts`, find the `orderItems` table definition (line ~221). Add `serviceType` after the `notes` field:

```typescript
serviceType: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
```

The full table should become:
```typescript
orderItems: defineTable({
  orderId: v.id("orders"),
  productId: v.id("products"),
  productName: v.string(),
  productPrice: v.number(),
  quantity: v.number(),
  notes: v.optional(v.string()),
  serviceType: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
  isVoided: v.boolean(),
  isSentToKitchen: v.optional(v.boolean()),
  voidedBy: v.optional(v.id("users")),
  voidedAt: v.optional(v.number()),
  voidReason: v.optional(v.string()),
}).index("by_order", ["orderId"]),
```

- [ ] **Step 2: Run typecheck to verify schema compiles**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No errors related to orderItems schema.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add serviceType field to orderItems schema"
```

---

### Task 2: Update `addItem` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts:823-906`
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write failing tests for addItem with serviceType**

Add to `packages/backend/convex/orders.test.ts`:

```typescript
describe("orders — addItem serviceType", () => {
  it("should default serviceType to dine_in for dine-in orders", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    // Create a dine-in order
    const tableId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("tables", {
        storeId,
        name: "Table 1",
        status: "available",
        sortOrder: 1,
        isActive: true,
      });
    });

    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.create, {
      storeId,
      orderType: "dine_in",
      tableId,
      pax: 2,
    });

    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item?.serviceType).toBe("dine_in");
  });

  it("should default serviceType to takeout for takeout orders", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.create, {
      storeId,
      orderType: "takeout",
    });

    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item?.serviceType).toBe("takeout");
  });

  it("should accept explicit serviceType override", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const tableId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("tables", {
        storeId,
        name: "Table 1",
        status: "available",
        sortOrder: 1,
        isActive: true,
      });
    });

    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.create, {
      storeId,
      orderType: "dine_in",
      tableId,
      pax: 2,
    });

    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
      serviceType: "takeout",
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item?.serviceType).toBe("takeout");
  });

  it("should default serviceType from orderCategory for draft orders", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const { orderId } = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "test-req-1",
      orderCategory: "dine_in",
    });

    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item?.serviceType).toBe("dine_in");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | grep -E "serviceType|FAIL|PASS"`
Expected: All 4 new tests FAIL (serviceType will be undefined).

- [ ] **Step 3: Update addItem args validator and implementation**

In `packages/backend/convex/orders.ts`, find the `addItem` mutation (line ~823).

Add to the args object:
```typescript
serviceType: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
```

In the handler, after fetching the order (around line ~840), resolve the default service type:
```typescript
const resolvedServiceType =
  args.serviceType ??
  (order.orderCategory
    ? order.orderCategory === "dine_in" ? "dine_in" : "takeout"
    : order.orderType === "dine_in" ? "dine_in" : "takeout");
```

In the `ctx.db.insert("orderItems", { ... })` call (around line ~870), add `serviceType: resolvedServiceType` to the inserted object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | grep -E "serviceType|FAIL|PASS"`
Expected: All 4 new tests PASS. No existing tests broken.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat(backend): add serviceType support to addItem mutation"
```

---

### Task 3: Update `createAndSendToKitchen` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts:1499-1648`
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/backend/convex/orders.test.ts`:

```typescript
describe("orders — createAndSendToKitchen serviceType", () => {
  it("should default serviceType to dine_in and accept per-item override", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const tableId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("tables", {
        storeId,
        name: "Table 1",
        status: "available",
        sortOrder: 1,
        isActive: true,
      });
    });

    const authed = t.withIdentity({ subject: userId });
    const result = await authed.mutation(api.orders.createAndSendToKitchen, {
      storeId,
      tableId,
      pax: 2,
      items: [
        { productId, quantity: 1 },
        { productId, quantity: 1, serviceType: "takeout" },
      ],
    });

    const items = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", result.orderId))
        .collect();
    });

    expect(items[0].serviceType).toBe("dine_in");
    expect(items[1].serviceType).toBe("takeout");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | grep -E "createAndSendToKitchen serviceType|FAIL|PASS"`
Expected: FAIL

- [ ] **Step 3: Update createAndSendToKitchen args and implementation**

In `packages/backend/convex/orders.ts`, find `createAndSendToKitchen` (line ~1499).

Add `serviceType` to the items array validator in args:
```typescript
items: v.array(
  v.object({
    productId: v.id("products"),
    quantity: v.number(),
    notes: v.optional(v.string()),
    customPrice: v.optional(v.number()),
    serviceType: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
    modifiers: v.optional(
      v.array(
        v.object({
          modifierGroupName: v.string(),
          modifierOptionName: v.string(),
          priceAdjustment: v.number(),
        }),
      ),
    ),
  }),
),
```

In the item insertion loop (around line ~1616), resolve serviceType for each item:
```typescript
const itemServiceType = item.serviceType ?? "dine_in"; // createAndSendToKitchen is always for dine-in table orders
```

Add `serviceType: itemServiceType` to the `ctx.db.insert("orderItems", { ... })` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | grep -E "createAndSendToKitchen serviceType|FAIL|PASS"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat(backend): add serviceType support to createAndSendToKitchen"
```

---

### Task 4: Add `updateItemServiceType` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts`
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/backend/convex/orders.test.ts`:

```typescript
describe("orders — updateItemServiceType", () => {
  it("should update serviceType on unsent item", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const tableId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("tables", {
        storeId,
        name: "Table 1",
        status: "available",
        sortOrder: 1,
        isActive: true,
      });
    });

    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.create, {
      storeId,
      orderType: "dine_in",
      tableId,
      pax: 2,
    });

    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
    });

    await authed.mutation(api.orders.updateItemServiceType, {
      orderItemId: itemId,
      serviceType: "takeout",
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item?.serviceType).toBe("takeout");
  });

  it("should throw when updating serviceType on kitchen-sent item", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const tableId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("tables", {
        storeId,
        name: "Table 1",
        status: "available",
        sortOrder: 1,
        isActive: true,
      });
    });

    const authed = t.withIdentity({ subject: userId });
    const result = await authed.mutation(api.orders.createAndSendToKitchen, {
      storeId,
      tableId,
      pax: 2,
      items: [{ productId, quantity: 1 }],
    });

    const sentItemId = result.sentItemIds[0];

    await expect(
      authed.mutation(api.orders.updateItemServiceType, {
        orderItemId: sentItemId,
        serviceType: "takeout",
      }),
    ).rejects.toThrow("Cannot modify service type of kitchen-sent items");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | grep -E "updateItemServiceType|FAIL|PASS"`
Expected: FAIL (mutation doesn't exist yet)

- [ ] **Step 3: Implement updateItemServiceType mutation**

Add to `packages/backend/convex/orders.ts` (near the other item update mutations around line ~948):

```typescript
export const updateItemServiceType = mutation({
  args: {
    orderItemId: v.id("orderItems"),
    serviceType: v.union(v.literal("dine_in"), v.literal("takeout")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.orderItemId);
    if (!item) throw new Error("Order item not found");

    if (item.isSentToKitchen) {
      throw new Error("Cannot modify service type of kitchen-sent items");
    }

    await ctx.db.patch(args.orderItemId, { serviceType: args.serviceType });
    return null;
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | grep -E "updateItemServiceType|FAIL|PASS"`
Expected: Both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat(backend): add updateItemServiceType mutation with isSentToKitchen guard"
```

---

### Task 5: Add `bulkUpdateItemServiceType` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts`
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/backend/convex/orders.test.ts`:

```typescript
describe("orders — bulkUpdateItemServiceType", () => {
  it("should update serviceType on all unsent items, skip sent items", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const { orderId } = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "test-bulk-1",
      orderCategory: "takeout",
    });

    // Add two items (both default to "takeout")
    const item1Id = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
    });
    const item2Id = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 2,
    });

    // Mark item1 as sent to kitchen
    await t.run(async (ctx: any) => {
      await ctx.db.patch(item1Id, { isSentToKitchen: true });
    });

    // Bulk update to dine_in
    await authed.mutation(api.orders.bulkUpdateItemServiceType, {
      orderId,
      serviceType: "dine_in",
    });

    const item1 = await t.run(async (ctx: any) => ctx.db.get(item1Id));
    const item2 = await t.run(async (ctx: any) => ctx.db.get(item2Id));

    expect(item1?.serviceType).toBe("takeout"); // unchanged — was sent to kitchen
    expect(item2?.serviceType).toBe("dine_in"); // updated
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | grep -E "bulkUpdateItemServiceType|FAIL|PASS"`
Expected: FAIL

- [ ] **Step 3: Implement bulkUpdateItemServiceType mutation**

Add to `packages/backend/convex/orders.ts` (after `updateItemServiceType`):

```typescript
export const bulkUpdateItemServiceType = mutation({
  args: {
    orderId: v.id("orders"),
    serviceType: v.union(v.literal("dine_in"), v.literal("takeout")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    for (const item of items) {
      if (!item.isSentToKitchen && !item.isVoided) {
        await ctx.db.patch(item._id, { serviceType: args.serviceType });
      }
    }
    return null;
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | grep -E "bulkUpdateItemServiceType|FAIL|PASS"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat(backend): add bulkUpdateItemServiceType mutation"
```

---

### Task 6: Update `get` query return validator

**Files:**
- Modify: `packages/backend/convex/orders.ts:379-610`

- [ ] **Step 1: Add serviceType to get query items return validator**

In `packages/backend/convex/orders.ts`, find the `get` query's return validator (around line ~379). In the `items` array object, add:

```typescript
serviceType: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
```

Add it after the `isSentToKitchen` field in the return validator's items object.

- [ ] **Step 2: Add serviceType to the items mapping in the handler**

In the handler where items are mapped for the return value, include `serviceType: item.serviceType` in the returned object.

- [ ] **Step 3: Run full test suite**

Run: `cd packages/backend && pnpm vitest run`
Expected: All tests pass, no validator errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat(backend): include serviceType in get query return validator"
```

---

## Chunk 2: Receipt Formatting

### Task 7: Update interfaces in escposFormatter.ts

**Files:**
- Modify: `apps/native/src/features/settings/services/escposFormatter.ts:4-19`

- [ ] **Step 1: Add serviceType to KitchenTicketItem interface**

In `escposFormatter.ts` line ~4, add `serviceType` to `KitchenTicketItem`:

```typescript
export interface KitchenTicketItem {
  name: string;
  quantity: number;
  notes?: string;
  modifiers?: { optionName: string; priceAdjustment: number }[];
  serviceType?: "dine_in" | "takeout";
}
```

- [ ] **Step 2: Add orderDefaultServiceType to KitchenTicketData interface**

In `escposFormatter.ts` line ~11, add to `KitchenTicketData`:

```typescript
export interface KitchenTicketData {
  orderNumber: string;
  orderType: "dine_in" | "take_out" | "delivery";
  orderCategory?: "dine_in" | "takeout";
  orderDefaultServiceType?: "dine_in" | "takeout";
  tableMarker?: string;
  customerName?: string;
  items: KitchenTicketItem[];
  timestamp: Date;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/settings/services/escposFormatter.ts
git commit -m "feat(native): update kitchen ticket interfaces with serviceType fields"
```

---

### Task 8: Update kitchen ticket printing with grouping

**Files:**
- Modify: `apps/native/src/features/settings/services/escposFormatter.ts:268-278`

- [ ] **Step 1: Replace the items loop in printKitchenTicketToThermal**

Find the items loop in `printKitchenTicketToThermal` (around line ~268). Replace it with grouping logic:

```typescript
// Determine if order has mixed service types
const itemsWithServiceType = data.items.map((item) => ({
  ...item,
  resolvedServiceType: item.serviceType ?? data.orderDefaultServiceType ?? (data.orderType === "dine_in" ? "dine_in" : "takeout"),
}));

const serviceTypes = new Set(itemsWithServiceType.map((i) => i.resolvedServiceType));
const isMixed = serviceTypes.size > 1;

if (isMixed) {
  // Group: DINE IN first, then TAKEOUT
  for (const groupType of ["dine_in", "takeout"] as const) {
    const groupItems = itemsWithServiceType.filter((i) => i.resolvedServiceType === groupType);
    if (groupItems.length === 0) continue;

    const label = groupType === "dine_in" ? "DINE IN" : "TAKEOUT";
    await p.printText(`---- ${label} ----\n`, bold());

    for (const item of groupItems) {
      await p.printText(`  ${item.quantity}x ${item.name}\n`, bold());
      if (item.modifiers && item.modifiers.length > 0) {
        for (const mod of item.modifiers) {
          await p.printText(`     > ${mod.optionName}\n`, normal());
        }
      }
      if (item.notes) {
        await p.printText(`     * ${item.notes}\n`, normal());
      }
    }
    await p.printText("\n", normal());
  }
} else {
  // Uniform order — print as before
  for (const item of data.items) {
    await p.printText(`  ${item.quantity}x ${item.name}\n`, bold());
    if (item.modifiers && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        await p.printText(`     > ${mod.optionName}\n`, normal());
      }
    }
    if (item.notes) {
      await p.printText(`     * ${item.notes}\n`, normal());
    }
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/native && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/settings/services/escposFormatter.ts
git commit -m "feat(native): group kitchen ticket items by service type for mixed orders"
```

---

### Task 9: Update ReceiptItem interface and customer receipt tagging

**Files:**
- Modify: `apps/native/src/features/shared/utils/receipt.ts:4-10`
- Modify: `apps/native/src/features/settings/services/escposFormatter.ts:112-126`

- [ ] **Step 1: Add serviceType to ReceiptItem interface**

In `receipt.ts` line ~4:

```typescript
export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
  modifiers?: { optionName: string; priceAdjustment: number }[];
  serviceType?: "dine_in" | "takeout";
}
```

- [ ] **Step 2: Add orderDefaultServiceType to ReceiptData interface**

In `receipt.ts`, find the `ReceiptData` interface (line ~20). Add after the `orderCategory` field:

```typescript
orderDefaultServiceType?: "dine_in" | "takeout";
```

- [ ] **Step 3: Update printReceiptToThermal items loop for exception tagging**

In `escposFormatter.ts`, find the items loop (around line ~112). Update the item name printing to append a tag for exception items:

Replace:
```typescript
await p.printText(`${item.name}\n`, normal());
```

With:
```typescript
// Determine if this item is an exception (different from order default)
const orderDefault = data.orderDefaultServiceType ??
  (data.orderCategory
    ? data.orderCategory === "dine_in" ? "dine_in" : "takeout"
    : data.orderType === "dine_in" ? "dine_in" : "takeout");
const itemServiceType = item.serviceType ?? orderDefault;
const isException = itemServiceType !== orderDefault;
const tag = isException ? (itemServiceType === "takeout" ? " (TAKEOUT)" : " (DINE IN)") : "";
await p.printText(`${item.name}${tag}\n`, normal());
```

Note: `item` here refers to the `ReceiptItem` — you need to verify the variable name used in the existing loop. The loop iterates `data.items` and each item has the `ReceiptItem` shape.

- [ ] **Step 4: Update generateReceiptHtml items section for exception tagging**

In `receipt.ts`, find the `generateReceiptHtml` function's items section (around line ~101). Apply the same exception tagging logic to the HTML output. Where the item name is rendered, append the tag:

```typescript
const orderDefault = data.orderDefaultServiceType ??
  (data.orderCategory
    ? data.orderCategory === "dine_in" ? "dine_in" : "takeout"
    : data.orderType === "dine_in" ? "dine_in" : "takeout");
```

Then for each item in the `.map()`:
```typescript
const itemServiceType = item.serviceType ?? orderDefault;
const isException = itemServiceType !== orderDefault;
const tag = isException ? (itemServiceType === "takeout" ? " (TAKEOUT)" : " (DINE IN)") : "";
// Use `${item.name}${tag}` where item.name is currently rendered
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd apps/native && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/shared/utils/receipt.ts apps/native/src/features/settings/services/escposFormatter.ts
git commit -m "feat(native): add service type exception tagging to customer receipts"
```

---

## Chunk 3: Native App UI

### Task 10: Add serviceType toggle to CartItem component

**Files:**
- Modify: `apps/native/src/features/orders/components/CartItem.tsx`

- [ ] **Step 1: Update CartItemProps interface**

Add new props to the `CartItemProps` interface in `CartItem.tsx` (line ~14):

```typescript
interface CartItemProps {
  id: Id<"orderItems">;
  productName: string;
  productPrice: number;
  quantity: number;
  lineTotal: number;
  notes?: string;
  modifiers?: CartItemModifier[];
  isSentToKitchen: boolean;
  serviceType?: "dine_in" | "takeout";
  orderDefaultServiceType?: "dine_in" | "takeout";
  onServiceTypeChange?: (id: Id<"orderItems">, serviceType: "dine_in" | "takeout") => void;
  onIncrement: (id: Id<"orderItems">, currentQty: number) => void;
  onDecrement: (id: Id<"orderItems">, currentQty: number) => void;
  onVoidItem?: (id: Id<"orderItems">) => void;
}
```

- [ ] **Step 2: Add segmented control UI**

In the component body, destructure the new props:
```typescript
serviceType,
orderDefaultServiceType,
onServiceTypeChange,
```

Compute derived state:
```typescript
const currentServiceType = serviceType ?? orderDefaultServiceType ?? "dine_in";
const isOverridden = orderDefaultServiceType ? currentServiceType !== orderDefaultServiceType : false;
```

Add the segmented control in the top section of the cart item, inside the `XStack` that contains the product name and price (line ~50). Place it between the name/price YStack and the lineTotal Text. Replace the outer `XStack` wrapper to include the toggle:

After the product name `XStack` (line ~52-64) and before the lineTotal `Text` (line ~87), add:

```tsx
{/* Service Type Toggle */}
<XStack
  borderRadius={8}
  overflow="hidden"
  borderWidth={1}
  borderColor="#E5E7EB"
>
  <TouchableOpacity
    onPress={() => !isSentToKitchen && onServiceTypeChange?.(id, "dine_in")}
    disabled={isSentToKitchen}
    activeOpacity={0.7}
    style={{
      paddingVertical: 5,
      paddingHorizontal: 8,
      backgroundColor: isSentToKitchen
        ? "#F3F4F6"
        : currentServiceType === "dine_in"
          ? isOverridden ? "#FEF3C7" : "#DBEAFE"
          : "white",
    }}
  >
    <Text style={{
      fontSize: 9,
      fontWeight: "600",
      letterSpacing: 0.3,
      color: isSentToKitchen
        ? "#9CA3AF"
        : currentServiceType === "dine_in"
          ? isOverridden ? "#D97706" : "#0D87E1"
          : "#9CA3AF",
    }}>
      DINE IN
    </Text>
  </TouchableOpacity>
  <TouchableOpacity
    onPress={() => !isSentToKitchen && onServiceTypeChange?.(id, "takeout")}
    disabled={isSentToKitchen}
    activeOpacity={0.7}
    style={{
      paddingVertical: 5,
      paddingHorizontal: 8,
      borderLeftWidth: 1,
      borderLeftColor: "#E5E7EB",
      backgroundColor: isSentToKitchen
        ? "#F3F4F6"
        : currentServiceType === "takeout"
          ? isOverridden ? "#FEF3C7" : "#DBEAFE"
          : "white",
    }}
  >
    <Text style={{
      fontSize: 9,
      fontWeight: "600",
      letterSpacing: 0.3,
      color: isSentToKitchen
        ? "#9CA3AF"
        : currentServiceType === "takeout"
          ? isOverridden ? "#D97706" : "#0D87E1"
          : "#9CA3AF",
    }}>
      TAKEOUT
    </Text>
  </TouchableOpacity>
</XStack>
```

- [ ] **Step 3: Add override visual cues to the row wrapper**

Update the outer `YStack` (line ~44) to show amber tint when overridden:

```tsx
<YStack
  paddingHorizontal={12}
  paddingVertical={12}
  borderBottomWidth={1}
  borderBottomColor="#F3F4F6"
  backgroundColor={isOverridden ? "#FFFBEB" : "transparent"}
  borderLeftWidth={isOverridden ? 3 : 0}
  borderLeftColor={isOverridden ? "#F59E0B" : "transparent"}
>
```

Add a hint text after the notes section (after line ~84) when overridden and not sent to kitchen:

```tsx
{isOverridden && !isSentToKitchen && (
  <Text style={{ color: "#D97706", fontSize: 11, marginTop: 4, fontWeight: "500" }}>
    {currentServiceType === "takeout" ? "Packed for takeout" : "Dine-in override"}
  </Text>
)}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd apps/native && npx tsc --noEmit`
Expected: No type errors. (Callers will show errors — that's expected, fixed in next tasks.)

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/orders/components/CartItem.tsx
git commit -m "feat(native): add DINE IN / TAKEOUT segmented control to CartItem"
```

---

### Task 11: Wire serviceType into OrderScreen

**Files:**
- Modify: `apps/native/src/features/orders/screens/OrderScreen.tsx`

- [ ] **Step 1: Add updateItemServiceType mutation**

Near the existing mutation declarations (around line ~137), add:

```typescript
const updateItemServiceType = useMutation(api.orders.updateItemServiceType);
```

- [ ] **Step 2: Add handler function**

Add a handler near the other item handlers:

```typescript
const handleServiceTypeChange = useCallback(
  async (itemId: Id<"orderItems">, serviceType: "dine_in" | "takeout") => {
    try {
      await updateItemServiceType({ orderItemId: itemId, serviceType });
    } catch (error) {
      console.error("Failed to update service type:", error);
    }
  },
  [updateItemServiceType],
);
```

- [ ] **Step 3: Pass new props to CartItem in the FlatList**

Find the FlatList renderItem where CartItem is used (around line ~798-817). Add these props:

```tsx
serviceType={item.serviceType}
orderDefaultServiceType="dine_in"
onServiceTypeChange={handleServiceTypeChange}
```

Note: For dine-in OrderScreen, the default is always `"dine_in"`.

- [ ] **Step 4: Verify typecheck passes**

Run: `cd apps/native && npx tsc --noEmit`
Expected: No type errors for OrderScreen.

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/orders/screens/OrderScreen.tsx
git commit -m "feat(native): wire serviceType toggle into dine-in OrderScreen"
```

---

### Task 12: Wire serviceType into TakeoutOrderScreen

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx`

- [ ] **Step 1: Add mutations**

Near the existing mutation declarations (around line ~88), add:

```typescript
const updateItemServiceType = useMutation(api.orders.updateItemServiceType);
const bulkUpdateItemServiceType = useMutation(api.orders.bulkUpdateItemServiceType);
```

- [ ] **Step 2: Add service type change handler**

```typescript
const handleServiceTypeChange = useCallback(
  async (itemId: Id<"orderItems">, serviceType: "dine_in" | "takeout") => {
    try {
      await updateItemServiceType({ orderItemId: itemId, serviceType });
    } catch (error) {
      console.error("Failed to update service type:", error);
    }
  },
  [updateItemServiceType],
);
```

- [ ] **Step 3: Call bulkUpdateItemServiceType when orderCategory toggles**

Find where `orderCategory` is toggled (around lines ~452-503). After the existing `setOrderCategory` call and the `updateCustomerNameMutation`, add:

```typescript
if (draftOrderId) {
  await bulkUpdateItemServiceType({ orderId: draftOrderId, serviceType: newCategory });
}
```

This ensures all unsent items sync when the user toggles the order-level category.

- [ ] **Step 4: Pass new props to CartItem in the FlatList**

Find the FlatList renderItem (around line ~624-641). Add:

```tsx
serviceType={item.serviceType}
orderDefaultServiceType={orderCategory}
onServiceTypeChange={handleServiceTypeChange}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd apps/native && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx
git commit -m "feat(native): wire serviceType toggle into TakeoutOrderScreen with bulk update"
```

---

### Task 13: Pass serviceType into checkout receipt/kitchen data

**Files:**
- Modify: `apps/native/src/features/checkout/screens/CheckoutScreen.tsx:341-351, 480-497`

- [ ] **Step 1: Update createReceiptData items mapping**

Find `createReceiptData` (around line ~341). In the items map, add `serviceType`:

```typescript
items: activeItems.map((item) => ({
  name: item.productName,
  quantity: item.quantity,
  price: item.productPrice,
  total: item.lineTotal,
  serviceType: item.serviceType,
  modifiers: item.modifiers?.map((m) => ({
    optionName: m.optionName,
    priceAdjustment: m.priceAdjustment,
  })),
})),
```

Also add `orderDefaultServiceType` to the receipt data object:

```typescript
orderDefaultServiceType: order?.orderCategory
  ? (order.orderCategory === "dine_in" ? "dine_in" : "takeout")
  : (order?.orderType === "dine_in" ? "dine_in" : "takeout"),
```

- [ ] **Step 2: Update kitchenData items mapping**

Find the kitchen data building (around line ~480). Add `serviceType` to each item and `orderDefaultServiceType` to the data:

```typescript
const kitchenData: KitchenTicketData = {
  orderNumber: order.orderNumber,
  orderType: isTakeout ? "take_out" : "dine_in",
  tableMarker: order.tableMarker,
  customerName: order.customerName,
  orderCategory: order.orderCategory,
  orderDefaultServiceType: isTakeout ? "takeout" : "dine_in",
  items: activeItems.map((i) => ({
    name: i.productName,
    quantity: i.quantity,
    notes: i.notes,
    serviceType: i.serviceType,
    modifiers: i.modifiers?.map((m) => ({
      optionName: m.optionName,
      priceAdjustment: m.priceAdjustment,
    })),
  })),
  timestamp: new Date(),
};
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/native && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/checkout/screens/CheckoutScreen.tsx
git commit -m "feat(native): pass serviceType into receipt and kitchen ticket data"
```

---

## Chunk 4: Web Admin & Cleanup

### Task 14: Show serviceType badge in web admin order detail

**Files:**
- Modify: `apps/web/src/app/(admin)/orders/page.tsx:394-425`

- [ ] **Step 1: Add exception badge to item display**

Find the items rendering section (around line ~394). After the item name display, add a conditional badge for exception items:

Determine the order's default service type from the order data. Then for each item, check if it's an exception:

```tsx
{(() => {
  const orderDefault = orderDetails.orderCategory
    ? orderDetails.orderCategory === "dine_in" ? "dine_in" : "takeout"
    : orderDetails.orderType === "dine_in" ? "dine_in" : "takeout";
  const itemType = item.serviceType ?? orderDefault;
  const isException = itemType !== orderDefault;
  if (!isException) return null;
  const label = itemType === "takeout" ? "TAKEOUT" : "DINE IN";
  return (
    <span className="ml-2 inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
      {label}
    </span>
  );
})()}
```

- [ ] **Step 2: Verify web build**

Run: `cd apps/web && pnpm lint`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(admin)/orders/page.tsx
git commit -m "feat(web): show service type badge on exception items in order detail"
```

---

### Task 15: Run full test suite and typecheck

**Files:** None (verification only)

- [ ] **Step 1: Run backend tests**

Run: `cd packages/backend && pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`
Expected: No type errors across all packages.

- [ ] **Step 3: Run lint**

Run: `pnpm check`
Expected: No lint or format issues.

- [ ] **Step 4: Fix any issues found, commit if needed**

If any issues are found, fix them and create a commit:
```bash
git commit -m "fix: resolve lint/type issues from serviceType implementation"
```
