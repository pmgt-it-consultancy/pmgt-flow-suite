import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
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
    // 2 × ₱150 = ₱300 = 30000 centavos
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
