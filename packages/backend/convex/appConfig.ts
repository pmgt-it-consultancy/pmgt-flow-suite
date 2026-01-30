import { v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";

export const getMinRequiredVersion = internalQuery({
  args: {},
  returns: v.union(v.object({ value: v.string() }), v.null()),
  handler: async (ctx) => {
    const config = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "minRequiredVersion"))
      .first();

    if (!config) return null;
    return { value: config.value };
  },
});

export const setMinRequiredVersion = mutation({
  args: { version: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "minRequiredVersion"))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { value: args.version });
    } else {
      await ctx.db.insert("appConfig", {
        key: "minRequiredVersion",
        value: args.version,
      });
    }

    return null;
  },
});
