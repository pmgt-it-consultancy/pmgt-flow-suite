import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

it("creates an additive restaurant catalog once and makes its modifier options syncable", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://aromatic-dalmatian-30.convex.site");
  const t = convexTest(schema, modules);
  const storeId = await t.run((ctx) =>
    ctx.db.insert("stores", {
      name: "Test Store A",
      address1: "Test",
      tin: "SIM",
      min: "SIM",
      vatRate: 12,
      isActive: true,
      createdAt: 1,
    }),
  );
  expect(await t.mutation(internal.restaurantSimulation.seedCatalog, { storeId })).toEqual({
    categories: 20,
    groups: 20,
    options: 80,
    products: 500,
    tables: 80,
  });
  const preserved = await t.run(async (ctx) => {
    const product = await ctx.db
      .query("products")
      .withIndex("by_store", (q) => q.eq("storeId", storeId))
      .first();
    if (!product) throw new Error("Missing fixture");
    await ctx.db.patch(product._id, { name: "Cashier edit", price: 999 });
    const otherStore = await ctx.db.insert("stores", {
      name: "Other store",
      address1: "Test",
      tin: "SIM",
      min: "SIM",
      vatRate: 12,
      isActive: true,
      createdAt: 1,
    });
    const categoryId = await ctx.db.insert("categories", {
      storeId: otherStore,
      name: "Existing category",
      sortOrder: 0,
      isActive: true,
      createdAt: 1,
    });
    const unrelated = await ctx.db.insert("products", {
      storeId: otherStore,
      categoryId,
      name: "Existing product",
      price: 80,
      updatedAt: 1,
      isVatable: true,
      isActive: true,
      sortOrder: 0,
      createdAt: 1,
    });
    return { product: product._id, unrelated, original: await ctx.db.get(unrelated) };
  });
  expect(await t.mutation(internal.restaurantSimulation.seedCatalog, { storeId })).toEqual({
    categories: 0,
    groups: 0,
    options: 0,
    products: 0,
    tables: 0,
  });
  expect(await t.run((ctx) => ctx.db.get(preserved.product))).toMatchObject({
    name: "Cashier edit",
    price: 999,
  });
  expect(await t.run((ctx) => ctx.db.get(preserved.unrelated))).toEqual(preserved.original);
  const page = await t.query(internal.sync.pullTablePage, {
    storeId,
    table: "modifierOptions",
    since: 0,
    cursor: null,
    fkFields: ["modifierGroupId"],
  });
  expect(page.bucket.created).toHaveLength(80);
  expect(page.bucket.created.every((row: { isAvailable: boolean }) => row.isAvailable)).toBe(true);
  expect(
    await t.query(internal.restaurantSimulation.countPage, {
      storeId,
      table: "products",
      cursor: null,
    }),
  ).toMatchObject({ count: 500, isDone: true });
});

it("seeds complete historical orders once, with literal modifier-inclusive totals and bounded ranges", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://aromatic-dalmatian-30.convex.site");
  const t = convexTest(schema, modules);
  const storeId = await t.run((ctx) =>
    ctx.db.insert("stores", {
      name: "Test Store A",
      address1: "Test",
      tin: "SIM",
      min: "SIM",
      vatRate: 12,
      isActive: true,
      createdAt: 1,
    }),
  );
  const actorId = await t.run((ctx) =>
    ctx.db.insert("users", { name: "Simulation operator", isActive: true, storeId }),
  );
  await t.mutation(internal.restaurantSimulation.seedCatalog, { storeId });
  const args = {
    storeId,
    actorId,
    kind: "history" as const,
    start: 0,
    count: 2,
    epoch: 1788838200000,
  };
  expect(await t.mutation(internal.restaurantSimulation.seedOrders, args)).toEqual({
    inserted: 2,
    skipped: 0,
  });
  expect(await t.mutation(internal.restaurantSimulation.seedOrders, args)).toEqual({
    inserted: 0,
    skipped: 2,
  });
  const page = await t.query(internal.sync.pullTablePage, {
    storeId,
    table: "orders",
    since: 0,
    cursor: null,
    fkFields: ["tableId", "createdBy", "paidBy"],
  });
  expect(page.bucket.created).toHaveLength(2);
  const first = page.bucket.created.find(
    (row: { orderNumber: string }) => row.orderNumber === "SIM-H-00001",
  );
  expect(first).toMatchObject({ netSales: 1072, grossSales: 1072, itemCount: 6, status: "paid" });
  const payments = await t.query(internal.sync.pullTablePage, {
    storeId,
    table: "orderPayments",
    since: 0,
    cursor: null,
    fkFields: ["orderId", "createdBy"],
  });
  expect(
    payments.bucket.created.find((row: { orderId: string }) => row.orderId === first.id),
  ).toMatchObject({ amount: 1072, cashReceived: 1072, changeGiven: 0 });
  await expect(
    t.mutation(internal.restaurantSimulation.seedOrders, { ...args, count: 51 }),
  ).rejects.toThrow("range");
  await t.mutation(internal.restaurantSimulation.seedOrders, {
    ...args,
    kind: "active",
    count: 50,
  });
  const active = await t.query(internal.sync.pullTablePage, {
    storeId,
    table: "orders",
    since: 0,
    cursor: null,
    fkFields: [],
  });
  expect(
    active.bucket.created.filter((row: { status: string }) => row.status === "open"),
  ).toHaveLength(50);
  expect(
    active.bucket.created.filter(
      (row: { status: string; orderType: string }) =>
        row.status === "open" && row.orderType === "dine_in",
    ),
  ).toHaveLength(25);
  const tables = await t.query(internal.sync.pullTablePage, {
    storeId,
    table: "tables",
    since: 0,
    cursor: null,
    fkFields: ["currentOrderId"],
  });
  expect(
    tables.bucket.created.filter((row: { status: string }) => row.status === "occupied"),
  ).toHaveLength(25);
  await t.mutation(internal.restaurantSimulation.seedOrders, {
    ...args,
    kind: "traffic",
    start: 0,
    count: 1,
    runId: "test-run",
  });
  expect(
    await t.mutation(internal.restaurantSimulation.seedOrders, {
      ...args,
      kind: "traffic",
      start: 0,
      count: 1,
      runId: "test-run",
    }),
  ).toEqual({ inserted: 0, skipped: 1 });
});

it("blocks the simulation outside staging", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://loyal-shark-813.convex.site");
  const t = convexTest(schema, modules);
  const storeId = await t.run((ctx) =>
    ctx.db.insert("stores", {
      name: "Protected",
      address1: "Test",
      tin: "SIM",
      min: "SIM",
      vatRate: 0,
      isActive: true,
      createdAt: 1,
    }),
  );
  await expect(t.mutation(internal.restaurantSimulation.seedCatalog, { storeId })).rejects.toThrow(
    "staging",
  );
});
