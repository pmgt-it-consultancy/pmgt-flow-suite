import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupTestData(t: any) {
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

  const categoryId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("categories", {
      storeId,
      name: "Food",
      sortOrder: 1,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  const userId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      name: "Test User",
      email: "test-products@test.com",
      storeId,
      isActive: true,
    });
  });

  return { storeId, categoryId, userId };
}

describe("products — open price schema", () => {
  it("should create an open-price product with min/max", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId } = await setupTestData(t);

    const productId = await t.run(async (ctx: any) => {
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

    const product = await t.run(async (ctx: any) => ctx.db.get(productId));
    expect(product).not.toBeNull();
    expect(product.isOpenPrice).toBe(true);
    expect(product.minPrice).toBe(50);
    expect(product.maxPrice).toBe(500);
    expect(product.price).toBe(0);
  });

  it("should create a regular product without open price fields", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId } = await setupTestData(t);

    const productId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("products", {
        storeId,
        name: "Adobo",
        categoryId,
        price: 15000,
        isVatable: true,
        isActive: true,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const product = await t.run(async (ctx: any) => ctx.db.get(productId));
    expect(product).not.toBeNull();
    expect(product.isOpenPrice).toBeUndefined();
    expect(product.minPrice).toBeUndefined();
    expect(product.maxPrice).toBeUndefined();
    expect(product.price).toBe(15000);
  });
});

describe("products.list", () => {
  it("includes inactive products when includeInactive is true", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId, userId } = await setupTestData(t);

    await t.run(async (ctx: any) => {
      const now = Date.now();

      await ctx.db.insert("products", {
        storeId,
        name: "Active Product",
        categoryId,
        price: 100,
        isVatable: true,
        isActive: true,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("products", {
        storeId,
        name: "Inactive Product",
        categoryId,
        price: 200,
        isVatable: true,
        isActive: false,
        sortOrder: 2,
        createdAt: now,
        updatedAt: now,
      });
    });

    const authed = t.withIdentity({ subject: userId });

    const activeOnly = await authed.query(api.products.list, { storeId });
    expect(activeOnly.map((product) => product.name)).toEqual(["Active Product"]);

    const withInactive = await authed.query(api.products.list, {
      storeId,
      includeInactive: true,
    });
    expect(withInactive.map((product) => product.name)).toEqual([
      "Active Product",
      "Inactive Product",
    ]);
    expect(withInactive.map((product) => product.isActive)).toEqual([true, false]);
  });
});
