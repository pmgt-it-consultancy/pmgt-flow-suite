import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const roleId = await ctx.db.insert("roles", {
      name: "Cashier",
      permissions: ["checkout.process"],
      scopeLevel: "branch",
      isSystem: false,
    });
    const storeId = await ctx.db.insert("stores", {
      name: "Command Store",
      address1: "1 Test Street",
      tin: "TIN",
      min: "MIN",
      vatRate: 0.12,
      isActive: true,
      createdAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      name: "Cashier",
      email: "cashier@example.test",
      roleId,
      storeId,
      isActive: true,
    });
    const orderId = await ctx.db.insert("orders", {
      storeId,
      orderNumber: "T-001",
      orderType: "takeout",
      status: "open",
      grossSales: 100,
      vatableSales: 89.29,
      vatAmount: 10.71,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 100,
      createdBy: userId,
      createdAt: 1,
    });
    return { storeId, userId, orderId };
  });
}

describe("v2 business commands", () => {
  it("settles an order once under a stable financial operation id", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, orderId } = await setup(t);
    const args = {
      storeId,
      userId,
      deviceId: "tablet-a",
      commands: [
        {
          operationId: "settle-op-1",
          schemaVersion: 1,
          command: {
            kind: "SettleOrder",
            aggregateId: orderId,
            payments: [{ paymentMethod: "cash", amount: 100, cashReceived: 100 }],
          },
        },
      ],
    };

    const first = await t.mutation(internal.syncCommands.applyCommandsCore, args);
    const retry = await t.mutation(internal.syncCommands.applyCommandsCore, args);

    expect(first).toEqual(retry);
    expect(first.results[0]).toMatchObject({ operationId: "settle-op-1", status: "accepted" });
    const state = await t.run(async (ctx) => ({
      order: await ctx.db.get(orderId),
      payments: await ctx.db
        .query("orderPayments")
        .withIndex("by_order", (q) => q.eq("orderId", orderId))
        .collect(),
      events: await ctx.db
        .query("replicationEvents")
        .withIndex("by_operation", (q) => q.eq("operationId", "settle-op-1"))
        .collect(),
    }));
    expect(state.order?.status).toBe("paid");
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0].operationId).toBe("settle-op-1:0");
    expect(state.events).toHaveLength(1);
  });
});
