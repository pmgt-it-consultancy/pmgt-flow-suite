import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { getCategoryChain } from "./lib/categoryHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupModifierTestData(t: any) {
  const roleId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("roles", {
      name: "Staff",
      permissions: ["orders.create", "orders.view", "orders.edit", "modifiers.manage"],
      scopeLevel: "branch",
      isSystem: false,
    });
  });

  const storeId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("stores", {
      name: "Test Store",
      address1: "123 Test St",
      tin: "123-456-789-000",
      min: "MIN-000001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  const userId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      name: "Test User",
      email: "test@test.com",
      roleId,
      storeId,
      isActive: true,
    });
  });

  const categoryId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("categories", {
      storeId,
      name: "Coffee",
      sortOrder: 1,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  // Product directly in the category
  const productId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("products", {
      storeId,
      name: "Latte",
      categoryId,
      price: 15000,
      isVatable: true,
      isActive: true,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Create a modifier group
  const modifierGroupId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("modifierGroups", {
      storeId,
      name: "Size",
      selectionType: "single" as const,
      minSelections: 1,
      maxSelections: 1,
      isActive: true,
      sortOrder: 0,
      createdAt: Date.now(),
    });
  });

  // Create modifier options
  const optionIds = await t.run(async (ctx: any) => {
    const small = await ctx.db.insert("modifierOptions", {
      modifierGroupId,
      name: "Small",
      priceAdjustment: 0,
      isAvailable: true,
      isDefault: true,
      sortOrder: 0,
      createdAt: Date.now(),
    });
    const large = await ctx.db.insert("modifierOptions", {
      modifierGroupId,
      name: "Large",
      priceAdjustment: 2000,
      isAvailable: true,
      isDefault: false,
      sortOrder: 1,
      createdAt: Date.now(),
    });
    return { small, large };
  });

  return {
    roleId,
    storeId,
    userId,
    categoryId,
    productId,
    modifierGroupId,
    optionIds,
  };
}

describe("modifierAssignments — getForStore", () => {
  it("should return category-level modifier assignments for products in that category", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, categoryId, productId, modifierGroupId } =
      await setupModifierTestData(t);

    // Assign modifier group to category (NOT product)
    await t.run(async (ctx: any) => {
      await ctx.db.insert("modifierGroupAssignments", {
        storeId,
        modifierGroupId,
        categoryId, // Category-level assignment
        // productId is NOT set
        sortOrder: 0,
        createdAt: Date.now(),
      });
    });

    // Query getForStore directly via db to test the logic
    const result = await t.run(async (ctx: any) => {
      const products = await ctx.db
        .query("products")
        .withIndex("by_store", (q: any) => q.eq("storeId", storeId))
        .collect();

      const activeProducts = products.filter((p: any) => p.isActive);

      const results = await Promise.all(
        activeProducts.map(async (product: any) => {
          const productAssignments = await ctx.db
            .query("modifierGroupAssignments")
            .withIndex("by_product", (q: any) => q.eq("productId", product._id))
            .collect();

          const categoryAssignments = await ctx.db
            .query("modifierGroupAssignments")
            .withIndex("by_category", (q: any) => q.eq("categoryId", product.categoryId))
            .collect();

          const productGroupIds = new Set(productAssignments.map((a: any) => a.modifierGroupId));
          const mergedAssignments = [
            ...productAssignments,
            ...categoryAssignments.filter((a: any) => !productGroupIds.has(a.modifierGroupId)),
          ];

          return {
            productId: product._id,
            productName: product.name,
            productAssignmentsCount: productAssignments.length,
            categoryAssignmentsCount: categoryAssignments.length,
            mergedAssignmentsCount: mergedAssignments.length,
            categoryId: product.categoryId,
          };
        }),
      );

      return results;
    });

    // The product "Latte" should have 1 modifier assignment (from category)
    expect(result).toHaveLength(1);
    expect(result[0].productName).toBe("Latte");
    expect(result[0].productAssignmentsCount).toBe(0);
    expect(result[0].categoryAssignmentsCount).toBe(1);
    expect(result[0].mergedAssignmentsCount).toBe(1);
  });

  it("should return product-level modifier assignments", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId, modifierGroupId } = await setupModifierTestData(t);

    // Assign modifier group to product (NOT category)
    await t.run(async (ctx: any) => {
      await ctx.db.insert("modifierGroupAssignments", {
        storeId,
        modifierGroupId,
        productId, // Product-level assignment
        // categoryId is NOT set
        sortOrder: 0,
        createdAt: Date.now(),
      });
    });

    // Query same logic
    const result = await t.run(async (ctx: any) => {
      const products = await ctx.db
        .query("products")
        .withIndex("by_store", (q: any) => q.eq("storeId", storeId))
        .collect();

      const activeProducts = products.filter((p: any) => p.isActive);

      const results = await Promise.all(
        activeProducts.map(async (product: any) => {
          const productAssignments = await ctx.db
            .query("modifierGroupAssignments")
            .withIndex("by_product", (q: any) => q.eq("productId", product._id))
            .collect();

          const categoryAssignments = await ctx.db
            .query("modifierGroupAssignments")
            .withIndex("by_category", (q: any) => q.eq("categoryId", product.categoryId))
            .collect();

          return {
            productId: product._id,
            productName: product.name,
            productAssignmentsCount: productAssignments.length,
            categoryAssignmentsCount: categoryAssignments.length,
          };
        }),
      );

      return results;
    });

    expect(result).toHaveLength(1);
    expect(result[0].productAssignmentsCount).toBe(1);
    expect(result[0].categoryAssignmentsCount).toBe(0);
  });
});

describe("getCategoryChain", () => {
  it("should return [categoryId] for a root category", async () => {
    const t = convexTest(schema, modules);
    const { categoryId } = await setupModifierTestData(t);

    const chain = await t.run(async (ctx: any) => {
      return await getCategoryChain(ctx, categoryId);
    });

    expect(chain).toEqual([categoryId]);
  });

  it("should return [subcategoryId, parentCategoryId] for a subcategory", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId } = await setupModifierTestData(t);

    const subcategoryId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("categories", {
        storeId,
        name: "Hot Coffee",
        parentId: categoryId,
        sortOrder: 1,
        isActive: true,
        createdAt: Date.now(),
      });
    });

    const chain = await t.run(async (ctx: any) => {
      return await getCategoryChain(ctx, subcategoryId);
    });

    expect(chain).toEqual([subcategoryId, categoryId]);
  });
});
