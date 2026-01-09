import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { requirePermission } from "./lib/permissions";

// List categories for a store
export const list = query({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
    parentId: v.optional(v.id("categories")),
    includeInactive: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("categories"),
      storeId: v.id("stores"),
      name: v.string(),
      parentId: v.optional(v.id("categories")),
      sortOrder: v.number(),
      isActive: v.boolean(),
      createdAt: v.number(),
      productCount: v.number(),
      subcategoryCount: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    // Get categories for the store
    let categories: Doc<"categories">[];

    if (args.parentId !== undefined) {
      // Get categories with specific parent
      categories = await ctx.db
        .query("categories")
        .withIndex("by_store_parent", (q) =>
          q.eq("storeId", args.storeId).eq("parentId", args.parentId)
        )
        .collect();
    } else {
      // Get all categories for store
      categories = await ctx.db
        .query("categories")
        .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
        .collect();
    }

    // Filter by active status if needed
    if (!args.includeInactive) {
      categories = categories.filter((c) => c.isActive);
    }

    // Sort by sortOrder
    categories.sort((a, b) => a.sortOrder - b.sortOrder);

    // Add product count and subcategory count
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        const products = await ctx.db
          .query("products")
          .withIndex("by_category", (q) => q.eq("categoryId", category._id))
          .collect();

        const subcategories = await ctx.db
          .query("categories")
          .withIndex("by_parent", (q) => q.eq("parentId", category._id))
          .collect();

        return {
          _id: category._id,
          storeId: category.storeId,
          name: category.name,
          parentId: category.parentId,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          createdAt: category.createdAt,
          productCount: products.length,
          subcategoryCount: subcategories.length,
        };
      })
    );

    return categoriesWithCounts;
  },
});

// Get single category
export const get = query({
  args: {
    token: v.string(),
    categoryId: v.id("categories"),
  },
  returns: v.union(
    v.object({
      _id: v.id("categories"),
      storeId: v.id("stores"),
      name: v.string(),
      parentId: v.optional(v.id("categories")),
      sortOrder: v.number(),
      isActive: v.boolean(),
      createdAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    const category = await ctx.db.get(args.categoryId);
    return category;
  },
});

// Create category
export const create = mutation({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    sortOrder: v.optional(v.number()),
  },
  returns: v.id("categories"),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    const user = await ctx.db.get(session.userId);
    if (!user) throw new Error("User not found");

    // Check permission
    await requirePermission(ctx, user._id, "categories.manage");

    // Determine sort order
    let sortOrder = args.sortOrder;
    if (sortOrder === undefined) {
      // Get max sortOrder for the store/parent combination
      const existingCategories = await ctx.db
        .query("categories")
        .withIndex("by_store_parent", (q) =>
          q.eq("storeId", args.storeId).eq("parentId", args.parentId)
        )
        .collect();

      sortOrder =
        existingCategories.length > 0
          ? Math.max(...existingCategories.map((c) => c.sortOrder)) + 1
          : 0;
    }

    return await ctx.db.insert("categories", {
      storeId: args.storeId,
      name: args.name,
      parentId: args.parentId,
      sortOrder,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

// Update category
export const update = mutation({
  args: {
    token: v.string(),
    categoryId: v.id("categories"),
    name: v.optional(v.string()),
    parentId: v.optional(v.id("categories")),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    const user = await ctx.db.get(session.userId);
    if (!user) throw new Error("User not found");

    await requirePermission(ctx, user._id, "categories.manage");

    // Prevent circular references
    if (args.parentId) {
      const category = await ctx.db.get(args.categoryId);
      if (args.parentId === args.categoryId) {
        throw new Error("Category cannot be its own parent");
      }
      // Check if parentId would create a cycle
      let parent = await ctx.db.get(args.parentId);
      while (parent && parent.parentId) {
        if (parent.parentId === args.categoryId) {
          throw new Error("Circular reference detected in category hierarchy");
        }
        parent = await ctx.db.get(parent.parentId);
      }
    }

    const { token, categoryId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    await ctx.db.patch(categoryId, filteredUpdates);
    return null;
  },
});

// Reorder categories
export const reorder = mutation({
  args: {
    token: v.string(),
    categoryIds: v.array(v.id("categories")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    const user = await ctx.db.get(session.userId);
    if (!user) throw new Error("User not found");

    await requirePermission(ctx, user._id, "categories.manage");

    // Update sortOrder for each category
    for (let i = 0; i < args.categoryIds.length; i++) {
      await ctx.db.patch(args.categoryIds[i], { sortOrder: i });
    }

    return null;
  },
});

// Get category tree (hierarchical)
export const getTree = query({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
    includeInactive: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("categories"),
      name: v.string(),
      sortOrder: v.number(),
      isActive: v.boolean(),
      productCount: v.number(),
      children: v.array(
        v.object({
          _id: v.id("categories"),
          name: v.string(),
          sortOrder: v.number(),
          isActive: v.boolean(),
          productCount: v.number(),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    // Get all categories for the store
    let allCategories = await ctx.db
      .query("categories")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .collect();

    if (!args.includeInactive) {
      allCategories = allCategories.filter((c) => c.isActive);
    }

    // Get root categories (no parent)
    const rootCategories = allCategories
      .filter((c) => !c.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Build tree
    const tree = await Promise.all(
      rootCategories.map(async (parent) => {
        // Get products for this category
        const products = await ctx.db
          .query("products")
          .withIndex("by_category", (q) => q.eq("categoryId", parent._id))
          .collect();

        // Get children
        const children = allCategories
          .filter((c) => c.parentId === parent._id)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const childrenWithCounts = await Promise.all(
          children.map(async (child) => {
            const childProducts = await ctx.db
              .query("products")
              .withIndex("by_category", (q) => q.eq("categoryId", child._id))
              .collect();

            return {
              _id: child._id,
              name: child.name,
              sortOrder: child.sortOrder,
              isActive: child.isActive,
              productCount: childProducts.length,
            };
          })
        );

        return {
          _id: parent._id,
          name: parent.name,
          sortOrder: parent.sortOrder,
          isActive: parent.isActive,
          productCount: products.length,
          children: childrenWithCounts,
        };
      })
    );

    return tree;
  },
});
