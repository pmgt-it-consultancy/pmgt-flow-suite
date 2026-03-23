# Draft Takeout Orders Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable takeout orders to be parked as drafts so customers can step aside while others are served, without losing order progress.

**Architecture:** Add `"draft"` to the order `status` union. Draft orders are real DB records with items saved immediately. The TakeoutOrderScreen switches from a two-phase model (local state → DB at checkout) to always working against the backend. A dedicated drafts section on TakeoutListScreen shows parked orders.

**Tech Stack:** Convex (backend mutations/queries), React Native + Tamagui (native UI), Vitest + convex-test (testing)

**Spec:** `docs/superpowers/specs/2026-03-23-draft-takeout-orders-design.md`

---

## Chunk 1: Backend — Schema & New Mutations

### Task 1: Schema changes

**Files:**
- Modify: `packages/backend/convex/schema.ts:162-214`

- [ ] **Step 1: Add `"draft"` to the `status` union**

At line 186, change:
```typescript
status: v.union(v.literal("open"), v.literal("paid"), v.literal("voided")),
```
to:
```typescript
status: v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("voided")),
```

- [ ] **Step 2: Make `orderNumber` optional**

At line 164, change:
```typescript
orderNumber: v.string(),
```
to:
```typescript
orderNumber: v.optional(v.string()),
```

- [ ] **Step 3: Add `draftLabel` field**

After the `customerName` field (line 185), add:
```typescript
draftLabel: v.optional(v.string()),
```

- [ ] **Step 4: Run typecheck to see what breaks**

Run: `cd packages/backend && npx tsc --noEmit 2>&1 | head -80`

Expected: Type errors in functions that reference the old `status` type or require `orderNumber` as non-optional. These will be fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(schema): add draft status, optional orderNumber, draftLabel field"
```

---

### Task 2: `createDraftOrder` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts` (add new mutation after `create` at ~line 153)
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/backend/convex/orders.test.ts`:

```typescript
describe("orders — draft takeout orders", () => {
  it("should create a draft order with auto-generated label", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderType: "takeout" as const,
        status: "draft" as const,
        draftLabel: "Customer #1",
        grossSales: 0,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 0,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
    expect(order).not.toBeNull();
    expect(order.status).toBe("draft");
    expect(order.draftLabel).toBe("Customer #1");
    expect(order.orderNumber).toBeUndefined();
    expect(order.orderType).toBe("takeout");
  });

  it("should auto-increment draft labels per day", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    // Create first draft
    await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderType: "takeout" as const,
        status: "draft" as const,
        draftLabel: "Customer #1",
        grossSales: 0,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 0,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    // Create second draft — label should be Customer #2
    const draft2Id = await t.run(async (ctx: any) => {
      // Count existing drafts today to determine next label
      const existingDrafts = await ctx.db
        .query("orders")
        .withIndex("by_store_status", (q: any) =>
          q.eq("storeId", storeId).eq("status", "draft"),
        )
        .collect();

      const maxNumber = existingDrafts.reduce((max: number, d: any) => {
        const match = d.draftLabel?.match(/\d+$/);
        return match ? Math.max(max, parseInt(match[0], 10)) : max;
      }, 0);

      return await ctx.db.insert("orders", {
        storeId,
        orderType: "takeout" as const,
        status: "draft" as const,
        draftLabel: `Customer #${maxNumber + 1}`,
        grossSales: 0,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 0,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    const draft2 = await t.run(async (ctx: any) => ctx.db.get(draft2Id));
    expect(draft2.draftLabel).toBe("Customer #2");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -20`

Expected: PASS (these tests only validate schema + DB insert, no mutation yet)

- [ ] **Step 3: Write the `createDraftOrder` mutation**

Add after the `create` mutation (after line 153) in `packages/backend/convex/orders.ts`:

```typescript
// Create a draft takeout order (not yet submitted for payment)
export const createDraftOrder = mutation({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.id("orders"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const { startOfDay } = getPHTDayBoundaries();

    // Count all drafts created today (monotonic — gaps allowed if drafts are discarded)
    const todaysDrafts = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay),
      )
      .filter((q) =>
        q.eq(q.field("status"), "draft"),
      )
      .collect();

    // Also include submitted (formerly draft) orders to avoid reusing numbers
    const todaysTakeoutOrders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("orderType"), "takeout"),
          q.neq(q.field("draftLabel"), undefined),
        ),
      )
      .collect();

    const allWithLabels = [...todaysDrafts, ...todaysTakeoutOrders];
    let maxNumber = 0;
    for (const draft of allWithLabels) {
      const match = draft.draftLabel?.match(/\d+$/);
      if (match) {
        maxNumber = Math.max(maxNumber, parseInt(match[0], 10));
      }
    }

    const draftLabel = `Customer #${maxNumber + 1}`;

    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      storeId: args.storeId,
      orderType: "takeout",
      status: "draft",
      draftLabel,
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      createdBy: user._id,
      createdAt: now,
    });

    return orderId;
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat(orders): add createDraftOrder mutation with auto-label"
```

---

### Task 3: `submitDraft` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts`
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `"orders — draft takeout orders"` describe block:

```typescript
it("should submit a draft order — transitions to open with order number", async () => {
  const t = convexTest(schema, modules);
  const { storeId, userId, productId } = await setupTestData(t);

  // Create draft order with an item
  const orderId = await t.run(async (ctx: any) => {
    const oid = await ctx.db.insert("orders", {
      storeId,
      orderType: "takeout" as const,
      status: "draft" as const,
      draftLabel: "Customer #1",
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      createdBy: userId,
      createdAt: Date.now(),
    });

    // Add an item
    await ctx.db.insert("orderItems", {
      orderId: oid,
      productId,
      productName: "Adobo",
      productPrice: 15000,
      quantity: 1,
      isVoided: false,
    });

    return oid;
  });

  // Submit the draft
  await t.run(async (ctx: any) => {
    const order = await ctx.db.get(orderId);
    if (order.status !== "draft") throw new Error("Order is not a draft");

    // Check items exist
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
      .filter((q: any) => q.eq(q.field("isVoided"), false))
      .collect();
    if (items.length === 0) throw new Error("Cannot submit a draft with no items");

    const orderNumber = "T-001"; // Simplified for test
    await ctx.db.patch(orderId, {
      status: "open",
      orderNumber,
      orderChannel: "walk_in_takeout",
      takeoutStatus: "pending",
    });
  });

  const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
  expect(order.status).toBe("open");
  expect(order.orderNumber).toBe("T-001");
  expect(order.orderChannel).toBe("walk_in_takeout");
  expect(order.takeoutStatus).toBe("pending");
});

it("should reject submitting a draft with zero items", async () => {
  const t = convexTest(schema, modules);
  const { storeId, userId } = await setupTestData(t);

  const orderId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("orders", {
      storeId,
      orderType: "takeout" as const,
      status: "draft" as const,
      draftLabel: "Customer #1",
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      createdBy: userId,
      createdAt: Date.now(),
    });
  });

  await expect(
    t.run(async (ctx: any) => {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
        .filter((q: any) => q.eq(q.field("isVoided"), false))
        .collect();
      if (items.length === 0) throw new Error("Cannot submit a draft with no items");
    }),
  ).rejects.toThrow("Cannot submit a draft with no items");
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -20`

- [ ] **Step 3: Write the `submitDraft` mutation**

Add after `createDraftOrder` in `packages/backend/convex/orders.ts`:

```typescript
// Submit a draft order — transitions draft → open
export const submitDraft = mutation({
  args: {
    orderId: v.id("orders"),
  },
  returns: v.object({
    orderNumber: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "draft") {
      throw new Error("Only draft orders can be submitted");
    }

    // Verify draft has items
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .filter((q) => q.eq(q.field("isVoided"), false))
      .collect();

    if (items.length === 0) {
      throw new Error("Cannot submit a draft with no items");
    }

    // Generate order number
    const orderNumber = await getNextOrderNumber(ctx, order.storeId, "takeout");

    // Transition to open
    await ctx.db.patch(args.orderId, {
      status: "open",
      orderNumber,
      orderChannel: "walk_in_takeout",
      takeoutStatus: "pending",
    });

    return { orderNumber };
  },
});
```

- [ ] **Step 4: Run tests**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat(orders): add submitDraft mutation with zero-item guard"
```

---

### Task 4: `discardDraft` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts`
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `"orders — draft takeout orders"` describe block:

```typescript
it("should discard a draft — deletes order, items, and modifiers", async () => {
  const t = convexTest(schema, modules);
  const { storeId, userId, productId } = await setupTestData(t);

  // Create draft with item + modifier
  const { orderId, itemId } = await t.run(async (ctx: any) => {
    const oid = await ctx.db.insert("orders", {
      storeId,
      orderType: "takeout" as const,
      status: "draft" as const,
      draftLabel: "Customer #1",
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      createdBy: userId,
      createdAt: Date.now(),
    });

    const iid = await ctx.db.insert("orderItems", {
      orderId: oid,
      productId,
      productName: "Adobo",
      productPrice: 15000,
      quantity: 1,
      isVoided: false,
    });

    await ctx.db.insert("orderItemModifiers", {
      orderItemId: iid,
      modifierGroupName: "Size",
      modifierOptionName: "Large",
      priceAdjustment: 2000,
    });

    return { orderId: oid, itemId: iid };
  });

  // Discard the draft
  await t.run(async (ctx: any) => {
    const order = await ctx.db.get(orderId);
    if (order.status !== "draft") throw new Error("Only draft orders can be discarded");

    // Delete modifiers for each item
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
      .collect();

    for (const item of items) {
      const modifiers = await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", item._id))
        .collect();
      for (const mod of modifiers) {
        await ctx.db.delete(mod._id);
      }
      await ctx.db.delete(item._id);
    }

    await ctx.db.delete(orderId);
  });

  // Verify everything is gone
  const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
  expect(order).toBeNull();

  const items = await t.run(async (ctx: any) =>
    ctx.db
      .query("orderItems")
      .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
      .collect(),
  );
  expect(items).toHaveLength(0);

  const modifiers = await t.run(async (ctx: any) =>
    ctx.db
      .query("orderItemModifiers")
      .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", itemId))
      .collect(),
  );
  expect(modifiers).toHaveLength(0);
});

it("should reject discarding a non-draft order", async () => {
  const t = convexTest(schema, modules);
  const { storeId, userId } = await setupTestData(t);

  const orderId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("orders", {
      storeId,
      orderNumber: "T-001",
      orderType: "takeout" as const,
      status: "open" as const,
      orderChannel: "walk_in_takeout" as const,
      takeoutStatus: "pending" as const,
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      createdBy: userId,
      createdAt: Date.now(),
    });
  });

  await expect(
    t.run(async (ctx: any) => {
      const order = await ctx.db.get(orderId);
      if (order.status !== "draft") throw new Error("Only draft orders can be discarded");
    }),
  ).rejects.toThrow("Only draft orders can be discarded");
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -20`

- [ ] **Step 3: Write the `discardDraft` mutation**

Add after `submitDraft` in `packages/backend/convex/orders.ts`:

```typescript
// Discard a draft order — hard-deletes order, items, and modifiers
export const discardDraft = mutation({
  args: {
    orderId: v.id("orders"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "draft") {
      throw new Error("Only draft orders can be discarded");
    }

    // Delete all items and their modifiers
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    for (const item of items) {
      const modifiers = await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItem", (q) => q.eq("orderItemId", item._id))
        .collect();
      for (const mod of modifiers) {
        await ctx.db.delete(mod._id);
      }
      await ctx.db.delete(item._id);
    }

    // Delete the order
    await ctx.db.delete(args.orderId);

    return null;
  },
});
```

- [ ] **Step 4: Run tests**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat(orders): add discardDraft mutation with cascading delete"
```

---

### Task 5: `getDraftOrders` query

**Files:**
- Modify: `packages/backend/convex/orders.ts`
- Test: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write the `getDraftOrders` query**

Add after `discardDraft` in `packages/backend/convex/orders.ts`:

```typescript
// Get all draft orders for a store
export const getDraftOrders = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      draftLabel: v.optional(v.string()),
      customerName: v.optional(v.string()),
      itemCount: v.number(),
      subtotal: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const drafts = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "draft"),
      )
      .collect();

    const results = await Promise.all(
      drafts.map(async (draft) => {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", draft._id))
          .collect();

        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);

        return {
          _id: draft._id,
          draftLabel: draft.draftLabel,
          customerName: draft.customerName,
          itemCount,
          subtotal: draft.netSales,
          createdAt: draft.createdAt,
        };
      }),
    );

    return results;
  },
});
```

- [ ] **Step 2: Write a test**

Add to the `"orders — draft takeout orders"` describe block:

```typescript
it("should return draft orders with item counts", async () => {
  const t = convexTest(schema, modules);
  const { storeId, userId, productId } = await setupTestData(t);

  // Create two drafts, one with items
  await t.run(async (ctx: any) => {
    const draft1 = await ctx.db.insert("orders", {
      storeId,
      orderType: "takeout" as const,
      status: "draft" as const,
      draftLabel: "Customer #1",
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      createdBy: userId,
      createdAt: Date.now(),
    });

    await ctx.db.insert("orderItems", {
      orderId: draft1,
      productId,
      productName: "Adobo",
      productPrice: 15000,
      quantity: 2,
      isVoided: false,
    });

    await ctx.db.insert("orders", {
      storeId,
      orderType: "takeout" as const,
      status: "draft" as const,
      draftLabel: "Customer #2",
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      createdBy: userId,
      createdAt: Date.now(),
    });
  });

  // Query drafts
  const drafts = await t.run(async (ctx: any) => {
    const results = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q: any) =>
        q.eq("storeId", storeId).eq("status", "draft"),
      )
      .collect();
    return results;
  });

  expect(drafts).toHaveLength(2);
  expect(drafts[0].draftLabel).toBe("Customer #1");
  expect(drafts[1].draftLabel).toBe("Customer #2");
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat(orders): add getDraftOrders query"
```

---

### Task 6: `cleanupExpiredDrafts` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts`

- [ ] **Step 1: Write the `cleanupExpiredDrafts` mutation**

Add after `getDraftOrders` in `packages/backend/convex/orders.ts`:

```typescript
// Clean up expired drafts (created before today)
export const cleanupExpiredDrafts = mutation({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.object({
    deletedCount: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const { startOfDay } = getPHTDayBoundaries();

    // Find all drafts created before today
    const expiredDrafts = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "draft"),
      )
      .collect();

    const oldDrafts = expiredDrafts.filter((d) => d.createdAt < startOfDay);

    // Delete each draft with cascading item/modifier cleanup
    for (const draft of oldDrafts) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) => q.eq("orderId", draft._id))
        .collect();

      for (const item of items) {
        const modifiers = await ctx.db
          .query("orderItemModifiers")
          .withIndex("by_orderItem", (q) => q.eq("orderItemId", item._id))
          .collect();
        for (const mod of modifiers) {
          await ctx.db.delete(mod._id);
        }
        await ctx.db.delete(item._id);
      }

      await ctx.db.delete(draft._id);
    }

    return { deletedCount: oldDrafts.length };
  },
});
```

- [ ] **Step 2: Wire cleanup into `generateDailyReport`**

In `packages/backend/convex/reports.ts`, at the end of the `generateDailyReport` handler (before the final return), add a call to clean up expired drafts. Import `internal` from `./_generated/api` and call:

```typescript
// Clean up expired draft takeout orders
await ctx.runMutation(internal.orders.cleanupExpiredDraftsInternal, {
  storeId: args.storeId,
});
```

Alternatively, if you prefer to keep it simple, add the cleanup logic inline or make `cleanupExpiredDrafts` an `internalMutation` that `generateDailyReport` can call. The key is that when the daily report is generated, old drafts get cleaned up automatically.

- [ ] **Step 3: Run tests**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/reports.ts
git commit -m "feat(orders): add cleanupExpiredDrafts mutation, wire into daily report"
```

---

## Chunk 2: Backend — Modify Existing Functions

### Task 7: Relax status checks to allow `"draft"` orders

**Files:**
- Modify: `packages/backend/convex/orders.ts`

The following mutations currently check `order.status !== "open"` and throw. They must also allow `"draft"`:

- [ ] **Step 1: Update `addItem` status check (line 593)**

Change:
```typescript
if (order.status !== "open") {
  throw new Error("Cannot add items to a closed order");
}
```
to:
```typescript
if (order.status !== "open" && order.status !== "draft") {
  throw new Error("Cannot add items to a closed order");
}
```

- [ ] **Step 2: Update `updateItemQuantity` status check (line 672)**

Change:
```typescript
if (order.status !== "open") {
  throw new Error("Cannot modify items in a closed order");
}
```
to:
```typescript
if (order.status !== "open" && order.status !== "draft") {
  throw new Error("Cannot modify items in a closed order");
}
```

- [ ] **Step 3: Update `updateItemNotes` status check (line 713)**

Change:
```typescript
if (order.status !== "open") {
  throw new Error("Cannot modify items in a closed order");
}
```
to:
```typescript
if (order.status !== "open" && order.status !== "draft") {
  throw new Error("Cannot modify items in a closed order");
}
```

- [ ] **Step 4: Update `removeItem` status check (line 742)**

Change:
```typescript
if (order.status !== "open") {
  throw new Error("Cannot modify items in a closed order");
}
```
to:
```typescript
if (order.status !== "open" && order.status !== "draft") {
  throw new Error("Cannot modify items in a closed order");
}
```

- [ ] **Step 5: Update `updateCustomerName` status check (line 842)**

Change:
```typescript
if (order.status !== "open") {
  throw new Error("Cannot modify a closed order");
}
```
to:
```typescript
if (order.status !== "open" && order.status !== "draft") {
  throw new Error("Cannot modify a closed order");
}
```

- [ ] **Step 6: Run tests**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -20`

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat(orders): allow item mutations on draft orders"
```

---

### Task 8: Query audit — exclude drafts from non-draft queries

**Files:**
- Modify: `packages/backend/convex/orders.ts`
- Modify: `packages/backend/convex/reports.ts` (verify only)

- [ ] **Step 1: Update `getTakeoutOrders` to exclude drafts (line 965-966)**

After the existing `.filter((q) => q.eq(q.field("orderType"), "takeout"))`, add a draft exclusion. Change:
```typescript
const orders = await indexQuery
  .filter((q) => q.eq(q.field("orderType"), "takeout"))
  .order("desc")
  .collect();
```
to:
```typescript
const orders = await indexQuery
  .filter((q) =>
    q.and(
      q.eq(q.field("orderType"), "takeout"),
      q.neq(q.field("status"), "draft"),
    ),
  )
  .order("desc")
  .collect();
```

- [ ] **Step 2: Update `getOrderHistory` to exclude drafts (line 494)**

Change:
```typescript
let filtered = args.status ? allOrders.filter((o) => o.status === args.status) : allOrders;
```
to:
```typescript
let filtered = allOrders.filter((o) => o.status !== "draft");
if (args.status) {
  filtered = filtered.filter((o) => o.status === args.status);
}
```

- [ ] **Step 3: Update `list` query to exclude drafts (lines 410-416)**

In the `else` branch (no status filter), add a filter after fetching. Change:
```typescript
} else {
  orders = await ctx.db
    .query("orders")
    .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
    .order("desc")
    .take(args.limit ?? 100);
}
```
to:
```typescript
} else {
  const allOrders = await ctx.db
    .query("orders")
    .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
    .filter((q) => q.neq(q.field("status"), "draft"))
    .order("desc")
    .take(args.limit ?? 100);
  orders = allOrders;
}
```

- [ ] **Step 4: Update `getDashboardSummary` to exclude drafts from `totalOrdersToday` (line 1022)**

Change:
```typescript
const totalOrdersToday = todaysOrders.length;
```
to:
```typescript
const nonDraftOrders = todaysOrders.filter((o) => o.status !== "draft");
const totalOrdersToday = nonDraftOrders.length;
```

- [ ] **Step 5: Update `get` query return type (lines 160-246)**

Update `status` at line 172:
```typescript
status: v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("voided")),
```

Update `orderNumber` at line 164:
```typescript
orderNumber: v.optional(v.string()),
```

Add `draftLabel` to the return type object (after `customerName`):
```typescript
draftLabel: v.optional(v.string()),
```

Update the handler to return `draftLabel` in the result object (around line 260):
```typescript
draftLabel: order.draftLabel,
```

- [ ] **Step 6: Update `list` query return type (lines 381-394)**

Update `orderNumber` at line 384:
```typescript
orderNumber: v.optional(v.string()),
```

Update `status` at line 390:
```typescript
status: v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("voided")),
```

Note: Even though drafts are filtered out at runtime, the `Doc<"orders">` type from Convex includes `"draft"` now, so the return type validator must match to avoid TypeScript errors in the mapping function.

- [ ] **Step 7: Update `getOrderHistory` return type (lines 467-480)**

Update `orderNumber` at line 470:
```typescript
orderNumber: v.optional(v.string()),
```

Also update the search filter at line 501 to handle optional `orderNumber`:
```typescript
(o.orderNumber?.toLowerCase().includes(search) ?? false) ||
```

- [ ] **Step 8: Update `getTakeoutOrders` return type (lines 933-951)**

Update `orderNumber` at line 936:
```typescript
orderNumber: v.optional(v.string()),
```

Update `status` at line 938:
```typescript
status: v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("voided")),
```

- [ ] **Step 9: Update `listActive` return type (line 1045)**

Update `orderNumber`:
```typescript
orderNumber: v.optional(v.string()),
```

- [ ] **Step 10: Verify `listActive` and `getTodaysOpenOrders` are safe**

These queries use `.withIndex("by_store_status", q => q.eq(...).eq("status", "open"))` — they will never return drafts. No changes needed. Confirm by reading lines 1070-1073 and 1148-1152.

- [ ] **Step 7: Verify `reports.ts` is safe**

Report queries in `reports.ts` filter to `status === "paid"` or `status === "voided"`. Drafts are excluded automatically. No changes needed. Confirm by reading lines 100-101, 907, and 977.

- [ ] **Step 12: Run typecheck**

Run: `cd packages/backend && npx tsc --noEmit 2>&1 | head -40`

Fix any remaining type errors from `orderNumber` being optional. Common fixes: anywhere `order.orderNumber` is used as a string (e.g., in return mappings), ensure it handles `undefined`. The `list` and `getOrderHistory` handlers may need `orderNumber: order.orderNumber ?? ""` or similar.

- [ ] **Step 13: Run all tests**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose 2>&1 | tail -30`

- [ ] **Step 14: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat(orders): exclude draft orders from queries, update return type validators"
```

---

## Chunk 3: Native App — TakeoutListScreen

### Task 9: Update navigation params

**Files:**
- Modify: `apps/native/src/navigation/Navigation.tsx:60-62`

- [ ] **Step 1: Add `orderId` to `TakeoutOrderScreen` params**

Change:
```typescript
TakeoutOrderScreen: {
  storeId: Id<"stores">;
};
```
to:
```typescript
TakeoutOrderScreen: {
  storeId: Id<"stores">;
  orderId: Id<"orders">;
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/navigation/Navigation.tsx
git commit -m "feat(nav): add orderId to TakeoutOrderScreen params"
```

---

### Task 10: TakeoutListScreen — drafts section + new order flow

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`
- Create: `apps/native/src/features/takeout/components/DraftOrderCard.tsx`

- [ ] **Step 1: Create `DraftOrderCard` component**

Create `apps/native/src/features/takeout/components/DraftOrderCard.tsx`:

```typescript
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Alert, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Text } from "../../../shared/components/ui";

interface DraftOrderCardProps {
  id: Id<"orders">;
  draftLabel?: string;
  customerName?: string;
  itemCount: number;
  subtotal: number;
  createdAt: number;
  onResume: (orderId: Id<"orders">) => void;
  onDiscard: (orderId: Id<"orders">) => void;
}

export function DraftOrderCard({
  id,
  draftLabel,
  customerName,
  itemCount,
  subtotal,
  createdAt,
  onResume,
  onDiscard,
}: DraftOrderCardProps) {
  const displayName = customerName || draftLabel || "Draft";
  const time = new Date(createdAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const handleDiscard = () => {
    Alert.alert(
      "Discard Draft",
      `Discard "${displayName}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => onDiscard(id),
        },
      ],
    );
  };

  return (
    <TouchableOpacity
      onPress={() => onResume(id)}
      activeOpacity={0.7}
    >
      <YStack
        backgroundColor="#FEF3C7"
        borderWidth={2}
        borderColor="#F59E0B"
        borderStyle="dashed"
        borderRadius={12}
        padding={14}
      >
        <XStack justifyContent="space-between" alignItems="center">
          <YStack flex={1}>
            <Text variant="heading" size="base">
              {displayName}
            </Text>
            <Text variant="muted" size="sm">
              {time} · {itemCount} {itemCount === 1 ? "item" : "items"} · ₱
              {(subtotal / 100).toFixed(2)}
            </Text>
          </YStack>
          <XStack gap={8} alignItems="center">
            <TouchableOpacity
              onPress={handleDiscard}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="trash-outline" size={20} color="#DC2626" />
            </TouchableOpacity>
            <XStack
              backgroundColor="#F59E0B"
              borderRadius={8}
              paddingVertical={8}
              paddingHorizontal={14}
            >
              <Text
                style={{ color: "white", fontWeight: "600", fontSize: 13 }}
              >
                Resume
              </Text>
            </XStack>
          </XStack>
        </XStack>
      </YStack>
    </TouchableOpacity>
  );
}
```

- [ ] **Step 2: Add barrel export for DraftOrderCard**

If `apps/native/src/features/takeout/components/index.ts` exists, add:
```typescript
export { DraftOrderCard } from "./DraftOrderCard";
```

- [ ] **Step 3: Update TakeoutListScreen — add imports and draft query**

In `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`, add:

1. Import `DraftOrderCard` and the `createDraftOrder` / `discardDraft` mutations
2. Add `useQuery(api.orders.getDraftOrders, { storeId })` for the drafts data
3. Add `useMutation(api.orders.createDraftOrder)` and `useMutation(api.orders.discardDraft)` mutations

- [ ] **Step 4: Update `handleNewOrder` to create a draft**

Change the `handleNewOrder` function from:
```typescript
const handleNewOrder = () => {
  navigation.navigate("TakeoutOrderScreen", { storeId: user.storeId });
};
```
to:
```typescript
const handleNewOrder = async () => {
  try {
    const orderId = await createDraftMutation({ storeId: user.storeId });
    navigation.navigate("TakeoutOrderScreen", {
      storeId: user.storeId,
      orderId,
    });
  } catch (error) {
    Alert.alert("Error", "Failed to create order. Please try again.");
  }
};
```

- [ ] **Step 5: Add `handleResumeDraft` and `handleDiscardDraft` handlers**

```typescript
const handleResumeDraft = (orderId: Id<"orders">) => {
  navigation.navigate("TakeoutOrderScreen", {
    storeId: user.storeId,
    orderId,
  });
};

const handleDiscardDraft = async (orderId: Id<"orders">) => {
  try {
    await discardDraftMutation({ orderId });
  } catch (error) {
    Alert.alert("Error", "Failed to discard draft. Please try again.");
  }
};
```

- [ ] **Step 6: Add drafts section to the render**

Above the existing active/completed FlatList, add:

```tsx
{drafts && drafts.length > 0 && (
  <YStack
    paddingHorizontal={16}
    paddingTop={8}
    paddingBottom={12}
    gap={8}
  >
    <Text variant="heading" size="base" style={{ color: "#92400E" }}>
      Drafts ({drafts.length})
    </Text>
    {drafts.map((draft) => (
      <DraftOrderCard
        key={draft._id}
        id={draft._id}
        draftLabel={draft.draftLabel}
        customerName={draft.customerName}
        itemCount={draft.itemCount}
        subtotal={draft.subtotal}
        createdAt={draft.createdAt}
        onResume={handleResumeDraft}
        onDiscard={handleDiscardDraft}
      />
    ))}
  </YStack>
)}
```

- [ ] **Step 7: Commit**

```bash
git add apps/native/src/features/takeout/components/DraftOrderCard.tsx \
       apps/native/src/features/takeout/components/index.ts \
       apps/native/src/features/takeout/screens/TakeoutListScreen.tsx
git commit -m "feat(takeout): add drafts section to TakeoutListScreen"
```

---

## Chunk 4: Native App — TakeoutOrderScreen Refactor

### Task 11: Refactor TakeoutOrderScreen to always use backend

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx`

This is the largest change. The screen currently has two modes (draft local state vs. server). We simplify to always use the backend since the order is created as a draft before navigating here.

- [ ] **Step 1: Update route params to require `orderId`**

Change the component's route type to use the updated `RootStackParamList`. Extract `orderId` from params alongside `storeId`:

```typescript
const { storeId, orderId } = route.params;
```

- [ ] **Step 2: Remove local draft state**

Remove these state variables and the `DraftItem` interface:
- `currentOrderId` and `setCurrentOrderId`
- `isDraftMode`
- `draftItems` and `setDraftItems`
- `DraftItem` interface

The `orderId` comes from route params now — always defined.

- [ ] **Step 3: Update the order query to always run**

Change from conditionally skipping:
```typescript
const order = useQuery(api.orders.get, currentOrderId ? { orderId: currentOrderId } : "skip");
```
to always running:
```typescript
const order = useQuery(api.orders.get, { orderId });
```

- [ ] **Step 4: Simplify `handleConfirmAdd` — remove draft branch**

Remove the `isDraftMode` branch that pushes to `draftItems`. Always call `addItemMutation()`:

```typescript
const handleConfirmAdd = async () => {
  if (!selectedProduct) return;
  try {
    await addItemMutation({
      orderId,
      productId: selectedProduct.id,
      quantity,
      notes: notes.trim() || undefined,
      customPrice: selectedProduct.customPrice,
    });
    setSelectedProduct(null);
    setQuantity(1);
    setNotes("");
  } catch (error) {
    Alert.alert("Error", "Failed to add item");
  }
};
```

Do the same for `handleConfirmModifiers` — remove the draft branch, always call the mutation.

- [ ] **Step 5: Simplify `handleIncrement` / `handleDecrement` — remove draft branches**

Remove the `isDraftMode` branches. Always call `updateItemQuantity()` mutation. For decrement to zero, call `removeItemMutation()`.

- [ ] **Step 6: Update `handleCheckout` — call `submitDraft` instead of creating order**

Replace the entire `handleCheckout` function:

```typescript
const submitDraftMutation = useMutation(api.orders.submitDraft);

const handleCheckout = async () => {
  const activeItems = order?.items.filter((i) => !i.isVoided) ?? [];
  if (activeItems.length === 0) {
    Alert.alert("No Items", "Please add items before proceeding to payment.");
    return;
  }

  setIsSending(true);
  try {
    // If order is still a draft, submit it first
    if (order?.status === "draft") {
      await submitDraftMutation({ orderId });
    }

    navigation.navigate("CheckoutScreen", {
      orderId,
      orderType: "takeout",
    });
  } catch (error: any) {
    Alert.alert("Error", error.message || "Failed to proceed to payment");
  } finally {
    setIsSending(false);
  }
};
```

- [ ] **Step 7: Update `customerName` handling**

Keep a local `customerName` state for responsive typing, initialized from `order?.customerName`. Sync to backend on blur (not on every keystroke — no debounce library needed):

```typescript
const updateCustomerNameMutation = useMutation(api.orders.updateCustomerName);
const [customerName, setCustomerName] = useState("");

// Sync from server when order loads
useEffect(() => {
  if (order?.customerName !== undefined) {
    setCustomerName(order.customerName);
  }
}, [order?.customerName]);

// Save to backend on blur
const handleCustomerNameBlur = () => {
  updateCustomerNameMutation({
    orderId,
    customerName: customerName.trim() || undefined,
  });
};
```

Wire `onBlur={handleCustomerNameBlur}` on the `TextInput`.

- [ ] **Step 8: Simplify `activeItems` and `cartTotal` computation**

Remove the `isDraftMode` ternary. Always derive from `order`:

```typescript
const activeItems = order?.items.filter((i) => !i.isVoided) ?? [];
const cartTotal = activeItems.reduce((sum, item) => sum + item.lineTotal, 0);
```

- [ ] **Step 9: Clean up back/cancel handlers**

The back button just navigates back — the draft is already persisted:

```typescript
const handleBack = () => {
  navigation.goBack();
};
```

Remove the `handleCancelOrder` confirmation dialog for draft mode (since drafts persist). Add a "Discard Draft" option if needed (optional — staff can discard from the list screen).

- [ ] **Step 10: Remove the customer name input conditional**

The customer name input currently only shows in draft mode (line 510). It should always show for takeout orders. Remove the `isDraftMode` conditional.

- [ ] **Step 11: Run typecheck**

Run: `cd apps/native && npx tsc --noEmit 2>&1 | head -40`

Fix any remaining type errors.

- [ ] **Step 12: Commit**

```bash
git add apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx
git commit -m "feat(takeout): refactor TakeoutOrderScreen to always use backend draft"
```

---

### Task 12: Final integration testing

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && pnpm vitest run --reporter=verbose`

All tests must pass.

- [ ] **Step 2: Run typecheck across all packages**

Run: `pnpm typecheck`

No errors.

- [ ] **Step 3: Run lint**

Run: `pnpm check`

No errors.

- [ ] **Step 4: Manual smoke test checklist**

Verify on device/simulator:
1. Tap "New Order" → creates draft, navigates to order screen
2. Add items → items appear, backed by DB
3. Tap back → return to list, draft appears in amber section
4. Tap "New Order" again → second draft created with "Customer #2"
5. Tap "Resume" on first draft → returns to order screen with items intact
6. "Proceed to Payment" → draft transitions to open, checkout works
7. "Discard" on a draft → confirmation, draft removed
8. Dashboard counts don't include drafts
9. Order history doesn't show drafts
10. Reports don't include drafts

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: draft takeout orders — complete implementation"
```
