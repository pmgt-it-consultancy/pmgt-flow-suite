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

async function insertProduct(
  t: any,
  storeId: any,
  categoryId: any,
  overrides: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
) {
  return await t.run(async (ctx: any) => {
    const now = Date.now();
    return await ctx.db.insert("products", {
      storeId,
      name: overrides.name ?? "Product",
      categoryId,
      price: 100,
      isVatable: true,
      isActive: overrides.isActive ?? true,
      sortOrder: overrides.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function setupManagerUser(t: any, storeId: any) {
  const roleId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["products.manage"],
      scopeLevel: "branch",
      isSystem: false,
    });
  });

  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      name: "Manager User",
      email: "manager-products@test.com",
      roleId,
      storeId,
      isActive: true,
    });
  });
}

describe("products.listPaginated", () => {
  it("returns pages ordered by sortOrder ascending", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId, userId } = await setupTestData(t);

    await insertProduct(t, storeId, categoryId, {
      name: "Third",
      sortOrder: 3,
    });
    await insertProduct(t, storeId, categoryId, {
      name: "First",
      sortOrder: 1,
    });
    await insertProduct(t, storeId, categoryId, {
      name: "Second",
      sortOrder: 2,
    });

    const authed = t.withIdentity({ subject: userId });

    const firstPage = await authed.query(api.products.listPaginated, {
      storeId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(firstPage.page.map((p: any) => p.name)).toEqual(["First", "Second"]);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await authed.query(api.products.listPaginated, {
      storeId,
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });
    expect(secondPage.page.map((p: any) => p.name)).toEqual(["Third"]);
    expect(secondPage.isDone).toBe(true);
  });

  it("scopes pages to categoryId and includeInactive filters", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId, userId } = await setupTestData(t);

    const otherCategoryId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("categories", {
        storeId,
        name: "Drinks",
        sortOrder: 2,
        isActive: true,
        createdAt: Date.now(),
      });
    });

    await insertProduct(t, storeId, categoryId, {
      name: "Active In Category",
      sortOrder: 1,
    });
    await insertProduct(t, storeId, categoryId, {
      name: "Inactive In Category",
      sortOrder: 2,
      isActive: false,
    });
    await insertProduct(t, storeId, otherCategoryId, {
      name: "Other Category",
      sortOrder: 1,
    });

    const authed = t.withIdentity({ subject: userId });

    const activeInCategory = await authed.query(api.products.listPaginated, {
      storeId,
      categoryId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(activeInCategory.page.map((p: any) => p.name)).toEqual(["Active In Category"]);

    const allInCategory = await authed.query(api.products.listPaginated, {
      storeId,
      categoryId,
      includeInactive: true,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(allInCategory.page.map((p: any) => p.name)).toEqual([
      "Active In Category",
      "Inactive In Category",
    ]);
  });
});

describe("products.moveSortOrder", () => {
  it("computes the midpoint sortOrder when moving between two neighbors", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId } = await setupTestData(t);
    const managerId = await setupManagerUser(t, storeId);

    const productA = await insertProduct(t, storeId, categoryId, {
      name: "A",
      sortOrder: 0,
    });
    const productB = await insertProduct(t, storeId, categoryId, {
      name: "B",
      sortOrder: 10,
    });
    const productC = await insertProduct(t, storeId, categoryId, {
      name: "C",
      sortOrder: 20,
    });

    const authed = t.withIdentity({ subject: managerId });
    await authed.mutation(api.products.moveSortOrder, {
      productId: productC,
      beforeId: productA,
      afterId: productB,
    });

    const [a, b, c] = await t.run(async (ctx: any) => [
      await ctx.db.get(productA),
      await ctx.db.get(productB),
      await ctx.db.get(productC),
    ]);
    expect(c.sortOrder).toBe(5);
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(10);
  });

  it("moves to the start of the loaded list when only afterId is given", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId } = await setupTestData(t);
    const managerId = await setupManagerUser(t, storeId);

    const productA = await insertProduct(t, storeId, categoryId, {
      name: "A",
      sortOrder: 5,
    });
    const productB = await insertProduct(t, storeId, categoryId, {
      name: "B",
      sortOrder: 10,
    });

    const authed = t.withIdentity({ subject: managerId });
    await authed.mutation(api.products.moveSortOrder, {
      productId: productB,
      afterId: productA,
    });

    const b = await t.run(async (ctx: any) => ctx.db.get(productB));
    expect(b.sortOrder).toBe(4);
  });

  it("moves to the end of the loaded list when only beforeId is given", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId } = await setupTestData(t);
    const managerId = await setupManagerUser(t, storeId);

    const productA = await insertProduct(t, storeId, categoryId, {
      name: "A",
      sortOrder: 5,
    });
    const productB = await insertProduct(t, storeId, categoryId, {
      name: "B",
      sortOrder: 10,
    });

    const authed = t.withIdentity({ subject: managerId });
    await authed.mutation(api.products.moveSortOrder, {
      productId: productA,
      beforeId: productB,
    });

    const a = await t.run(async (ctx: any) => ctx.db.get(productA));
    expect(a.sortOrder).toBe(11);
  });

  it("rejects a user without products.manage permission", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId, userId } = await setupTestData(t);

    const productA = await insertProduct(t, storeId, categoryId, {
      name: "A",
      sortOrder: 0,
    });
    const productB = await insertProduct(t, storeId, categoryId, {
      name: "B",
      sortOrder: 10,
    });

    const authed = t.withIdentity({ subject: userId });
    await expect(
      authed.mutation(api.products.moveSortOrder, {
        productId: productB,
        afterId: productA,
      }),
    ).rejects.toThrow("Permission denied: products.manage");
  });
});
