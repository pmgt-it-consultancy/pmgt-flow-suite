import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requirePermission } from "./lib/permissions";

const AUTO_LOCK_TIMEOUT_VALUES = new Set([0, 1, 2, 5, 10, 15, 30]);

export const screenLock = mutation({
  args: {
    storeId: v.id("stores"),
    trigger: v.union(v.literal("manual"), v.literal("idle_timeout")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "screen_locked",
      entityType: "screen_lock",
      entityId: user._id,
      details: JSON.stringify({
        trigger: args.trigger,
        userId: user._id,
      }),
      userId: user._id,
      createdAt: Date.now(),
    });

    return null;
  },
});

export const logScreenUnlock = internalMutation({
  args: {
    storeId: v.id("stores"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "screen_unlocked",
      entityType: "screen_lock",
      entityId: args.userId,
      details: JSON.stringify({
        userId: args.userId,
        method: "pin",
      }),
      userId: args.userId,
      createdAt: Date.now(),
    });

    return null;
  },
});

export const logScreenUnlockOverride = internalMutation({
  args: {
    storeId: v.id("stores"),
    lockedUserId: v.id("users"),
    managerId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "screen_unlock_override",
      entityType: "screen_lock",
      entityId: args.lockedUserId,
      details: JSON.stringify({
        lockedUserId: args.lockedUserId,
        overrideManagerId: args.managerId,
        method: "manager_pin",
      }),
      userId: args.managerId,
      createdAt: Date.now(),
    });

    return null;
  },
});

export const getAutoLockTimeout = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const setting = await ctx.db
      .query("settings")
      .withIndex("by_store_key", (q) => q.eq("storeId", args.storeId).eq("key", "autoLockTimeout"))
      .unique();

    if (!setting) {
      return 5;
    }

    const value = Number.parseInt(setting.value, 10);
    return Number.isNaN(value) ? 5 : value;
  },
});

export const getUserHasPin = query({
  args: {
    userId: v.id("users"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return !!user?.pin;
  },
});

export const setAutoLockTimeout = mutation({
  args: {
    storeId: v.id("stores"),
    minutes: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    if (!AUTO_LOCK_TIMEOUT_VALUES.has(args.minutes)) {
      throw new Error("Invalid auto-lock timeout value");
    }

    await requirePermission(ctx, user._id, "system.settings");

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_store_key", (q) => q.eq("storeId", args.storeId).eq("key", "autoLockTimeout"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.minutes.toString(),
        updatedAt: Date.now(),
        updatedBy: user._id,
      });
    } else {
      await ctx.db.insert("settings", {
        storeId: args.storeId,
        key: "autoLockTimeout",
        value: args.minutes.toString(),
        updatedAt: Date.now(),
        updatedBy: user._id,
      });
    }

    return null;
  },
});
