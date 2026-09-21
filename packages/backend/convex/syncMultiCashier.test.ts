/**
 * Several tills working one store's orders.
 *
 * Regression cover for the field incident of 2026-09-21: one till discarded a draft another till
 * was still holding, that till then settled the order for real, and its push was refused forever
 * ("Order is closed", then "exceeds amount due" because the refused order row left netSales
 * stale). The refusal was deterministic, so the till retried it every 60s for nine hours, stayed
 * red, could not close the day, and its four sales never reached the server.
 */
import { describe, expect, it } from "vitest";
import { convexTest } from "../testUtils/scheduledTest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const CLIENT_ID = "order-client-1";
const now = 1_700_000_000_000;

async function fixture(t: any) {
  const roleId = await t.run(async (ctx: any) =>
    ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["orders.create", "orders.edit"],
      scopeLevel: "branch",
      isSystem: false,
      updatedAt: now,
    }),
  );
  const storeId = await t.run(async (ctx: any) =>
    ctx.db.insert("stores", {
      name: "Two Till Store",
      address1: "1 Test St",
      tin: "000-000-000-000",
      min: "MIN-000001",
      vatRate: 12,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const userId = await t.run(async (ctx: any) =>
    ctx.db.insert("users", {
      name: "Cashier",
      email: "cashier@test.com",
      roleId,
      storeId,
      isActive: true,
      updatedAt: now,
    }),
  );
  return { storeId, userId };
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIENT_ID,
    orderType: "takeout",
    orderNumber: "T-A001",
    status: "draft",
    grossSales: 0,
    vatableSales: 0,
    vatAmount: 0,
    vatExemptSales: 0,
    nonVatSales: 0,
    discountAmount: 0,
    netSales: 0,
    createdAt: now,
    ...overrides,
  };
}

/** The owning till's settlement: ₱200 cash, pushed with its payment row in one request. */
const settlement = {
  orders: {
    created: [],
    updated: [
      orderRow({
        status: "paid",
        grossSales: 200,
        vatableSales: 178.57,
        vatAmount: 21.43,
        netSales: 200,
        paymentMethod: "cash",
        cashReceived: 200,
        paidAt: now + 60_000,
      }),
    ],
  },
  orderPayments: {
    created: [
      {
        id: "payment-client-1",
        orderId: CLIENT_ID,
        paymentMethod: "cash",
        amount: 200,
        cashReceived: 200,
        changeGiven: 0,
        createdAt: now + 60_000,
      },
    ],
    updated: [],
  },
};

function push(
  t: any,
  storeId: string,
  userId: string,
  deviceId: string,
  clientMutationId: string,
  changes: Record<string, unknown>,
) {
  return t.mutation(internal.sync.syncPushCore, {
    storeId,
    userId,
    deviceId,
    payload: { lastPulledAt: now, clientMutationId, changes },
  });
}

const orderByClientId = (t: any) =>
  t.run(async (ctx: any) =>
    ctx.db
      .query("orders")
      .withIndex("by_clientId", (q: any) => q.eq("clientId", CLIENT_ID))
      .first(),
  );

describe("several tills sharing one store's orders", () => {
  it("lets the owning till settle an order another till discarded", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await fixture(t);

    expect(
      await push(t, storeId, userId, "tablet-a", "m1", {
        orders: { created: [orderRow()], updated: [] },
      }),
    ).toEqual({ success: true });

    // Tablet B sees the draft in the store-wide takeout list and discards it.
    expect(
      await push(t, storeId, userId, "tablet-b", "m2", {
        orders: { created: [], updated: [orderRow({ status: "voided" })] },
      }),
    ).toEqual({ success: true });

    const discarded = await orderByClientId(t);
    expect(discarded.status).toBe("voided");
    // The discard still moves status only, so B's stale copy cannot overwrite A's totals.
    expect(discarded.originDeviceId).toBe("tablet-a");

    // A took the cash. Its settlement is accepted first time, not refused forever.
    expect(await push(t, storeId, userId, "tablet-a", "m3", settlement)).toEqual({
      success: true,
    });

    const settled = await orderByClientId(t);
    expect(settled.status).toBe("paid");
    expect(settled.netSales).toBe(200);

    const recorded = await t.run(async (ctx: any) => ctx.db.query("orderPayments").collect());
    expect(recorded).toHaveLength(1);
    expect(recorded[0].amount).toBe(200);
  });

  it("still freezes an order a cashier genuinely voided", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await fixture(t);

    await push(t, storeId, userId, "tablet-a", "v1", {
      orders: { created: [orderRow()], updated: [] },
    });
    // A real void records evidence; only that distinguishes it from a draft discard.
    await push(t, storeId, userId, "tablet-a", "v2", {
      orders: { created: [], updated: [orderRow({ status: "voided" })] },
      orderVoids: {
        created: [
          {
            id: "void-client-1",
            orderId: CLIENT_ID,
            voidType: "full_order",
            reason: "Order cancelled by cashier",
            amount: 0,
            createdAt: now,
          },
        ],
        updated: [],
      },
    });

    const refused = await push(t, storeId, userId, "tablet-a", "v3", settlement);
    expect(refused.rejected?.[0]).toMatchObject({
      table: "orders",
      reason: "Order is closed",
    });
    expect(await t.run(async (ctx: any) => ctx.db.query("orderPayments").collect())).toHaveLength(
      0,
    );
  });

  it("lets the owning till settle after a line was voided and the draft discarded", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await fixture(t);

    await push(t, storeId, userId, "tablet-a", "i1", {
      orders: { created: [orderRow({ status: "open" })], updated: [] },
    });
    // Voiding one line records an orderVoids row and leaves the order open, so it must not read
    // as "a cashier closed this order" the way a full-order void does.
    await push(t, storeId, userId, "tablet-a", "i2", {
      orderVoids: {
        created: [
          {
            id: "item-void-1",
            orderId: CLIENT_ID,
            voidType: "item",
            reason: "Wrong item rung up",
            amount: 50,
            createdAt: now,
          },
        ],
        updated: [],
      },
    });
    await push(t, storeId, userId, "tablet-b", "i3", {
      orders: { created: [], updated: [orderRow({ status: "voided" })] },
    });

    expect(await push(t, storeId, userId, "tablet-a", "i4", settlement)).toEqual({
      success: true,
    });
    expect((await orderByClientId(t)).status).toBe("paid");
  });

  it("still freezes an order closed by a refund void", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await fixture(t);

    await push(t, storeId, userId, "tablet-a", "f1", {
      orders: { created: [orderRow()], updated: [] },
    });
    await push(t, storeId, userId, "tablet-a", "f2", {
      orders: { created: [], updated: [orderRow({ status: "voided" })] },
      orderVoids: {
        created: [
          {
            id: "refund-void-1",
            orderId: CLIENT_ID,
            voidType: "refund",
            reason: "Refunded to customer",
            amount: 200,
            createdAt: now,
          },
        ],
        updated: [],
      },
    });

    const refused = await push(t, storeId, userId, "tablet-a", "f3", settlement);
    expect(refused.rejected?.[0]).toMatchObject({ reason: "Order is closed" });
  });

  it("lets a second till add to and settle an order the first till opened", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await fixture(t);

    await push(t, storeId, userId, "tablet-a", "s1", {
      orders: { created: [orderRow({ status: "open" })], updated: [] },
    });

    // Under the old ownership lock this was "Order is owned by another device", which left the
    // second till's work stuck in its queue forever.
    expect(
      await push(t, storeId, userId, "tablet-b", "s2", {
        orders: {
          created: [],
          updated: [orderRow({ status: "open", customerName: "Served by till B" })],
        },
      }),
    ).toEqual({ success: true });

    expect(await push(t, storeId, userId, "tablet-b", "s3", settlement)).toEqual({
      success: true,
    });

    const settled = await orderByClientId(t);
    expect(settled.status).toBe("paid");
    expect(settled.originDeviceId).toBe("tablet-b");
  });
});

describe("releasePoisonedOrders recovers a till poisoned by the previous build", () => {
  it("returns a silently discarded order to draft and clears ownership", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await fixture(t);

    await push(t, storeId, userId, "tablet-a", "r1", {
      orders: { created: [orderRow()], updated: [] },
    });
    await push(t, storeId, userId, "tablet-b", "r2", {
      orders: { created: [], updated: [orderRow({ status: "voided" })] },
    });

    const inspected = await t.query(internal.syncMaintenance.inspectPoisonedPush, {
      clientIds: [CLIENT_ID],
    });
    expect(inspected[0]).toMatchObject({
      status: "voided",
      releasable: true,
      paymentCount: 0,
    });

    const repair = await t.mutation(internal.syncMaintenance.releasePoisonedOrders, {
      clientIds: [CLIENT_ID],
    });
    expect(repair.released).toHaveLength(1);
    expect(repair.skipped).toHaveLength(0);

    const released = await orderByClientId(t);
    expect(released.status).toBe("draft");
    expect(released.originDeviceId).toBeUndefined();

    // Idempotent: nothing left to release once the till has delivered.
    expect(await push(t, storeId, userId, "tablet-a", "r3", settlement)).toEqual({
      success: true,
    });
    const again = await t.mutation(internal.syncMaintenance.releasePoisonedOrders, {
      clientIds: [CLIENT_ID],
    });
    expect(again.released).toHaveLength(0);
    expect(again.skipped[0].note).toContain("not voided");
  });

  it("refuses to release an order carrying legacy tender on the order row", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await fixture(t);

    await push(t, storeId, userId, "tablet-a", "l1", {
      orders: { created: [orderRow()], updated: [] },
    });
    // Orders settled before orderPayments existed carry their tender on the order row, so counting
    // payment rows alone would call a real sale releasable.
    const order = await orderByClientId(t);
    await t.run(async (ctx: any) =>
      ctx.db.patch(order._id, {
        status: "voided",
        paymentMethod: "cash",
        cashReceived: 200,
      }),
    );

    const repair = await t.mutation(internal.syncMaintenance.releasePoisonedOrders, {
      clientIds: [CLIENT_ID],
    });
    expect(repair.released).toHaveLength(0);
    expect(repair.skipped[0].note).toContain("tender");
  });

  it("refuses to release an order a cashier genuinely voided", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await fixture(t);

    await push(t, storeId, userId, "tablet-a", "g1", {
      orders: { created: [orderRow()], updated: [] },
    });
    await push(t, storeId, userId, "tablet-a", "g2", {
      orders: { created: [], updated: [orderRow({ status: "voided" })] },
      orderVoids: {
        created: [
          {
            id: "void-client-1",
            orderId: CLIENT_ID,
            voidType: "full_order",
            reason: "Order cancelled by cashier",
            amount: 0,
            createdAt: now,
          },
        ],
        updated: [],
      },
    });

    const repair = await t.mutation(internal.syncMaintenance.releasePoisonedOrders, {
      clientIds: [CLIENT_ID],
    });
    expect(repair.released).toHaveLength(0);
    expect(repair.skipped[0].note).toContain("genuine void");
  });
});
