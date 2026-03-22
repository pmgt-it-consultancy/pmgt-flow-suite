import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { getCategoryChain } from "./lib/categoryHelpers";
import { requirePermission } from "./lib/permissions";

// List products for a store
export const list = query({
  args: {
    storeId: v.id("stores"),
    categoryId: v.optional(v.id("categories")),
    includeInactive: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("products"),
      storeId: v.id("stores"),
      name: v.string(),
      categoryId: v.id("categories"),
      categoryName: v.string(),
      price: v.number(),
      isVatable: v.boolean(),
      isActive: v.boolean(),
      sortOrder: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
      hasModifiers: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get products
    let products: Doc<"products">[];

    if (args.categoryId) {
      const categoryId = args.categoryId;
      products = await ctx.db
        .query("products")
        .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
        .collect();
    } else {
      products = await ctx.db
        .query("products")
        .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
        .collect();
    }

    // Filter by active status if needed
    if (!args.includeInactive) {
      products = products.filter((p) => p.isActive);
    }

    // Sort by sortOrder
    products.sort((a, b) => a.sortOrder - b.sortOrder);

    // Add category names
    const productsWithCategories = await Promise.all(
      products.map(async (product) => {
        const category = await ctx.db.get(product.categoryId);
        // Check product-level first
        const productModAssignment = await ctx.db
          .query("modifierGroupAssignments")
          .withIndex("by_product", (q) => q.eq("productId", product._id))
          .first();

        let hasModifiers = productModAssignment !== null;
        if (!hasModifiers) {
          const categoryChain = await getCategoryChain(ctx, product.categoryId);
          for (const catId of categoryChain) {
            const catAssignment = await ctx.db
              .query("modifierGroupAssignments")
              .withIndex("by_category", (q) => q.eq("categoryId", catId))
              .first();
            if (catAssignment) {
              hasModifiers = true;
              break;
            }
          }
        }

        return {
          _id: product._id,
          storeId: product.storeId,
          name: product.name,
          categoryId: product.categoryId,
          categoryName: category?.name ?? "Unknown",
          price: product.price,
          isVatable: product.isVatable,
          isActive: product.isActive,
          sortOrder: product.sortOrder,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          hasModifiers,
        };
      }),
    );

    return productsWithCategories;
  },
});

// Get single product
export const get = query({
  args: {
    productId: v.id("products"),
  },
  returns: v.union(
    v.object({
      _id: v.id("products"),
      storeId: v.id("stores"),
      name: v.string(),
      categoryId: v.id("categories"),
      price: v.number(),
      isVatable: v.boolean(),
      isActive: v.boolean(),
      sortOrder: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    const product = await ctx.db.get(args.productId);
    return product;
  },
});

// Create product
export const create = mutation({
  args: {
    storeId: v.id("stores"),
    name: v.string(),
    categoryId: v.id("categories"),
    price: v.number(),
    isVatable: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    isOpenPrice: v.optional(v.boolean()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
  },
  returns: v.id("products"),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    // Check permission
    await requirePermission(ctx, user._id, "products.manage");

    // Validate open price fields
    if (args.isOpenPrice) {
      if (args.minPrice === undefined || args.maxPrice === undefined) {
        throw new Error("minPrice and maxPrice are required for open-price products");
      }
      if (args.minPrice < 0) {
        throw new Error("minPrice must be >= 0");
      }
      if (args.minPrice >= args.maxPrice) {
        throw new Error("minPrice must be less than maxPrice");
      }
    }

    // Validate category belongs to same store
    const category = await ctx.db.get(args.categoryId);
    if (!category || category.storeId !== args.storeId) {
      throw new Error("Invalid category for this store");
    }

    // Get store to check VAT rate
    const store = await ctx.db.get(args.storeId);
    if (!store) {
      throw new Error("Store not found");
    }

    // Default isVatable based on store's VAT rate (non-vatable if store has 0% VAT)
    const defaultIsVatable = store.vatRate > 0;

    // Determine sort order
    let sortOrder = args.sortOrder;
    if (sortOrder === undefined) {
      const existingProducts = await ctx.db
        .query("products")
        .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
        .collect();

      sortOrder =
        existingProducts.length > 0 ? Math.max(...existingProducts.map((p) => p.sortOrder)) + 1 : 0;
    }

    const now = Date.now();

    return await ctx.db.insert("products", {
      storeId: args.storeId,
      name: args.name,
      categoryId: args.categoryId,
      price: args.isOpenPrice ? 0 : args.price,
      isVatable: args.isVatable ?? defaultIsVatable, // Default based on store's VAT rate
      isActive: true,
      isOpenPrice: args.isOpenPrice ?? false,
      minPrice: args.isOpenPrice ? args.minPrice : undefined,
      maxPrice: args.isOpenPrice ? args.maxPrice : undefined,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update product
export const update = mutation({
  args: {
    productId: v.id("products"),
    name: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    price: v.optional(v.number()),
    isVatable: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    isOpenPrice: v.optional(v.boolean()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    await requirePermission(ctx, user._id, "products.manage");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Product not found");

    // If changing category, validate it belongs to same store
    if (args.categoryId) {
      const category = await ctx.db.get(args.categoryId);
      if (!category || category.storeId !== product.storeId) {
        throw new Error("Invalid category for this store");
      }
    }

    // Determine effective open price state
    const effectiveIsOpenPrice = args.isOpenPrice ?? product.isOpenPrice ?? false;

    if (effectiveIsOpenPrice) {
      const effectiveMinPrice = args.minPrice ?? product.minPrice;
      const effectiveMaxPrice = args.maxPrice ?? product.maxPrice;

      if (effectiveMinPrice === undefined || effectiveMaxPrice === undefined) {
        throw new Error("minPrice and maxPrice are required for open-price products");
      }
      if (effectiveMinPrice < 0) {
        throw new Error("minPrice must be >= 0");
      }
      if (effectiveMinPrice >= effectiveMaxPrice) {
        throw new Error("minPrice must be less than maxPrice");
      }
    }

    const { productId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );

    // When turning off open price, clear minPrice and maxPrice
    if (args.isOpenPrice === false) {
      await ctx.db.patch(productId, {
        ...filteredUpdates,
        minPrice: undefined,
        maxPrice: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(productId, {
        ...filteredUpdates,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

// Bulk update prices
export const bulkUpdatePrices = mutation({
  args: {
    updates: v.array(
      v.object({
        productId: v.id("products"),
        price: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    await requirePermission(ctx, user._id, "products.manage");

    const now = Date.now();
    for (const update of args.updates) {
      await ctx.db.patch(update.productId, {
        price: update.price,
        updatedAt: now,
      });
    }

    return null;
  },
});

// Reorder products within category
export const reorder = mutation({
  args: {
    productIds: v.array(v.id("products")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    await requirePermission(ctx, user._id, "products.manage");

    // Update sortOrder for each product
    const now = Date.now();
    for (let i = 0; i < args.productIds.length; i++) {
      await ctx.db.patch(args.productIds[i], {
        sortOrder: i,
        updatedAt: now,
      });
    }

    return null;
  },
});

// Search products
export const search = query({
  args: {
    storeId: v.id("stores"),
    searchTerm: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("products"),
      name: v.string(),
      categoryId: v.id("categories"),
      categoryName: v.string(),
      price: v.number(),
      isVatable: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get active products for the store
    const products = await ctx.db
      .query("products")
      .withIndex("by_store_active", (q) => q.eq("storeId", args.storeId).eq("isActive", true))
      .collect();

    // Filter by search term (case-insensitive)
    const searchLower = args.searchTerm.toLowerCase();
    const filtered = products.filter((p) => p.name.toLowerCase().includes(searchLower));

    // Limit results
    const limited = args.limit ? filtered.slice(0, args.limit) : filtered;

    // Add category names
    const results = await Promise.all(
      limited.map(async (product) => {
        const category = await ctx.db.get(product.categoryId);
        return {
          _id: product._id,
          name: product.name,
          categoryId: product.categoryId,
          categoryName: category?.name ?? "Unknown",
          price: product.price,
          isVatable: product.isVatable,
        };
      }),
    );

    return results;
  },
});

// Get products by category with grouping
export const getByCategory = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      categoryId: v.id("categories"),
      categoryName: v.string(),
      parentCategoryName: v.optional(v.string()),
      products: v.array(
        v.object({
          _id: v.id("products"),
          name: v.string(),
          price: v.number(),
          isVatable: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get active categories for the store
    const categories = await ctx.db
      .query("categories")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Get active products for the store
    const products = await ctx.db
      .query("products")
      .withIndex("by_store_active", (q) => q.eq("storeId", args.storeId).eq("isActive", true))
      .collect();

    // Group products by category
    const result = await Promise.all(
      categories
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(async (category) => {
          const categoryProducts = products
            .filter((p) => p.categoryId === category._id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((p) => ({
              _id: p._id,
              name: p.name,
              price: p.price,
              isVatable: p.isVatable,
            }));

          // Get parent category name if exists
          let parentCategoryName: string | undefined;
          if (category.parentId) {
            const parentCategory = await ctx.db.get(category.parentId);
            parentCategoryName = parentCategory?.name;
          }

          return {
            categoryId: category._id,
            categoryName: category.name,
            parentCategoryName,
            products: categoryProducts,
          };
        }),
    );

    // Filter out empty categories
    return result.filter((r) => r.products.length > 0);
  },
});
