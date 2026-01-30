import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requirePermission } from "./lib/permissions";

// List modifier options for a group
export const list = query({
  args: {
    modifierGroupId: v.id("modifierGroups"),
    availableOnly: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("modifierOptions"),
      modifierGroupId: v.id("modifierGroups"),
      name: v.string(),
      priceAdjustment: v.number(),
      isDefault: v.boolean(),
      isAvailable: v.boolean(),
      sortOrder: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    let options: Doc<"modifierOptions">[] = [];
    if (args.availableOnly) {
      options = await ctx.db
        .query("modifierOptions")
        .withIndex("by_group_available", (q) =>
          q.eq("modifierGroupId", args.modifierGroupId).eq("isAvailable", true),
        )
        .collect();
    } else {
      options = await ctx.db
        .query("modifierOptions")
        .withIndex("by_group", (q) => q.eq("modifierGroupId", args.modifierGroupId))
        .collect();
    }

    options.sort((a, b) => a.sortOrder - b.sortOrder);

    return options.map((o) => ({
      _id: o._id,
      modifierGroupId: o.modifierGroupId,
      name: o.name,
      priceAdjustment: o.priceAdjustment,
      isDefault: o.isDefault,
      isAvailable: o.isAvailable,
      sortOrder: o.sortOrder,
      createdAt: o.createdAt,
    }));
  },
});

// Create modifier option
export const create = mutation({
  args: {
    modifierGroupId: v.id("modifierGroups"),
    name: v.string(),
    priceAdjustment: v.number(),
    isDefault: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.id("modifierOptions"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    // Validate group exists
    const group = await ctx.db.get(args.modifierGroupId);
    if (!group) throw new Error("Modifier group not found");

    let sortOrder = args.sortOrder;
    if (sortOrder === undefined) {
      const existing = await ctx.db
        .query("modifierOptions")
        .withIndex("by_group", (q) => q.eq("modifierGroupId", args.modifierGroupId))
        .collect();

      sortOrder = existing.length > 0 ? Math.max(...existing.map((o) => o.sortOrder)) + 1 : 0;
    }

    return await ctx.db.insert("modifierOptions", {
      modifierGroupId: args.modifierGroupId,
      name: args.name,
      priceAdjustment: args.priceAdjustment,
      isDefault: args.isDefault ?? false,
      isAvailable: true,
      sortOrder,
      createdAt: Date.now(),
    });
  },
});

// Update modifier option
export const update = mutation({
  args: {
    modifierOptionId: v.id("modifierOptions"),
    name: v.optional(v.string()),
    priceAdjustment: v.optional(v.number()),
    isDefault: v.optional(v.boolean()),
    isAvailable: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    const { modifierOptionId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );

    await ctx.db.patch(modifierOptionId, filteredUpdates);
    return null;
  },
});

// Reorder modifier options
export const reorder = mutation({
  args: {
    modifierOptionIds: v.array(v.id("modifierOptions")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    for (let i = 0; i < args.modifierOptionIds.length; i++) {
      await ctx.db.patch(args.modifierOptionIds[i], { sortOrder: i });
    }

    return null;
  },
});

// Toggle availability (quick out-of-stock toggle)
export const toggleAvailability = mutation({
  args: {
    modifierOptionId: v.id("modifierOptions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    const option = await ctx.db.get(args.modifierOptionId);
    if (!option) throw new Error("Modifier option not found");

    await ctx.db.patch(args.modifierOptionId, {
      isAvailable: !option.isAvailable,
    });

    return null;
  },
});
