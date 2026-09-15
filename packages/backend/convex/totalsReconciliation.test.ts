import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const createdAt = Date.parse("2026-09-15T05:00:00Z");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const roleId = await ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["reports.print_eod", "reports.daily"],
      scopeLevel: "branch",
      isSystem: false,
    });
    const storeId = await ctx.db.insert("stores", {
      name: "Test",
      address1: "Test",
      tin: "TEST",
      min: "TEST",
      vatRate: 12,
      isActive: true,
      createdAt,
    });
    const userId = await ctx.db.insert("users", {
      name: "Manager",
      roleId,
      storeId,
      isActive: true,
    });
    const categoryId = await ctx.db.insert("categories", {
      storeId,
      name: "Food",
      sortOrder: 0,
      isActive: true,
      createdAt,
    });
    const productId = await ctx.db.insert("products", {
      storeId,
      categoryId,
      name: "Meal",
      price: 112,
      isVatable: true,
      isActive: true,
      sortOrder: 0,
      createdAt,
      updatedAt: createdAt,
    });
    return { storeId, userId, productId };
  });
  const actor = t.withIdentity({ subject: ids.userId });
  async function push(netSales = 111, mutationId = "sale-1", includeItem = true) {
    return t.mutation(internal.sync.syncPushCore, {
      ...{ storeId: ids.storeId, userId: ids.userId },
      deviceId: "tablet-1",
      payload: {
        clientMutationId: mutationId,
        changes: {
          orders: {
            created: [
              {
                id: "order-1",
                orderType: "takeout",
                status: "paid",
                orderNumber: "T-A001",
                grossSales: 112,
                vatableSales: 100,
                vatAmount: 12,
                vatExemptSales: 0,
                nonVatSales: 0,
                discountAmount: 0,
                netSales,
                createdAt,
                paidAt: createdAt,
                paymentMethod: "cash",
                itemCount: 1,
              },
            ],
            updated: [],
            deleted: [],
          },
          ...(includeItem
            ? {
                orderItems: {
                  created: [
                    {
                      id: "item-1",
                      orderId: "order-1",
                      productId: ids.productId,
                      productName: "Meal",
                      productPrice: 112,
                      quantity: 1,
                    },
                  ],
                  updated: [],
                  deleted: [],
                },
              }
            : {}),
        },
      },
    });
  }
  return { t, actor, ...ids, push };
}

describe("Totals Reconciliation at push and closing boundaries", () => {
  it("accepts a divergent sale, preserves its totals, and records one discrepancy across retries", async () => {
    const { actor, storeId, push } = await setup();
    expect(await push()).toEqual({ success: true });
    expect(await push()).toEqual({ success: true });
    const records = await actor.query(api.closing.getTotalsDivergences, {
      storeId,
      reportDate: "2026-09-15",
    });
    expect(records).toHaveLength(1);
    expect(records[0].deviceTotals.netSales).toBe(111);
    expect(records[0].reconciledTotals.netSales).toBe(112);
    expect(records[0].fields).toEqual(["netSales"]);
  });

  it("does not flag the intermediate order before the same push applies its item", async () => {
    const { actor, storeId, push } = await setup();
    expect(await push(112)).toEqual({ success: true });
    expect(
      await actor.query(api.closing.getTotalsDivergences, { storeId, reportDate: "2026-09-15" }),
    ).toEqual([]);
  });

  it("blocks closing only the affected day and resolves only after a matching replay", async () => {
    const { actor, storeId, push } = await setup();
    await push();
    await expect(
      actor.mutation(api.closing.logDayClosing, { storeId, reportDate: "2026-09-15" }),
    ).rejects.toThrow("Totals Divergences");
    await expect(
      actor.mutation(api.closing.logDayClosing, { storeId, reportDate: "2026-09-14" }),
    ).resolves.toBeNull();
    await push(112, "sale-correction", false);
    expect(
      await actor.query(api.closing.getTotalsDivergences, { storeId, reportDate: "2026-09-15" }),
    ).toEqual([]);
    await expect(
      actor.mutation(api.closing.logDayClosing, { storeId, reportDate: "2026-09-15" }),
    ).resolves.toBeNull();
  });

  it("does not expose another store's financial evidence", async () => {
    const { t, actor, push } = await setup();
    await push();
    const otherStore = await t.run((ctx) =>
      ctx.db.insert("stores", {
        name: "Other",
        address1: "Other",
        tin: "OTHER",
        min: "OTHER",
        vatRate: 12,
        isActive: true,
        createdAt,
      }),
    );
    await expect(
      actor.query(api.closing.getTotalsDivergences, {
        storeId: otherStore,
        reportDate: "2026-09-15",
      }),
    ).rejects.toThrow();
  });
});
