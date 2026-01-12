import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

// Log an audit event
export const log = mutation({
  args: {
    storeId: v.id("stores"),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    details: v.optional(v.string()),
  },
  returns: v.id("auditLogs"),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    return await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      details: args.details ?? "",
      userId: user._id,
      createdAt: Date.now(),
    });
  },
});

// Get audit logs for a store
export const list = query({
  args: {
    storeId: v.id("stores"),
    action: v.optional(v.string()),
    entityType: v.optional(v.string()),
    limit: v.optional(v.number()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("auditLogs"),
      action: v.string(),
      entityType: v.string(),
      entityId: v.string(),
      details: v.string(),
      userName: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Build query
    let logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .collect();

    // Filter by action if specified
    if (args.action) {
      logs = logs.filter((l) => l.action === args.action);
    }

    // Filter by entity type if specified
    if (args.entityType) {
      logs = logs.filter((l) => l.entityType === args.entityType);
    }

    // Filter by date range
    if (args.startDate) {
      logs = logs.filter((l) => l.createdAt >= args.startDate!);
    }
    if (args.endDate) {
      logs = logs.filter((l) => l.createdAt <= args.endDate!);
    }

    // Apply limit
    if (args.limit) {
      logs = logs.slice(0, args.limit);
    }

    // Get user names
    const results = await Promise.all(
      logs.map(async (log) => {
        const user = await ctx.db.get(log.userId);
        return {
          _id: log._id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          details: log.details,
          userName: user?.name ?? "Unknown",
          createdAt: log.createdAt,
        };
      }),
    );

    return results;
  },
});

// Get audit logs for a specific entity
export const getByEntity = query({
  args: {
    entityType: v.string(),
    entityId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("auditLogs"),
      storeId: v.id("stores"),
      action: v.string(),
      details: v.string(),
      userName: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get logs for entity
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_entity", (q) =>
        q.eq("entityType", args.entityType).eq("entityId", args.entityId),
      )
      .order("desc")
      .take(args.limit ?? 50);

    // Get user names
    const results = await Promise.all(
      logs.map(async (log) => {
        const user = await ctx.db.get(log.userId);
        return {
          _id: log._id,
          storeId: log.storeId,
          action: log.action,
          details: log.details,
          userName: user?.name ?? "Unknown",
          createdAt: log.createdAt,
        };
      }),
    );

    return results;
  },
});

// Get void-related audit logs (for reporting)
export const getVoidLogs = query({
  args: {
    storeId: v.id("stores"),
    startDate: v.number(),
    endDate: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("auditLogs"),
      action: v.string(),
      entityId: v.string(),
      details: v.string(),
      userName: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get void logs for store
    const allLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .collect();

    // Filter to void actions in date range
    const voidLogs = allLogs.filter(
      (l) =>
        (l.action === "void_item" || l.action === "void_order") &&
        l.createdAt >= args.startDate &&
        l.createdAt <= args.endDate,
    );

    // Get user names
    const results = await Promise.all(
      voidLogs.map(async (log) => {
        const user = await ctx.db.get(log.userId);
        return {
          _id: log._id,
          action: log.action,
          entityId: log.entityId,
          details: log.details,
          userName: user?.name ?? "Unknown",
          createdAt: log.createdAt,
        };
      }),
    );

    return results;
  },
});

// Get discount-related audit logs (for reporting)
export const getDiscountLogs = query({
  args: {
    storeId: v.id("stores"),
    startDate: v.number(),
    endDate: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("auditLogs"),
      action: v.string(),
      entityId: v.string(),
      details: v.string(),
      userName: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get discount logs for store
    const allLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .collect();

    // Filter to discount actions in date range
    const discountLogs = allLogs.filter(
      (l) =>
        (l.action === "apply_discount" || l.action === "remove_discount") &&
        l.createdAt >= args.startDate &&
        l.createdAt <= args.endDate,
    );

    // Get user names
    const results = await Promise.all(
      discountLogs.map(async (log) => {
        const user = await ctx.db.get(log.userId);
        return {
          _id: log._id,
          action: log.action,
          entityId: log.entityId,
          details: log.details,
          userName: user?.name ?? "Unknown",
          createdAt: log.createdAt,
        };
      }),
    );

    return results;
  },
});

// Summary of actions by user (for accountability)
export const getUserActionSummary = query({
  args: {
    storeId: v.id("stores"),
    startDate: v.number(),
    endDate: v.number(),
  },
  returns: v.array(
    v.object({
      userId: v.id("users"),
      userName: v.string(),
      voidCount: v.number(),
      voidAmount: v.number(),
      discountCount: v.number(),
      discountAmount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get logs for store in date range
    const allLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .collect();

    const filteredLogs = allLogs.filter(
      (l) => l.createdAt >= args.startDate && l.createdAt <= args.endDate,
    );

    // Group by user
    const userMap = new Map<
      string,
      { voidCount: number; voidAmount: number; discountCount: number; discountAmount: number }
    >();

    for (const log of filteredLogs) {
      const userId = log.userId;
      if (!userMap.has(userId)) {
        userMap.set(userId, {
          voidCount: 0,
          voidAmount: 0,
          discountCount: 0,
          discountAmount: 0,
        });
      }

      const summary = userMap.get(userId)!;

      if (log.action === "void_item" || log.action === "void_order") {
        summary.voidCount++;
        try {
          const details = JSON.parse(log.details);
          summary.voidAmount += details.amount ?? 0;
        } catch {
          // Ignore parse errors
        }
      } else if (log.action === "apply_discount") {
        summary.discountCount++;
        try {
          const details = JSON.parse(log.details);
          summary.discountAmount += details.amount ?? 0;
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Get user names and build results
    const results = await Promise.all(
      Array.from(userMap.entries()).map(async ([userId, summary]) => {
        const userIdTyped = userId as Id<"users">;
        const user = await ctx.db.get(userIdTyped);
        const userName = user?.name ?? "Unknown";
        return {
          userId: userIdTyped,
          userName,
          voidCount: summary.voidCount,
          voidAmount: summary.voidAmount,
          discountCount: summary.discountCount,
          discountAmount: summary.discountAmount,
        };
      }),
    );

    return results.filter((r) => r.voidCount > 0 || r.discountCount > 0);
  },
});
