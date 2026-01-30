import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requirePermission } from "./lib/permissions";

// List modifier groups for a store
export const list = query({
  args: {
    storeId: v.id("stores"),
    includeInactive: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("modifierGroups"),
      storeId: v.id("stores"),
      name: v.string(),
      selectionType: v.union(v.literal("single"), v.literal("multi")),
      minSelections: v.number(),
      maxSelections: v.optional(v.number()),
      sortOrder: v.number(),
      isActive: v.boolean(),
      createdAt: v.number(),
      optionCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    let groups: Doc<"modifierGroups">[];

    if (args.includeInactive) {
      groups = await ctx.db
        .query("modifierGroups")
        .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
        .collect();
    } else {
      groups = await ctx.db
        .query("modifierGroups")
        .withIndex("by_store_active", (q) => q.eq("storeId", args.storeId).eq("isActive", true))
        .collect();
    }

    groups.sort((a, b) => a.sortOrder - b.sortOrder);

    const groupsWithCounts = await Promise.all(
      groups.map(async (group) => {
        const options = await ctx.db
          .query("modifierOptions")
          .withIndex("by_group", (q) => q.eq("modifierGroupId", group._id))
          .collect();

        return {
          _id: group._id,
          storeId: group.storeId,
          name: group.name,
          selectionType: group.selectionType,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          sortOrder: group.sortOrder,
          isActive: group.isActive,
          createdAt: group.createdAt,
          optionCount: options.length,
        };
      }),
    );

    return groupsWithCounts;
  },
});

// Get single modifier group with its options
export const get = query({
  args: {
    modifierGroupId: v.id("modifierGroups"),
  },
  returns: v.union(
    v.object({
      _id: v.id("modifierGroups"),
      storeId: v.id("stores"),
      name: v.string(),
      selectionType: v.union(v.literal("single"), v.literal("multi")),
      minSelections: v.number(),
      maxSelections: v.optional(v.number()),
      sortOrder: v.number(),
      isActive: v.boolean(),
      createdAt: v.number(),
      options: v.array(
        v.object({
          _id: v.id("modifierOptions"),
          name: v.string(),
          priceAdjustment: v.number(),
          isDefault: v.boolean(),
          isAvailable: v.boolean(),
          sortOrder: v.number(),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const group = await ctx.db.get(args.modifierGroupId);
    if (!group) return null;

    const options = await ctx.db
      .query("modifierOptions")
      .withIndex("by_group", (q) => q.eq("modifierGroupId", group._id))
      .collect();

    options.sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      _id: group._id,
      storeId: group.storeId,
      name: group.name,
      selectionType: group.selectionType,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      sortOrder: group.sortOrder,
      isActive: group.isActive,
      createdAt: group.createdAt,
      options: options.map((o) => ({
        _id: o._id,
        name: o.name,
        priceAdjustment: o.priceAdjustment,
        isDefault: o.isDefault,
        isAvailable: o.isAvailable,
        sortOrder: o.sortOrder,
      })),
    };
  },
});

// Create modifier group
export const create = mutation({
  args: {
    storeId: v.id("stores"),
    name: v.string(),
    selectionType: v.union(v.literal("single"), v.literal("multi")),
    minSelections: v.number(),
    maxSelections: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.id("modifierGroups"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    let sortOrder = args.sortOrder;
    if (sortOrder === undefined) {
      const existing = await ctx.db
        .query("modifierGroups")
        .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
        .collect();

      sortOrder = existing.length > 0 ? Math.max(...existing.map((g) => g.sortOrder)) + 1 : 0;
    }

    return await ctx.db.insert("modifierGroups", {
      storeId: args.storeId,
      name: args.name,
      selectionType: args.selectionType,
      minSelections: args.minSelections,
      maxSelections: args.maxSelections,
      sortOrder,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

// Update modifier group
export const update = mutation({
  args: {
    modifierGroupId: v.id("modifierGroups"),
    name: v.optional(v.string()),
    selectionType: v.optional(v.union(v.literal("single"), v.literal("multi"))),
    minSelections: v.optional(v.number()),
    maxSelections: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    const { modifierGroupId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );

    await ctx.db.patch(modifierGroupId, filteredUpdates);
    return null;
  },
});

// Reorder modifier groups
export const reorder = mutation({
  args: {
    modifierGroupIds: v.array(v.id("modifierGroups")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    for (let i = 0; i < args.modifierGroupIds.length; i++) {
      await ctx.db.patch(args.modifierGroupIds[i], { sortOrder: i });
    }

    return null;
  },
});
