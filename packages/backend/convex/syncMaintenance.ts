import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Daily cron job: deletes syncedMutations rows older than 7 days. The
 * idempotency cache only needs to live long enough that a tablet's retry
 * loop can find it; 7 days covers any realistic offline-then-reconnect
 * window.
 */
export const cleanupSyncedMutations = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const stale = await ctx.db
      .query("syncedMutations")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .collect();
    for (const doc of stale) {
      await ctx.db.delete(doc._id);
    }
    return { deleted: stale.length };
  },
});
