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

  const userId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      name: "Test User",
      email: "test-categories@test.com",
      storeId,
      isActive: true,
    });
  });

  return { storeId, userId };
}

async function insertCategory(
  t: any,
  storeId: any,
  overrides: Partial<{
    name: string;
    sortOrder: number;
    isActive: boolean;
    parentId: any;
  }>,
) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("categories", {
      storeId,
      name: overrides.name ?? "Category",
      parentId: overrides.parentId,
      sortOrder: overrides.sortOrder ?? 0,
      isActive: overrides.isActive ?? true,
      createdAt: Date.now(),
    });
  });
}

async function setupManagerUser(t: any, storeId: any) {
  const roleId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["categories.manage"],
      scopeLevel: "branch",
      isSystem: false,
    });
  });

  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      name: "Manager User",
      email: "manager-categories@test.com",
      roleId,
      storeId,
      isActive: true,
    });
  });
}

describe("categories.listPaginated", () => {
  it("returns pages ordered by sortOrder ascending", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    await insertCategory(t, storeId, { name: "Third", sortOrder: 3 });
    await insertCategory(t, storeId, { name: "First", sortOrder: 1 });
    await insertCategory(t, storeId, { name: "Second", sortOrder: 2 });

    const authed = t.withIdentity({ subject: userId });

    const firstPage = await authed.query(api.categories.listPaginated, {
      storeId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(firstPage.page.map((c: any) => c.name)).toEqual(["First", "Second"]);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await authed.query(api.categories.listPaginated, {
      storeId,
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });
    expect(secondPage.page.map((c: any) => c.name)).toEqual(["Third"]);
    expect(secondPage.isDone).toBe(true);
  });

  it("scopes pages to parentId and includeInactive filters", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const parentId = await insertCategory(t, storeId, {
      name: "Parent",
      sortOrder: 1,
    });
    await insertCategory(t, storeId, {
      name: "Active Child",
      sortOrder: 1,
      parentId,
    });
    await insertCategory(t, storeId, {
      name: "Inactive Child",
      sortOrder: 2,
      parentId,
      isActive: false,
    });
    await insertCategory(t, storeId, { name: "Other Root", sortOrder: 2 });

    const authed = t.withIdentity({ subject: userId });

    const activeChildren = await authed.query(api.categories.listPaginated, {
      storeId,
      parentId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(activeChildren.page.map((c: any) => c.name)).toEqual(["Active Child"]);

    const allChildren = await authed.query(api.categories.listPaginated, {
      storeId,
      parentId,
      includeInactive: true,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(allChildren.page.map((c: any) => c.name)).toEqual(["Active Child", "Inactive Child"]);
  });
});

describe("categories.moveSortOrder", () => {
  it("computes the midpoint sortOrder when moving between two neighbors", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await setupTestData(t);
    const managerId = await setupManagerUser(t, storeId);

    const categoryA = await insertCategory(t, storeId, {
      name: "A",
      sortOrder: 0,
    });
    const categoryB = await insertCategory(t, storeId, {
      name: "B",
      sortOrder: 10,
    });
    const categoryC = await insertCategory(t, storeId, {
      name: "C",
      sortOrder: 20,
    });

    const authed = t.withIdentity({ subject: managerId });
    await authed.mutation(api.categories.moveSortOrder, {
      categoryId: categoryC,
      beforeId: categoryA,
      afterId: categoryB,
    });

    const [a, b, c] = await t.run(async (ctx: any) => [
      await ctx.db.get(categoryA),
      await ctx.db.get(categoryB),
      await ctx.db.get(categoryC),
    ]);
    expect(c.sortOrder).toBe(5);
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(10);
  });

  it("moves to the start of the loaded list when only afterId is given", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await setupTestData(t);
    const managerId = await setupManagerUser(t, storeId);

    const categoryA = await insertCategory(t, storeId, {
      name: "A",
      sortOrder: 5,
    });
    const categoryB = await insertCategory(t, storeId, {
      name: "B",
      sortOrder: 10,
    });

    const authed = t.withIdentity({ subject: managerId });
    await authed.mutation(api.categories.moveSortOrder, {
      categoryId: categoryB,
      afterId: categoryA,
    });

    const b = await t.run(async (ctx: any) => ctx.db.get(categoryB));
    expect(b.sortOrder).toBe(4);
  });

  it("moves to the end of the loaded list when only beforeId is given", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await setupTestData(t);
    const managerId = await setupManagerUser(t, storeId);

    const categoryA = await insertCategory(t, storeId, {
      name: "A",
      sortOrder: 5,
    });
    const categoryB = await insertCategory(t, storeId, {
      name: "B",
      sortOrder: 10,
    });

    const authed = t.withIdentity({ subject: managerId });
    await authed.mutation(api.categories.moveSortOrder, {
      categoryId: categoryA,
      beforeId: categoryB,
    });

    const a = await t.run(async (ctx: any) => ctx.db.get(categoryA));
    expect(a.sortOrder).toBe(11);
  });

  it("rejects a user without categories.manage permission", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    const categoryA = await insertCategory(t, storeId, {
      name: "A",
      sortOrder: 0,
    });
    const categoryB = await insertCategory(t, storeId, {
      name: "B",
      sortOrder: 10,
    });

    const authed = t.withIdentity({ subject: userId });
    await expect(
      authed.mutation(api.categories.moveSortOrder, {
        categoryId: categoryB,
        afterId: categoryA,
      }),
    ).rejects.toThrow("Permission denied: categories.manage");
  });
});
