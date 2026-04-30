import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { SYNCED_TABLES } from "../lib/sync";

/**
 * One-shot backfill: assigns a clientId UUID to every row in synced tables
 * that lacks one, and sets updatedAt to _creationTime when missing.
 *
 * Idempotent — safe to re-run; only touches rows missing clientId or updatedAt.
 *
 * Run via:
 *   npx convex run migrations/2026_04_clientIdBackfill:backfillClientIds '{}'
 *
 * After this runs, /sync/pull will include all pre-existing rows on a fresh
 * tablet's first sync (lastPulledAt: null) and will surface them on
 * subsequent incremental pulls if their updatedAt advances.
 */
export const backfillClientIds = internalMutation({
  args: {},
  returns: v.object({
    summary: v.string(),
    totalUpdated: v.number(),
  }),
  handler: async (ctx) => {
    const summary: Record<string, number> = {};
    let totalUpdated = 0;

    for (const table of SYNCED_TABLES) {
      const rows = await ctx.db.query(table).collect();
      let count = 0;
      for (const row of rows) {
        const patches: Record<string, unknown> = {};
        // Use _id as the clientId for legacy rows. WatermelonDB keys local
        // rows by `clientId ?? _id` (see toWatermelon in convex/sync.ts), so
        // any tablet that pulled this row before the backfill stored it
        // under `_id`. Minting a random UUID would change the WM row id
        // and produce duplicates on the next pull.
        if (!(row as { clientId?: string }).clientId) {
          patches.clientId = row._id;
        }
        if ((row as { updatedAt?: number }).updatedAt === undefined) {
          patches.updatedAt = row._creationTime;
        }
        if (Object.keys(patches).length > 0) {
          await ctx.db.patch(row._id, patches as never);
          count++;
        }
      }
      summary[table] = count;
      totalUpdated += count;
    }

    return { summary: JSON.stringify(summary), totalUpdated };
  },
});

/**
 * Backfills storeId on order line-item tables (orderItems, orderItemModifiers,
 * orderDiscounts, orderVoids) by joining through their parent order. Required
 * for the by_store_updatedAt index to function on these tables.
 *
 * Idempotent — safe to re-run; only touches rows missing storeId.
 *
 * Run via:
 *   npx convex run migrations/2026_04_clientIdBackfill:backfillLineItemStoreIds '{}'
 */
export const backfillLineItemStoreIds = internalMutation({
  args: {},
  returns: v.object({
    summary: v.string(),
    totalUpdated: v.number(),
  }),
  handler: async (ctx) => {
    const summary: Record<string, number> = {};
    let totalUpdated = 0;

    // orderItems — direct from parent order
    const orderItems = await ctx.db.query("orderItems").collect();
    let count = 0;
    for (const item of orderItems) {
      if ((item as { storeId?: string }).storeId) continue;
      const order = await ctx.db.get(item.orderId);
      if (!order) continue;
      await ctx.db.patch(item._id, { storeId: order.storeId });
      count++;
    }
    summary.orderItems = count;
    totalUpdated += count;

    // orderItemModifiers — through orderItem → order
    const itemModifiers = await ctx.db.query("orderItemModifiers").collect();
    count = 0;
    for (const mod of itemModifiers) {
      if ((mod as { storeId?: string }).storeId) continue;
      const item = await ctx.db.get(mod.orderItemId);
      if (!item) continue;
      const order = await ctx.db.get(item.orderId);
      if (!order) continue;
      await ctx.db.patch(mod._id, { storeId: order.storeId });
      count++;
    }
    summary.orderItemModifiers = count;
    totalUpdated += count;

    // orderDiscounts — direct from parent order
    const discounts = await ctx.db.query("orderDiscounts").collect();
    count = 0;
    for (const d of discounts) {
      if ((d as { storeId?: string }).storeId) continue;
      const order = await ctx.db.get(d.orderId);
      if (!order) continue;
      await ctx.db.patch(d._id, { storeId: order.storeId });
      count++;
    }
    summary.orderDiscounts = count;
    totalUpdated += count;

    // orderVoids — direct from parent order
    const voids = await ctx.db.query("orderVoids").collect();
    count = 0;
    for (const v of voids) {
      if ((v as { storeId?: string }).storeId) continue;
      const order = await ctx.db.get(v.orderId);
      if (!order) continue;
      await ctx.db.patch(v._id, { storeId: order.storeId });
      count++;
    }
    summary.orderVoids = count;
    totalUpdated += count;

    // modifierOptions — through modifierGroup
    const modOptions = await ctx.db.query("modifierOptions").collect();
    count = 0;
    for (const opt of modOptions) {
      if ((opt as { storeId?: string }).storeId) continue;
      const group = await ctx.db.get(opt.modifierGroupId);
      if (!group) continue;
      await ctx.db.patch(opt._id, { storeId: group.storeId });
      count++;
    }
    summary.modifierOptions = count;
    totalUpdated += count;

    return { summary: JSON.stringify(summary), totalUpdated };
  },
});
