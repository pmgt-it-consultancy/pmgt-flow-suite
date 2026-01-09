import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { requirePermission } from "./lib/permissions";

// List stores based on user scope
export const list = query({
  args: {
    token: v.string(),
    parentOnly: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("stores"),
      name: v.string(),
      parentId: v.optional(v.id("stores")),
      address1: v.string(),
      address2: v.optional(v.string()),
      tin: v.string(),
      min: v.string(),
      vatRate: v.number(),
      isActive: v.boolean(),
      createdAt: v.number(),
      branchCount: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Validate session and get user
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    const user = await ctx.db.get(session.userId);
    if (!user || !user.isActive) {
      throw new Error("User not found or inactive");
    }

    const role = await ctx.db.get(user.roleId);
    if (!role) {
      throw new Error("Role not found");
    }

    let stores: Doc<"stores">[] = [];

    if (role.scopeLevel === "system") {
      // Super Admin: all stores
      if (args.parentOnly) {
        stores = await ctx.db
          .query("stores")
          .filter((q) => q.eq(q.field("parentId"), undefined))
          .collect();
      } else {
        stores = await ctx.db.query("stores").collect();
      }
    } else if (role.scopeLevel === "parent" && user.storeId) {
      // Admin: parent store + branches
      const parentStore = await ctx.db.get(user.storeId);
      const branches = await ctx.db
        .query("stores")
        .withIndex("by_parent", (q) => q.eq("parentId", user.storeId))
        .collect();
      stores = parentStore ? [parentStore, ...branches] : branches;
    } else if (user.storeId) {
      // Manager/Staff: single store
      const store = await ctx.db.get(user.storeId);
      stores = store ? [store] : [];
    } else {
      stores = [];
    }

    // Add branch count
    const storesWithBranchCount = await Promise.all(
      stores.map(async (store) => {
        const branches = await ctx.db
          .query("stores")
          .withIndex("by_parent", (q) => q.eq("parentId", store._id))
          .collect();
        return {
          _id: store._id,
          name: store.name,
          parentId: store.parentId,
          address1: store.address1,
          address2: store.address2,
          tin: store.tin,
          min: store.min,
          vatRate: store.vatRate,
          isActive: store.isActive,
          createdAt: store.createdAt,
          branchCount: branches.length,
        };
      })
    );

    return storesWithBranchCount;
  },
});

// Get single store
export const get = query({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
  },
  returns: v.union(
    v.object({
      _id: v.id("stores"),
      name: v.string(),
      parentId: v.optional(v.id("stores")),
      logo: v.optional(v.id("_storage")),
      address1: v.string(),
      address2: v.optional(v.string()),
      tin: v.string(),
      min: v.string(),
      vatRate: v.number(),
      printerMac: v.optional(v.string()),
      kitchenPrinterMac: v.optional(v.string()),
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

    const store = await ctx.db.get(args.storeId);
    return store;
  },
});

// Create store
export const create = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    parentId: v.optional(v.id("stores")),
    address1: v.string(),
    address2: v.optional(v.string()),
    tin: v.string(),
    min: v.string(),
    vatRate: v.number(),
  },
  returns: v.id("stores"),
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

    // Check permission - creating branch vs parent store
    const permission = args.parentId ? "stores.create_branch" : "stores.manage";
    await requirePermission(ctx, user._id, permission);

    return await ctx.db.insert("stores", {
      name: args.name,
      parentId: args.parentId,
      logo: undefined,
      address1: args.address1,
      address2: args.address2,
      tin: args.tin,
      min: args.min,
      vatRate: args.vatRate,
      printerMac: undefined,
      kitchenPrinterMac: undefined,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

// Update store
export const update = mutation({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
    name: v.optional(v.string()),
    address1: v.optional(v.string()),
    address2: v.optional(v.string()),
    tin: v.optional(v.string()),
    min: v.optional(v.string()),
    vatRate: v.optional(v.number()),
    printerMac: v.optional(v.string()),
    kitchenPrinterMac: v.optional(v.string()),
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

    await requirePermission(ctx, user._id, "stores.manage");

    const { token, storeId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    await ctx.db.patch(storeId, filteredUpdates);
    return null;
  },
});

// Generate upload URL for logo
export const generateLogoUploadUrl = mutation({
  args: { token: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    return await ctx.storage.generateUploadUrl();
  },
});

// Update store logo
export const updateLogo = mutation({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
    storageId: v.id("_storage"),
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

    await requirePermission(ctx, user._id, "stores.manage");

    await ctx.db.patch(args.storeId, { logo: args.storageId });
    return null;
  },
});

// Get logo URL
export const getLogoUrl = query({
  args: { storageId: v.optional(v.id("_storage")) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    if (!args.storageId) return null;
    return await ctx.storage.getUrl(args.storageId);
  },
});
