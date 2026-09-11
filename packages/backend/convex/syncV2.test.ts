import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { publishOrderAggregateEvent } from "./lib/replicationEvents";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY_MS = 24 * 60 * 60 * 1000;

async function setup(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const roleId = await ctx.db.insert("roles", {
      name: "Staff",
      permissions: ["orders.view"],
      scopeLevel: "branch",
      isSystem: false,
    });
    const storeId = await ctx.db.insert("stores", {
      name: "Bounded Store",
      address1: "1 Test Street",
      tin: "TIN-1",
      min: "MIN-1",
      vatRate: 0.12,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      name: "Staff",
      email: "staff@example.test",
      roleId,
      storeId,
      isActive: true,
    });
    return { storeId, userId };
  });
}

async function insertOrder(
  t: ReturnType<typeof convexTest>,
  args: {
    storeId: any;
    userId: any;
    createdAt: number;
    status: "draft" | "open" | "paid" | "voided";
    suffix: string;
  },
) {
  return t.run(async (ctx) =>
    ctx.db.insert("orders", {
      storeId: args.storeId,
      orderNumber: `T-${args.suffix}`,
      orderType: "takeout",
      status: args.status,
      grossSales: 100,
      vatableSales: 89.29,
      vatAmount: 10.71,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 100,
      createdBy: args.userId,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    }),
  );
}

describe("sync v2 operational snapshot", () => {
  it("advertises bounded v2 behavior without disabling v1", async () => {
    const t = convexTest(schema, modules);
    const capabilities = await t.query(internal.syncV2.getCapabilitiesCore, {});

    expect(capabilities).toMatchObject({
      protocolVersion: 2,
      legacyV1Available: true,
      maxOperationalRetentionDays: 7,
      supportsScopedRepair: true,
    });
  });

  it("returns recent closed orders plus all active orders, excluding old closed history", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setup(t);
    const now = 2_000_000_000_000;
    const recentPaid = await insertOrder(t, {
      storeId,
      userId,
      createdAt: now - DAY_MS,
      status: "paid",
      suffix: "RECENT",
    });
    const oldOpen = await insertOrder(t, {
      storeId,
      userId,
      createdAt: now - 30 * DAY_MS,
      status: "open",
      suffix: "OPEN",
    });
    await insertOrder(t, {
      storeId,
      userId,
      createdAt: now - 30 * DAY_MS,
      status: "paid",
      suffix: "HISTORY",
    });

    const snapshot = await t.query(internal.syncV2.getOperationalSnapshotCore, {
      storeId,
      now,
      retentionDays: 7,
    });

    expect(snapshot.protocolVersion).toBe(2);
    expect(snapshot.stream).toBe("operational_orders");
    expect(snapshot.aggregates.map((aggregate: any) => aggregate.order._id)).toEqual(
      expect.arrayContaining([recentPaid, oldOpen]),
    );
    expect(snapshot.aggregates).toHaveLength(2);
    expect(snapshot.checkpoint.generation).toBeTruthy();
  });

  it("pulls and coalesces only aggregate events after an opaque checkpoint", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setup(t);
    const now = 2_000_000_000_000;
    const orderId = await insertOrder(t, {
      storeId,
      userId,
      createdAt: now,
      status: "open",
      suffix: "DELTA",
    });
    await t.run(async (ctx) => {
      await publishOrderAggregateEvent(ctx, { orderId, eventKind: "membership_enter" });
    });
    const snapshot = await t.query(internal.syncV2.getOperationalSnapshotCore, {
      storeId,
      now,
      retentionDays: 7,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(orderId, { customerName: "Updated" });
      await publishOrderAggregateEvent(ctx, { orderId });
      await ctx.db.patch(orderId, { pax: 3 });
      await publishOrderAggregateEvent(ctx, { orderId });
    });

    const delta = await t.query(internal.syncV2.pullOperationalEventsCore, {
      storeId,
      eventCursor: snapshot.checkpoint.eventCursor,
      limit: 100,
    });

    expect(delta.changes).toHaveLength(1);
    expect(delta.changes[0].aggregate.order._id).toBe(orderId);
    expect(delta.changes[0].aggregate.order.replicationVersion).toBe(3);
    expect(delta.changes[0].aggregate.order.customerName).toBe("Updated");
    expect(delta.changes[0].aggregate.order.pax).toBe(3);
    expect(delta.checkpoint.eventCursor).not.toBe(snapshot.checkpoint.eventCursor);
  });
});

describe("sync v2 explicit history", () => {
  it("returns bounded store-scoped summaries and hydrates detail only by explicit id", async () => {
    const t = convexTest(schema, modules);
    const first = await setup(t);
    const second = await setup(t);
    const now = 2_000_000_000_000;
    const firstOrder = await insertOrder(t, {
      ...first,
      createdAt: now - 20 * DAY_MS,
      status: "paid",
      suffix: "SEARCH-001",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(firstOrder, {
        customerName: "Maria Santos",
        tableName: "Patio 4",
        itemCount: 2,
        replicationVersion: 4,
      });
      await ctx.db.insert("orderItems", {
        orderId: firstOrder,
        storeId: first.storeId,
        productId: await ctx.db.insert("products", {
          storeId: first.storeId,
          name: "History Item",
          categoryId: await ctx.db.insert("categories", {
            storeId: first.storeId,
            name: "History",
            sortOrder: 1,
            isActive: true,
            createdAt: now,
          }),
          price: 100,
          isVatable: true,
          isActive: true,
          sortOrder: 1,
          createdAt: now,
          updatedAt: now,
        }),
        productName: "History Item",
        productPrice: 100,
        quantity: 2,
        isVoided: false,
      });
    });
    await insertOrder(t, {
      ...second,
      createdAt: now - 20 * DAY_MS,
      status: "paid",
      suffix: "SEARCH-OTHER-STORE",
    });
    await insertOrder(t, {
      ...first,
      createdAt: now - DAY_MS,
      status: "voided",
      suffix: "WRONG-STATUS",
    });

    const page = await t.query(internal.syncV2.searchOrderHistoryCore, {
      storeId: first.storeId,
      startDate: now - 30 * DAY_MS,
      endDate: now,
      status: "paid",
      search: "patio",
      limit: 1,
    });

    expect(page.orders).toHaveLength(1);
    expect(page.orders[0]).toMatchObject({
      _id: firstOrder,
      customerName: "Maria Santos",
      tableName: "Patio 4",
      itemCount: 2,
    });
    expect(page.orders[0]).not.toHaveProperty("items");

    const detail = await t.query(internal.syncV2.getHistoricalOrderCore, {
      storeId: first.storeId,
      orderId: firstOrder,
    });
    expect(detail.aggregateVersion).toBe(4);
    expect(detail.aggregate.items).toHaveLength(1);

    const crossStore = await t.query(internal.syncV2.getHistoricalOrderCore, {
      storeId: second.storeId,
      orderId: firstOrder,
    });
    expect(crossStore).toBeNull();
  });
});
