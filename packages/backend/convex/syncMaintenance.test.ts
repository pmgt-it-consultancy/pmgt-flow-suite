import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupBackfillFixtures(t: any) {
  const roleId = await t.run(async (ctx: any) =>
    ctx.db.insert("roles", {
      name: "Manager",
      permissions: [],
      scopeLevel: "branch",
      isSystem: false,
      updatedAt: Date.now(),
    }),
  );
  const storeId = await t.run(async (ctx: any) =>
    ctx.db.insert("stores", {
      name: "Test Store",
      address1: "1",
      tin: "1",
      min: "1",
      vatRate: 12,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const userId = await t.run(async (ctx: any) =>
    ctx.db.insert("users", {
      name: "Cashier",
      email: "c@test",
      roleId,
      storeId,
      isActive: true,
      updatedAt: Date.now(),
    }),
  );
  const categoryId = await t.run(async (ctx: any) =>
    ctx.db.insert("categories", {
      storeId,
      name: "Food",
      sortOrder: 0,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const productId = await t.run(async (ctx: any) =>
    ctx.db.insert("products", {
      storeId,
      name: "Burger",
      categoryId,
      price: 200,
      isVatable: true,
      isActive: true,
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  return { storeId, userId, productId };
}

async function insertLegacyOrder(t: any, storeId: string, userId: string) {
  const now = Date.now();
  return t.run(async (ctx: any) =>
    ctx.db.insert("orders", {
      storeId,
      orderNumber: `T-${Math.random().toString(36).slice(2, 6)}`,
      orderType: "takeout",
      status: "paid",
      grossSales: 200,
      vatableSales: 178.57,
      vatAmount: 21.43,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 200,
      paymentMethod: "cash",
      createdBy: userId,
      createdAt: now,
      paidAt: now + 1,
      paidBy: userId,
      updatedAt: now + 2,
    }),
  );
}

describe("syncMaintenance backfillAllStoreIds", () => {
  it("backfills storeId on legacy orderItems by reading the parent order", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupBackfillFixtures(t);
    const orderId = await insertLegacyOrder(t, storeId, userId);

    const itemId = await t.run(async (ctx: any) =>
      ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Burger",
        productPrice: 200,
        quantity: 1,
        isVoided: false,
        // intentionally no storeId
      }),
    );

    const totals = await t.action(internal.syncMaintenance.backfillAllStoreIds, {});
    expect(totals.orderItems.patched).toBe(1);

    const after = await t.run(async (ctx: any) => ctx.db.get(itemId));
    expect(after.storeId).toBe(storeId);
  });

  it("backfills orderItemModifiers via the parent orderItem (chains through to order if needed)", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupBackfillFixtures(t);
    const orderId = await insertLegacyOrder(t, storeId, userId);

    // Legacy item AND legacy modifier — both missing storeId. The action's
    // declared sequence backfills items first, so the modifier resolves
    // through the now-backfilled item.
    const itemId = await t.run(async (ctx: any) =>
      ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Burger",
        productPrice: 200,
        quantity: 1,
        isVoided: false,
      }),
    );
    const modifierId = await t.run(async (ctx: any) =>
      ctx.db.insert("orderItemModifiers", {
        orderItemId: itemId,
        modifierGroupName: "Size",
        modifierOptionName: "Large",
        priceAdjustment: 20,
      }),
    );

    const totals = await t.action(internal.syncMaintenance.backfillAllStoreIds, {});
    expect(totals.orderItems.patched).toBe(1);
    expect(totals.orderItemModifiers.patched).toBe(1);

    const item = await t.run(async (ctx: any) => ctx.db.get(itemId));
    const modifier = await t.run(async (ctx: any) => ctx.db.get(modifierId));
    expect(item.storeId).toBe(storeId);
    expect(modifier.storeId).toBe(storeId);
  });

  it("paginates across many legacy rows in a single driver invocation", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupBackfillFixtures(t);

    // 250 legacy items across 250 orders — exceeds BACKFILL_PAGE_SIZE (100)
    // so the driver action must request continuation cursors.
    const ITEM_COUNT = 250;
    await t.run(async (ctx: any) => {
      const now = Date.now();
      for (let i = 0; i < ITEM_COUNT; i++) {
        const orderId = await ctx.db.insert("orders", {
          storeId,
          orderNumber: `T-${String(i).padStart(3, "0")}`,
          orderType: "takeout",
          status: "paid",
          grossSales: 200,
          vatableSales: 178.57,
          vatAmount: 21.43,
          vatExemptSales: 0,
          nonVatSales: 0,
          discountAmount: 0,
          netSales: 200,
          paymentMethod: "cash",
          createdBy: userId,
          createdAt: now + i,
          paidAt: now + i + 1,
          paidBy: userId,
          updatedAt: now + i + 2,
        });
        await ctx.db.insert("orderItems", {
          orderId,
          productId,
          productName: "Burger",
          productPrice: 200,
          quantity: 1,
          isVoided: false,
        });
      }
    });

    const totals = await t.action(internal.syncMaintenance.backfillAllStoreIds, {});
    expect(totals.orderItems.patched).toBe(ITEM_COUNT);

    const remaining = await t.run(async (ctx: any) =>
      ctx.db
        .query("orderItems")
        .withIndex("by_store_updatedAt", (q: any) => q.eq("storeId", undefined))
        .collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  it("is idempotent — a second run patches nothing", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupBackfillFixtures(t);
    const orderId = await insertLegacyOrder(t, storeId, userId);
    await t.run(async (ctx: any) =>
      ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Burger",
        productPrice: 200,
        quantity: 1,
        isVoided: false,
      }),
    );

    const first = await t.action(internal.syncMaintenance.backfillAllStoreIds, {});
    expect(first.orderItems.patched).toBe(1);

    const second = await t.action(internal.syncMaintenance.backfillAllStoreIds, {});
    expect(second.orderItems.patched).toBe(0);
    expect(second.orderItems.scanned).toBe(0);
  });
});

describe("syncMaintenance cleanupOrphanedLegacyRows", () => {
  it("deletes legacy orderItems whose parent order is gone, retains those with live parents", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupBackfillFixtures(t);

    // Live order + legacy item (kept)
    const liveOrderId = await insertLegacyOrder(t, storeId, userId);
    const liveItemId = await t.run(async (ctx: any) =>
      ctx.db.insert("orderItems", {
        orderId: liveOrderId,
        productId,
        productName: "Burger",
        productPrice: 200,
        quantity: 1,
        isVoided: false,
      }),
    );

    // Legacy item whose order was already deleted (orphan, should be deleted)
    const deadOrderId = await insertLegacyOrder(t, storeId, userId);
    const orphanItemId = await t.run(async (ctx: any) =>
      ctx.db.insert("orderItems", {
        orderId: deadOrderId,
        productId,
        productName: "Burger",
        productPrice: 200,
        quantity: 1,
        isVoided: false,
      }),
    );
    await t.run(async (ctx: any) => ctx.db.delete(deadOrderId));

    const totals = await t.action(internal.syncMaintenance.cleanupOrphanedLegacyRows, {});
    expect(totals.orderItems.deleted).toBe(1);
    expect(totals.orderItems.retained).toBeGreaterThanOrEqual(1);

    expect(await t.run(async (ctx: any) => ctx.db.get(liveItemId))).not.toBeNull();
    expect(await t.run(async (ctx: any) => ctx.db.get(orphanItemId))).toBeNull();
  });

  it("deletes orphaned modifiers when their orderItem is gone", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupBackfillFixtures(t);
    const orderId = await insertLegacyOrder(t, storeId, userId);

    const itemId = await t.run(async (ctx: any) =>
      ctx.db.insert("orderItems", {
        orderId,
        productId,
        productName: "Burger",
        productPrice: 200,
        quantity: 1,
        isVoided: false,
      }),
    );
    const orphanModifierId = await t.run(async (ctx: any) =>
      ctx.db.insert("orderItemModifiers", {
        orderItemId: itemId,
        modifierGroupName: "Size",
        modifierOptionName: "Large",
        priceAdjustment: 20,
      }),
    );
    // Delete the parent item to orphan the modifier
    await t.run(async (ctx: any) => ctx.db.delete(itemId));

    const totals = await t.action(internal.syncMaintenance.cleanupOrphanedLegacyRows, {});
    expect(totals.orderItemModifiers.deleted).toBe(1);
    expect(await t.run(async (ctx: any) => ctx.db.get(orphanModifierId))).toBeNull();
  });

  it("countLegacyOrphans reports zero after a successful cleanup", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupBackfillFixtures(t);

    const deadOrderId = await insertLegacyOrder(t, storeId, userId);
    await t.run(async (ctx: any) =>
      ctx.db.insert("orderItems", {
        orderId: deadOrderId,
        productId,
        productName: "Burger",
        productPrice: 200,
        quantity: 1,
        isVoided: false,
      }),
    );
    await t.run(async (ctx: any) => ctx.db.delete(deadOrderId));

    const before = await t.query(internal.syncMaintenance.countLegacyOrphans, {});
    expect(before.orderItems.total).toBe(1);

    await t.action(internal.syncMaintenance.cleanupOrphanedLegacyRows, {});

    const after = await t.query(internal.syncMaintenance.countLegacyOrphans, {});
    expect(after.orderItems.total).toBe(0);
    expect(after.orderItemModifiers.total).toBe(0);
    expect(after.orderDiscounts.total).toBe(0);
    expect(after.orderVoids.total).toBe(0);
  });
});
