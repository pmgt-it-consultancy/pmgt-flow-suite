import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { requireStagingLab } from "./lib/stagingLab";

export const repairLegacyOptions = internalMutation({
  args: { dryRun: v.boolean() },
  returns: v.object({
    scanned: v.number(),
    repairable: v.number(),
    patched: v.number(),
    orphaned: v.number(),
  }),
  handler: async (ctx, { dryRun }) => {
    requireStagingLab();
    const rows = await ctx.db
      .query("modifierOptions")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .take(100);
    let repairable = 0;
    let patched = 0;
    let orphaned = 0;
    for (const option of rows) {
      const group = await ctx.db.get(option.modifierGroupId);
      if (!group) {
        orphaned++;
        continue;
      }
      repairable++;
      if (dryRun) continue;
      await ctx.db.patch(option._id, {
        storeId: group.storeId,
        // Preserve the identity already used by any tablet that pulled it.
        clientId: option.clientId ?? option._id,
        // Historical timestamps would stay behind existing incremental cursors.
        updatedAt: Date.now(),
      });
      patched++;
    }
    return { scanned: rows.length, repairable, patched, orphaned };
  },
});
