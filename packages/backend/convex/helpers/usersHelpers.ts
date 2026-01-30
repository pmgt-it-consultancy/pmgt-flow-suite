import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { getAuthenticatedUser, getAuthenticatedUserWithRole } from "../lib/auth";
import { requirePermission } from "../lib/permissions";

/**
 * Internal query to get authenticated user ID
 * Used by actions that need to verify the current user
 */
export const getAuthenticatedUserId = internalQuery({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user || user.isActive === false) return null;

    return userId;
  },
});

// List users based on user scope
export const list = query({
  args: {
    storeId: v.optional(v.id("stores")),
  },
  returns: v.array(
    v.object({
      _id: v.id("users"),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      roleId: v.optional(v.id("roles")),
      roleName: v.string(),
      storeId: v.optional(v.id("stores")),
      storeName: v.optional(v.string()),
      isActive: v.boolean(),
      hasPin: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    // Get authenticated user with role
    const currentUser = await getAuthenticatedUserWithRole(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    if (!currentUser.role) {
      throw new Error("Role not found");
    }

    let users: Doc<"users">[] = [];

    if (currentUser.role.scopeLevel === "system") {
      // Super Admin: all users (optionally filter by store)
      if (args.storeId) {
        users = await ctx.db
          .query("users")
          .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
          .collect();
        // Also include users with no store (Super Admins)
        const noStoreUsers = await ctx.db
          .query("users")
          .withIndex("by_store", (q) => q.eq("storeId", undefined))
          .collect();
        users = [...users, ...noStoreUsers];
      } else {
        users = await ctx.db.query("users").collect();
      }
    } else if (currentUser.role.scopeLevel === "parent" && currentUser.storeId) {
      // Admin: users in parent store + branches
      const branches = await ctx.db
        .query("stores")
        .withIndex("by_parent", (q) => q.eq("parentId", currentUser.storeId))
        .collect();
      const storeIds = [currentUser.storeId, ...branches.map((b) => b._id)];

      // Get users for each store
      for (const storeId of storeIds) {
        const storeUsers = await ctx.db
          .query("users")
          .withIndex("by_store", (q) => q.eq("storeId", storeId))
          .collect();
        users.push(...storeUsers);
      }
    } else if (currentUser.storeId) {
      // Manager: users in same store only
      users = await ctx.db
        .query("users")
        .withIndex("by_store", (q) => q.eq("storeId", currentUser.storeId))
        .collect();
    }

    // Enrich with role and store names
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        const role = user.roleId ? await ctx.db.get(user.roleId) : null;
        let storeName: string | undefined;
        if (user.storeId) {
          const store = await ctx.db.get(user.storeId);
          storeName = store?.name;
        }

        return {
          _id: user._id,
          email: user.email,
          name: user.name,
          roleId: user.roleId,
          roleName: role?.name ?? "No Role",
          storeId: user.storeId,
          storeName,
          isActive: user.isActive ?? true,
          hasPin: !!user.pin,
        };
      }),
    );

    return enrichedUsers;
  },
});

// List managers for a store (for PIN approval)
export const listManagers = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      roleName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    // Validate authentication
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Get users for this store
    const users = await ctx.db
      .query("users")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .collect();

    // Filter to only active users with PINs and manager+ roles
    const managers: { _id: Id<"users">; name: string; roleName: string }[] = [];

    for (const user of users) {
      if (user.isActive === false || !user.pin) continue;
      if (!user.roleId) continue;

      const role = await ctx.db.get(user.roleId);
      if (!role) continue;

      // Include users who have the discounts.approve permission
      if (role.permissions.includes("discounts.approve")) {
        managers.push({
          _id: user._id,
          name: user.name ?? "Unknown",
          roleName: role.name,
        });
      }
    }

    return managers;
  },
});

// Get single user
export const get = query({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      roleId: v.optional(v.id("roles")),
      storeId: v.optional(v.id("stores")),
      isActive: v.boolean(),
      hasPin: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // Validate authentication
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      storeId: user.storeId,
      isActive: user.isActive ?? true,
      hasPin: !!user.pin,
    };
  },
});

// Update user (non-password fields - profile management by admins)
export const update = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    roleId: v.optional(v.id("roles")),
    storeId: v.optional(v.id("stores")),
    isActive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Get authenticated user
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    await requirePermission(ctx, currentUser._id, "users.manage");

    const { userId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );

    await ctx.db.patch(userId, filteredUpdates);
    return null;
  },
});

// Internal query to get user by ID (for actions)
export const getUserById = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      roleId: v.optional(v.id("roles")),
      storeId: v.optional(v.id("stores")),
      isActive: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      storeId: user.storeId,
      isActive: user.isActive,
    };
  },
});

// Internal query to get user's hashed PIN
export const getUserPinInternal = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return user.pin ?? null;
  },
});

// Internal mutation to update user PIN (called from action after bcrypt hashing)
export const setUserPinInternal = internalMutation({
  args: {
    userId: v.id("users"),
    hashedPin: v.string(),
    updaterId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify updater has permission (can set own PIN or has users.manage)
    if (args.updaterId !== args.userId) {
      await requirePermission(ctx, args.updaterId, "users.manage");
    }

    await ctx.db.patch(args.userId, { pin: args.hashedPin });
    return null;
  },
});

// Internal mutation to clear a user's PIN
export const clearUserPinInternal = internalMutation({
  args: {
    userId: v.id("users"),
    updaterId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify updater has permission (can clear own PIN or has users.manage)
    if (args.updaterId !== args.userId) {
      await requirePermission(ctx, args.updaterId, "users.manage");
    }

    await ctx.db.patch(args.userId, { pin: undefined });
    return null;
  },
});

// Public mutation to update user PIN (requires auth)
export const setUserPin = mutation({
  args: {
    userId: v.id("users"),
    hashedPin: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Get authenticated user
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Can only set own PIN or if has users.manage permission
    if (currentUser._id !== args.userId) {
      await requirePermission(ctx, currentUser._id, "users.manage");
    }

    await ctx.db.patch(args.userId, { pin: args.hashedPin });
    return null;
  },
});

// Internal mutation to update user after Convex Auth creates them (for admin user creation)
export const updateUserAfterCreate = internalMutation({
  args: {
    userId: v.id("users"),
    roleId: v.optional(v.id("roles")),
    storeId: v.optional(v.id("stores")),
    isActive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );

    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(userId, filteredUpdates);
    }
    return null;
  },
});

// Internal mutation to get auth account for password reset
export const getAuthAccountByEmail = internalQuery({
  args: {
    email: v.string(),
  },
  returns: v.union(
    v.object({
      accountId: v.id("authAccounts"),
      userId: v.id("users"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", args.email.toLowerCase()),
      )
      .first();

    if (!account) return null;

    return {
      accountId: account._id,
      userId: account.userId,
    };
  },
});

// Internal mutation to update auth account secret (for password reset)
export const updateAuthAccountSecret = internalMutation({
  args: {
    accountId: v.id("authAccounts"),
    newSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, { secret: args.newSecret });
    return null;
  },
});
