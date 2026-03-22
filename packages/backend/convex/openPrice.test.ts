import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupOpenPriceTestData(t: any) {
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

  // Open price product
  const openPriceProductId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("products", {
      storeId,
      name: "Custom Cake",
      categoryId,
      price: 0,
      isVatable: true,
      isActive: true,
      isOpenPrice: true,
      minPrice: 50,
      maxPrice: 500,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Regular product
  const regularProductId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("products", {
      storeId,
      name: "Adobo",
      categoryId,
      price: 25,
      isVatable: true,
      isActive: true,
      sortOrder: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return { roleId, storeId, userId, categoryId, openPriceProductId, regularProductId };
}

async function createOpenOrder(t: any, storeId: any, userId: any) {
  return await t.run(async (ctx: any) => {
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
}

describe("orders — addItem with open price", () => {
  it("should add open-price item with valid customPrice", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, openPriceProductId } = await setupOpenPriceTestData(t);
    const orderId = await createOpenOrder(t, storeId, userId);

    const authed = t.withIdentity({ subject: userId });
    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId: openPriceProductId,
      quantity: 1,
      customPrice: 150,
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item).not.toBeNull();
    expect(item.productPrice).toBe(150);
    expect(item.productName).toBe("Custom Cake");
  });

  it("should reject open-price item without customPrice", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, openPriceProductId } = await setupOpenPriceTestData(t);
    const orderId = await createOpenOrder(t, storeId, userId);

    const authed = t.withIdentity({ subject: userId });
    await expect(
      authed.mutation(api.orders.addItem, {
        orderId,
        productId: openPriceProductId,
        quantity: 1,
      }),
    ).rejects.toThrowError("Custom price is required for open-price products");
  });

  it("should reject customPrice below minPrice", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, openPriceProductId } = await setupOpenPriceTestData(t);
    const orderId = await createOpenOrder(t, storeId, userId);

    const authed = t.withIdentity({ subject: userId });
    await expect(
      authed.mutation(api.orders.addItem, {
        orderId,
        productId: openPriceProductId,
        quantity: 1,
        customPrice: 10,
      }),
    ).rejects.toThrowError("Price must be between");
  });

  it("should reject customPrice above maxPrice", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, openPriceProductId } = await setupOpenPriceTestData(t);
    const orderId = await createOpenOrder(t, storeId, userId);

    const authed = t.withIdentity({ subject: userId });
    await expect(
      authed.mutation(api.orders.addItem, {
        orderId,
        productId: openPriceProductId,
        quantity: 1,
        customPrice: 999,
      }),
    ).rejects.toThrowError("Price must be between");
  });

  it("should ignore customPrice for regular products", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, regularProductId } = await setupOpenPriceTestData(t);
    const orderId = await createOpenOrder(t, storeId, userId);

    const authed = t.withIdentity({ subject: userId });
    const itemId = await authed.mutation(api.orders.addItem, {
      orderId,
      productId: regularProductId,
      quantity: 1,
      customPrice: 999,
    });

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(item).not.toBeNull();
    expect(item.productPrice).toBe(25);
  });
});
