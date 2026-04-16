import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * One-shot backfill for orders.itemCount and orders.tableName.
 *
 * Context: Tasks 14-16 introduced these denormalized fields. Tasks 15-16 maintain them
 * on new writes and on table renames. This backfill populates them for pre-existing
 * open orders so Task 18's simplified listActive query returns correct data.
 *
 * Safe to re-run — idempotent. Only touches orders with status "open". Closed/paid
 * orders keep whatever historical tableName they already have (possibly undefined).
 *
 * Run via: npx convex run migrations/2026_04_orderDenormalization:backfillOrderDenorm '{}'
 */
export const backfillOrderDenorm = internalMutation({
  args: {},
  returns: v.object({ updated: v.number() }),
  handler: async (ctx) => {
    const openOrders = await ctx.db
      .query("orders")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    let updated = 0;
    for (const order of openOrders) {
      let tableName: string | undefined;
      if (order.tableId) {
        const table = await ctx.db.get(order.tableId);
        tableName = table?.name;
      }
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .collect();
      const itemCount = items.filter((i) => !i.isVoided).reduce((sum, i) => sum + i.quantity, 0);

      await ctx.db.patch(order._id, { tableName, itemCount });
      updated++;
    }
    return { updated };
  },
});
