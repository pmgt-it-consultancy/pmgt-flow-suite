import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { getCategoryChain } from "./lib/categoryHelpers";
import { requirePermission } from "./lib/permissions";

// Assign a modifier group to a product or category
export const assign = mutation({
  args: {
    storeId: v.id("stores"),
    modifierGroupId: v.id("modifierGroups"),
    productId: v.optional(v.id("products")),
    categoryId: v.optional(v.id("categories")),
    sortOrder: v.optional(v.number()),
    minSelectionsOverride: v.optional(v.number()),
    maxSelectionsOverride: v.optional(v.number()),
  },
  returns: v.id("modifierGroupAssignments"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    // Validate exactly one of productId/categoryId is set
    if (args.productId && args.categoryId) {
      throw new Error("Cannot assign to both a product and a category");
    }
    if (!args.productId && !args.categoryId) {
      throw new Error("Must assign to either a product or a category");
    }

    // Validate modifier group exists
    const group = await ctx.db.get(args.modifierGroupId);
    if (!group) throw new Error("Modifier group not found");

    // Check for duplicate assignment
    if (args.productId) {
      const existing = await ctx.db
        .query("modifierGroupAssignments")
        .withIndex("by_product", (q) => q.eq("productId", args.productId))
        .collect();
      if (existing.some((a) => a.modifierGroupId === args.modifierGroupId)) {
        throw new Error("This modifier group is already assigned to this product");
      }
    }
    if (args.categoryId) {
      const existing = await ctx.db
        .query("modifierGroupAssignments")
        .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
        .collect();
      if (existing.some((a) => a.modifierGroupId === args.modifierGroupId)) {
        throw new Error("This modifier group is already assigned to this category");
      }
    }

    // Determine sort order
    let sortOrder = args.sortOrder;
    if (sortOrder === undefined) {
      let existing: Doc<"modifierGroupAssignments">[] = [];
      if (args.productId) {
        existing = await ctx.db
          .query("modifierGroupAssignments")
          .withIndex("by_product", (q) => q.eq("productId", args.productId))
          .collect();
      } else {
        existing = await ctx.db
          .query("modifierGroupAssignments")
          .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
          .collect();
      }
      sortOrder = existing.length > 0 ? Math.max(...existing.map((a) => a.sortOrder)) + 1 : 0;
    }

    return await ctx.db.insert("modifierGroupAssignments", {
      storeId: args.storeId,
      modifierGroupId: args.modifierGroupId,
      productId: args.productId,
      categoryId: args.categoryId,
      sortOrder,
      minSelectionsOverride: args.minSelectionsOverride,
      maxSelectionsOverride: args.maxSelectionsOverride,
      createdAt: Date.now(),
    });
  },
});

// Unassign a modifier group
export const unassign = mutation({
  args: {
    assignmentId: v.id("modifierGroupAssignments"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) throw new Error("Assignment not found");

    await ctx.db.delete(args.assignmentId);
    return null;
  },
});

// Update an assignment's overrides
export const updateAssignment = mutation({
  args: {
    assignmentId: v.id("modifierGroupAssignments"),
    sortOrder: v.optional(v.number()),
    minSelectionsOverride: v.optional(v.number()),
    maxSelectionsOverride: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requirePermission(ctx, user._id, "modifiers.manage");

    const { assignmentId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );

    await ctx.db.patch(assignmentId, filteredUpdates);
    return null;
  },
});

// Shared per-product modifier resolution used by both getForProduct and getForStore.
// Returns the resolved modifier groups (with options) for a single product.
// Inactive groups are filtered out. Products with no assignments return [].
async function fetchProductModifierGroups(
  ctx: QueryCtx,
  productId: Id<"products">,
): Promise<
  Array<{
    groupId: Id<"modifierGroups">;
    groupName: string;
    selectionType: "single" | "multi";
    minSelections: number;
    maxSelections: number | undefined;
    sortOrder: number;
    options: Array<{
      optionId: Id<"modifierOptions">;
      name: string;
      priceAdjustment: number;
      isDefault: boolean;
    }>;
  }>
> {
  const product = await ctx.db.get(productId);
  if (!product) return [];

  // 1. Get product-level assignments
  const productAssignments = await ctx.db
    .query("modifierGroupAssignments")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();

  // 2. Get category chain (direct category + parent if subcategory)
  const categoryChain = await getCategoryChain(ctx, product.categoryId);

  // 3. Merge with priority: product > direct category > parent category
  const seenGroupIds = new Set(productAssignments.map((a) => a.modifierGroupId));
  const mergedAssignments = [...productAssignments];

  for (const catId of categoryChain) {
    const catAssignments = await ctx.db
      .query("modifierGroupAssignments")
      .withIndex("by_category", (q) => q.eq("categoryId", catId))
      .collect();
    for (const a of catAssignments) {
      if (!seenGroupIds.has(a.modifierGroupId)) {
        mergedAssignments.push(a);
        seenGroupIds.add(a.modifierGroupId);
      }
    }
  }

  // Sort by assignment sortOrder
  mergedAssignments.sort((a, b) => a.sortOrder - b.sortOrder);

  // 4. Resolve each assignment to group + options
  const results = await Promise.all(
    mergedAssignments.map(async (assignment) => {
      const group = await ctx.db.get(assignment.modifierGroupId);
      if (!group || !group.isActive) return null;

      // Fetch available options
      const options = await ctx.db
        .query("modifierOptions")
        .withIndex("by_group_available", (q) =>
          q.eq("modifierGroupId", group._id).eq("isAvailable", true),
        )
        .collect();

      options.sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        groupId: group._id,
        groupName: group.name,
        selectionType: group.selectionType,
        minSelections: assignment.minSelectionsOverride ?? group.minSelections,
        maxSelections: assignment.maxSelectionsOverride ?? group.maxSelections,
        sortOrder: assignment.sortOrder,
        options: options.map((o) => ({
          optionId: o._id,
          name: o.name,
          priceAdjustment: o.priceAdjustment,
          isDefault: o.isDefault,
        })),
      };
    }),
  );

  // Filter out null (inactive groups)
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

// Get resolved modifier groups for a product (product-level + category-inherited)
export const getForProduct = query({
  args: {
    productId: v.id("products"),
  },
  returns: v.array(
    v.object({
      groupId: v.id("modifierGroups"),
      groupName: v.string(),
      selectionType: v.union(v.literal("single"), v.literal("multi")),
      minSelections: v.number(),
      maxSelections: v.optional(v.number()),
      sortOrder: v.number(),
      options: v.array(
        v.object({
          optionId: v.id("modifierOptions"),
          name: v.string(),
          priceAdjustment: v.number(),
          isDefault: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    return await fetchProductModifierGroups(ctx, args.productId);
  },
});

// Bulk-fetch modifier groups for all products in a store (used for POS prefetch)
export const getForStore = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      productId: v.id("products"),
      groups: v.array(
        v.object({
          groupId: v.id("modifierGroups"),
          groupName: v.string(),
          selectionType: v.union(v.literal("single"), v.literal("multi")),
          minSelections: v.number(),
          maxSelections: v.optional(v.number()),
          sortOrder: v.number(),
          options: v.array(
            v.object({
              optionId: v.id("modifierOptions"),
              name: v.string(),
              priceAdjustment: v.number(),
              isDefault: v.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    // Get all products for the store
    const products = await ctx.db
      .query("products")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .collect();

    const activeProducts = products.filter((p) => p.isActive);

    const results = await Promise.all(
      activeProducts.map(async (product) => {
        const groups = await fetchProductModifierGroups(ctx, product._id);
        // Preserve original behavior: skip products with no modifier groups at all
        if (groups.length === 0) return null;
        return { productId: product._id, groups };
      }),
    );

    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

// List assignments for a product
export const listForProduct = query({
  args: {
    productId: v.id("products"),
  },
  returns: v.array(
    v.object({
      _id: v.id("modifierGroupAssignments"),
      modifierGroupId: v.id("modifierGroups"),
      groupName: v.string(),
      sortOrder: v.number(),
      minSelectionsOverride: v.optional(v.number()),
      maxSelectionsOverride: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const assignments = await ctx.db
      .query("modifierGroupAssignments")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();

    assignments.sort((a, b) => a.sortOrder - b.sortOrder);

    const results = await Promise.all(
      assignments.map(async (a) => {
        const group = await ctx.db.get(a.modifierGroupId);
        return {
          _id: a._id,
          modifierGroupId: a.modifierGroupId,
          groupName: group?.name ?? "Unknown",
          sortOrder: a.sortOrder,
          minSelectionsOverride: a.minSelectionsOverride,
          maxSelectionsOverride: a.maxSelectionsOverride,
        };
      }),
    );

    return results;
  },
});

// List assignments for a category
export const listForCategory = query({
  args: {
    categoryId: v.id("categories"),
  },
  returns: v.array(
    v.object({
      _id: v.id("modifierGroupAssignments"),
      modifierGroupId: v.id("modifierGroups"),
      groupName: v.string(),
      sortOrder: v.number(),
      minSelectionsOverride: v.optional(v.number()),
      maxSelectionsOverride: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const assignments = await ctx.db
      .query("modifierGroupAssignments")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();

    assignments.sort((a, b) => a.sortOrder - b.sortOrder);

    const results = await Promise.all(
      assignments.map(async (a) => {
        const group = await ctx.db.get(a.modifierGroupId);
        return {
          _id: a._id,
          modifierGroupId: a.modifierGroupId,
          groupName: group?.name ?? "Unknown",
          sortOrder: a.sortOrder,
          minSelectionsOverride: a.minSelectionsOverride,
          maxSelectionsOverride: a.maxSelectionsOverride,
        };
      }),
    );

    return results;
  },
});
