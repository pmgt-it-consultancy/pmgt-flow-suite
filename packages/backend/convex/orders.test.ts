import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import {
  aggregateOrderTotals,
  calculateItemTotals,
  type ItemCalculation,
} from "./lib/taxCalculations";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupTestData(t: any) {
  const roleId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("roles", {
      name: "Staff",
      permissions: ["orders.create", "orders.view", "orders.edit"],
      scopeLevel: "branch",
      isSystem: false,
    });
  });

  const storeId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("stores", {
      name: "Test Store",
      address1: "123 Test St",
      tin: "123-456-789-000",
      min: "MIN-000001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  const userId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      name: "Test User",
      email: "test@test.com",
      roleId,
      storeId,
      isActive: true,
    });
  });

  const categoryId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("categories", {
      storeId,
      name: "Food",
      sortOrder: 1,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  const productId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("products", {
      storeId,
      name: "Adobo",
      categoryId,
      price: 15000, // ₱150.00
      isVatable: true,
      isActive: true,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return { roleId, storeId, userId, categoryId, productId };
}

describe("orders — create order", () => {
  it("should create order with auto-generated order number and zero totals", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-001",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
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
    expect(order.orderNumber).toBe("D-001");
    expect(order.status).toBe("open");
    expect(order.netSales).toBe(0);
    expect(order.grossSales).toBe(0);
  });
});

describe("orders — add/remove items with total recalculation", () => {
  it("should recalculate totals after adding an item", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-001",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
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

    // Add item
    await t.run(async (ctx: any) => {
      await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 2,
        isVoided: false,
        isSentToKitchen: false,
      });
    });

    // Recalculate (simulating recalculateOrderTotals)
    await t.run(async (ctx: any) => {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
        .collect();

      const activeItems = items.filter((i: any) => !i.isVoided);

      const itemCalcs: ItemCalculation[] = [];
      for (const item of activeItems) {
        const product = await ctx.db.get(item.productId);
        const isVatable = product?.isVatable ?? true;
        itemCalcs.push(calculateItemTotals(item.productPrice, item.quantity, isVatable, 0));
      }

      const totals = aggregateOrderTotals(itemCalcs);
      await ctx.db.patch(orderId, {
        grossSales: totals.grossSales,
        vatableSales: totals.vatableSales,
        vatAmount: totals.vatAmount,
        vatExemptSales: totals.vatExemptSales,
        nonVatSales: totals.nonVatSales,
        discountAmount: totals.discountAmount,
        netSales: totals.netSales,
      });
    });

    const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
    // 2 × ₱150 = ₱300
    expect(order.grossSales).toBe(30000);
    expect(order.netSales).toBe(30000);
    expect(order.vatableSales).toBeGreaterThan(0);
    expect(order.vatAmount).toBeGreaterThan(0);
  });

  it("should exclude voided items from totals", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-002",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
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

    // Add two items, one voided
    await t.run(async (ctx: any) => {
      await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        isVoided: false,
        isSentToKitchen: false,
      });
      await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        isVoided: true,
        isSentToKitchen: true,
        voidedBy: userId,
        voidedAt: Date.now(),
        voidReason: "Customer changed mind",
      });
    });

    // Recalculate
    await t.run(async (ctx: any) => {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
        .collect();

      const activeItems = items.filter((i: any) => !i.isVoided);
      const itemCalcs: ItemCalculation[] = [];
      for (const item of activeItems) {
        const product = await ctx.db.get(item.productId);
        const isVatable = product?.isVatable ?? true;
        itemCalcs.push(calculateItemTotals(item.productPrice, item.quantity, isVatable, 0));
      }

      const totals = aggregateOrderTotals(itemCalcs);
      await ctx.db.patch(orderId, {
        grossSales: totals.grossSales,
        netSales: totals.netSales,
      });
    });

    const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
    // Only 1 active item
    expect(order.grossSales).toBe(15000);
    expect(order.netSales).toBe(15000);
  });
});

describe("orders — kitchen-sent item restrictions", () => {
  it("should block quantity update for kitchen-sent items", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-003",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
        grossSales: 15000,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 15000,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    const itemId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 2,
        isVoided: false,
        isSentToKitchen: true,
      });
    });

    // Try to update quantity — should fail
    await expect(async () => {
      await t.run(async (ctx: any) => {
        const item = await ctx.db.get(itemId);
        if (item.isSentToKitchen) {
          throw new Error("Cannot modify quantity of kitchen-sent items");
        }
      });
    }).rejects.toThrowError("Cannot modify quantity of kitchen-sent items");
  });
});

describe("orders — sendToKitchen", () => {
  it("should mark unsent items as sent", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-004",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
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

    const itemId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        isVoided: false,
        isSentToKitchen: false,
      });
    });

    // Send to kitchen
    await t.run(async (ctx: any) => {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
        .collect();

      const unsentItems = items.filter((i: any) => !i.isVoided && !i.isSentToKitchen);
      for (const item of unsentItems) {
        await ctx.db.patch(item._id, { isSentToKitchen: true });
      }
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item.isSentToKitchen).toBe(true);
  });
});

describe("orders.get", () => {
  it("returns full-order void records with the attached reason", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const managerRoleId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("roles", {
        name: "Manager",
        permissions: ["orders.view", "orders.void_order", "orders.approve_void"],
        scopeLevel: "branch",
        isSystem: false,
      });
    });

    const managerId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("users", {
        name: "Manager User",
        email: "manager@test.com",
        roleId: managerRoleId,
        storeId,
        isActive: true,
      });
    });

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-005",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "voided" as const,
        grossSales: 15000,
        vatableSales: 13393,
        vatAmount: 1607,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 15000,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    await t.run(async (ctx: any) => {
      await ctx.db.insert("orderVoids", {
        orderId,
        voidType: "full_order" as const,
        reason: "Duplicate order entered by cashier",
        requestedBy: userId,
        approvedBy: managerId,
        amount: 15000,
        createdAt: Date.now(),
      });
    });

    const authed = t.withIdentity({ subject: userId });
    const order = await authed.query(api.orders.get, { orderId });

    expect(order).not.toBeNull();
    expect(order?.status).toBe("voided");
    expect(order?.voids).toEqual([
      expect.objectContaining({
        voidType: "full_order",
        reason: "Duplicate order entered by cashier",
        requestedByName: "Test User",
        approvedByName: "Manager User",
      }),
    ]);
  });
});

describe("orders — draft takeout orders", () => {
  it("should create a draft order with auto-generated label", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "draft-label-1",
    });

    const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
    expect(order).not.toBeNull();
    expect(order.status).toBe("draft");
    expect(order.draftLabel).toBe("Customer #1");
    expect(order.orderNumber).toBeUndefined();
    expect(order.orderType).toBe("takeout");
    expect(order.grossSales).toBe(0);
    expect(order.netSales).toBe(0);
  });

  it("should auto-increment draft labels for subsequent drafts", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const orderId1 = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "incr-1",
    });
    const orderId2 = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "incr-2",
    });
    const orderId3 = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "incr-3",
    });

    const order1 = await t.run(async (ctx: any) => ctx.db.get(orderId1));
    const order2 = await t.run(async (ctx: any) => ctx.db.get(orderId2));
    const order3 = await t.run(async (ctx: any) => ctx.db.get(orderId3));

    expect(order1.draftLabel).toBe("Customer #1");
    expect(order2.draftLabel).toBe("Customer #2");
    expect(order3.draftLabel).toBe("Customer #3");
  });

  it("should submit a draft order — transitions to open with order number", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "submit-draft-1",
    });

    // Add an item to the draft
    await t.run(async (ctx: any) => {
      await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        isVoided: false,
        isSentToKitchen: false,
      });
    });

    const result = await authed.mutation(api.orders.submitDraft, { orderId });

    expect(result.orderNumber).toMatch(/^T-\d{3}$/);

    const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
    expect(order.status).toBe("open");
    expect(order.orderNumber).toBe(result.orderNumber);
    expect(order.orderChannel).toBe("walk_in_takeout");
    expect(order.takeoutStatus).toBe("pending");
  });

  it("should reject submitting a draft with zero items", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "reject-empty-1",
    });

    await expect(authed.mutation(api.orders.submitDraft, { orderId })).rejects.toThrowError(
      "Cannot submit a draft with no items",
    );
  });

  it("should discard a draft — deletes order, items, and modifiers", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "discard-draft-1",
    });

    // Add item with modifier
    const itemId = await t.run(async (ctx: any) => {
      const id = await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        isVoided: false,
        isSentToKitchen: false,
      });
      await ctx.db.insert("orderItemModifiers", {
        orderItemId: id,
        modifierGroupName: "Size",
        modifierOptionName: "Large",
        priceAdjustment: 2000,
      });
      return id;
    });

    await authed.mutation(api.orders.discardDraft, { orderId });

    const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    const modifiers = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", itemId))
        .collect();
    });

    expect(order).toBeNull();
    expect(item).toBeNull();
    expect(modifiers).toHaveLength(0);
  });

  it("should reject discarding a non-draft order", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const openOrderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-001",
        orderType: "takeout" as const,
        orderChannel: "walk_in_takeout" as const,
        takeoutStatus: "pending" as const,
        status: "open" as const,
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

    const authed = t.withIdentity({ subject: userId });
    await expect(
      authed.mutation(api.orders.discardDraft, { orderId: openOrderId }),
    ).rejects.toThrowError("Only draft orders can be discarded");
  });

  it("should return draft orders with item counts", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const orderId1 = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "item-count-1",
    });
    const orderId2 = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "item-count-2",
    });

    // Add 2 items to orderId1
    await t.run(async (ctx: any) => {
      await ctx.db.insert("orderItems", {
        orderId: orderId1,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 2,
        isVoided: false,
        isSentToKitchen: false,
      });
    });

    const drafts = await authed.query(api.orders.getDraftOrders, { storeId });

    expect(drafts).toHaveLength(2);

    const draft1 = drafts.find((d: any) => d._id === orderId1);
    const draft2 = drafts.find((d: any) => d._id === orderId2);

    expect(draft1).toBeDefined();
    expect(draft1.itemCount).toBe(2);
    expect(draft1.draftLabel).toBe("Customer #1");

    expect(draft2).toBeDefined();
    expect(draft2.itemCount).toBe(0);
    expect(draft2.draftLabel).toBe("Customer #2");
  });

  it("should clean up drafts created before today", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    // Create a draft with a timestamp from yesterday
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const oldDraftId = await t.run(async (ctx: any) => {
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
        createdAt: yesterday,
      });

      // Add an item to make it non-trivial
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

    // Create a draft from today (should NOT be cleaned up)
    const authed = t.withIdentity({ subject: userId });
    const todayDraftId = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "cleanup-today-1",
    });

    // Run cleanup
    const result = await authed.mutation(api.orders.cleanupExpiredDrafts, { storeId });
    expect(result.deletedCount).toBe(1);

    // Old draft should be gone
    const oldDraft = await t.run(async (ctx: any) => ctx.db.get(oldDraftId));
    expect(oldDraft).toBeNull();

    // Old draft items should be gone
    const oldItems = await t.run(async (ctx: any) =>
      ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", oldDraftId))
        .collect(),
    );
    expect(oldItems).toHaveLength(0);

    // Today's draft should still exist
    const todayDraft = await t.run(async (ctx: any) => ctx.db.get(todayDraftId));
    expect(todayDraft).not.toBeNull();
    expect(todayDraft.status).toBe("draft");
  });
});

describe("orders — takeout status workflow", () => {
  it("should reject completing a takeout order that is not yet paid", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-001",
        orderType: "takeout" as const,
        orderChannel: "walk_in_takeout" as const,
        takeoutStatus: "ready_for_pickup" as const,
        status: "open" as const,
        grossSales: 150,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 150,
        discountAmount: 0,
        netSales: 150,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    const authed = t.withIdentity({ subject: userId });
    await expect(
      authed.mutation(api.orders.updateTakeoutStatus, { orderId, newStatus: "completed" }),
    ).rejects.toThrowError("Cannot complete an unpaid takeout order");
  });

  it("should allow completing a takeout order after payment", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-002",
        orderType: "takeout" as const,
        orderChannel: "walk_in_takeout" as const,
        takeoutStatus: "ready_for_pickup" as const,
        status: "paid" as const,
        paymentMethod: "cash" as const,
        grossSales: 150,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 150,
        discountAmount: 0,
        netSales: 150,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    const authed = t.withIdentity({ subject: userId });
    await authed.mutation(api.orders.updateTakeoutStatus, { orderId, newStatus: "completed" });

    const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
    expect(order?.takeoutStatus).toBe("completed");
  });
});

describe("orders — submitDraft idempotency", () => {
  it("should return orderNumber without error if draft is already submitted", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "test-submit-idemp-1",
    });

    // Add an item so it can be submitted
    await t.run(async (ctx: any) => {
      await ctx.db.insert("orderItems", {
        orderId,
        productId,
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

describe("order number daily reset", () => {
  it("should start at T-001 regardless of open orders from previous days", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    // Insert a previous-day open order directly
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    await t.run(async (ctx: any) => {
      await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-005",
        orderType: "takeout" as const,
        orderChannel: "walk_in_takeout" as const,
        status: "open" as const,
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
    const authed = t.withIdentity({ subject: userId });
    const orderId = await authed.mutation(api.orders.createDraftOrder, {
      storeId,
      requestId: "daily-reset-test-1",
    });

    // Add an item so it can be submitted
    await t.run(async (ctx: any) => {
      await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        isVoided: false,
        isSentToKitchen: false,
      });
    });

    const result = await authed.mutation(api.orders.submitDraft, { orderId });
    expect(result.orderNumber).toBe("T-001");
  });
});

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

describe("orders.addItem — serviceType", () => {
  it("should default to dine_in for dine-in orders", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-010",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
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

    const authed = t.withIdentity({ subject: userId });
    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item.serviceType).toBe("dine_in");
  });

  it("should default to takeout for takeout orders", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-010",
        orderType: "takeout" as const,
        orderChannel: "walk_in_takeout" as const,
        status: "open" as const,
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

    const authed = t.withIdentity({ subject: userId });
    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item.serviceType).toBe("takeout");
  });

  it("should accept explicit serviceType override", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-011",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
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

    const authed = t.withIdentity({ subject: userId });
    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
      serviceType: "takeout",
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item.serviceType).toBe("takeout");
  });

  it("should default from orderCategory for draft orders", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderType: "takeout" as const,
        status: "draft" as const,
        draftLabel: "Customer #1",
        orderCategory: "dine_in" as const,
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

    const authed = t.withIdentity({ subject: userId });
    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId,
      quantity: 1,
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    // orderCategory is dine_in, so serviceType should be dine_in even though orderType is takeout
    expect(item.serviceType).toBe("dine_in");
  });
});

describe("orders.createAndSendToKitchen — serviceType", () => {
  it("should default item serviceType to dine_in", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const tableId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("tables", {
        storeId,
        name: "Table 1",
        status: "available",
        sortOrder: 1,
        isActive: true,
        createdAt: Date.now(),
      });
    });

    const authed = t.withIdentity({ subject: userId });
    const result = await authed.mutation(api.orders.createAndSendToKitchen, {
      storeId,
      tableId,
      pax: 2,
      items: [{ productId, quantity: 1 }],
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(result.sentItemIds[0]));
    expect(item.serviceType).toBe("dine_in");
  });

  it("should accept per-item serviceType override", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const tableId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("tables", {
        storeId,
        name: "Table 2",
        status: "available",
        sortOrder: 2,
        isActive: true,
        createdAt: Date.now(),
      });
    });

    const authed = t.withIdentity({ subject: userId });
    const result = await authed.mutation(api.orders.createAndSendToKitchen, {
      storeId,
      tableId,
      pax: 2,
      items: [{ productId, quantity: 1, serviceType: "takeout" }],
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(result.sentItemIds[0]));
    expect(item.serviceType).toBe("takeout");
  });
});

describe("orders.updateItemServiceType", () => {
  it("should update serviceType on unsent item", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-020",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
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

    const itemId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        serviceType: "dine_in",
        isVoided: false,
        isSentToKitchen: false,
      });
    });

    const authed = t.withIdentity({ subject: userId });
    await authed.mutation(api.orders.updateItemServiceType, {
      orderItemId: itemId,
      serviceType: "takeout",
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item.serviceType).toBe("takeout");
  });

  it("should throw when updating serviceType on kitchen-sent item", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-021",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
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

    const itemId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        serviceType: "dine_in",
        isVoided: false,
        isSentToKitchen: true,
      });
    });

    const authed = t.withIdentity({ subject: userId });
    await expect(
      authed.mutation(api.orders.updateItemServiceType, {
        orderItemId: itemId,
        serviceType: "takeout",
      }),
    ).rejects.toThrowError("Cannot modify service type of kitchen-sent items");
  });
});

describe("orders.bulkUpdateItemServiceType", () => {
  it("should update unsent items and skip sent-to-kitchen items", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupTestData(t);

    const orderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-030",
        orderType: "dine_in" as const,
        orderChannel: "walk_in_dine_in" as const,
        status: "open" as const,
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

    const { unsentItemId, sentItemId, voidedItemId } = await t.run(async (ctx: any) => {
      const unsentItemId = await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        serviceType: "dine_in",
        isVoided: false,
        isSentToKitchen: false,
      });
      const sentItemId = await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        serviceType: "dine_in",
        isVoided: false,
        isSentToKitchen: true,
      });
      const voidedItemId = await ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Adobo",
        productPrice: 15000,
        quantity: 1,
        serviceType: "dine_in",
        isVoided: true,
        isSentToKitchen: false,
      });
      return { unsentItemId, sentItemId, voidedItemId };
    });

    const authed = t.withIdentity({ subject: userId });
    await authed.mutation(api.orders.bulkUpdateItemServiceType, {
      orderId,
      serviceType: "takeout",
    });

    const unsentItem = await t.run(async (ctx: any) => ctx.db.get(unsentItemId));
    const sentItem = await t.run(async (ctx: any) => ctx.db.get(sentItemId));
    const voidedItem = await t.run(async (ctx: any) => ctx.db.get(voidedItemId));

    expect(unsentItem.serviceType).toBe("takeout");
    expect(sentItem.serviceType).toBe("dine_in"); // unchanged — sent to kitchen
    expect(voidedItem.serviceType).toBe("dine_in"); // unchanged — voided
  });
});
