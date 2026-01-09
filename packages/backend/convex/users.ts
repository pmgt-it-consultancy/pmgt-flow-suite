"use node";

import { v } from "convex/values";
import { query, mutation, action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { requirePermission } from "./lib/permissions";
import bcrypt from "bcryptjs";

// List users based on user scope
export const list = query({
  args: {
    token: v.string(),
    storeId: v.optional(v.id("stores")),
  },
  returns: v.array(
    v.object({
      _id: v.id("users"),
      username: v.string(),
      name: v.string(),
      roleId: v.id("roles"),
      roleName: v.string(),
      storeId: v.optional(v.id("stores")),
      storeName: v.optional(v.string()),
      isActive: v.boolean(),
      createdAt: v.number(),
      lastLoginAt: v.optional(v.number()),
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

    const currentUser = await ctx.db.get(session.userId);
    if (!currentUser || !currentUser.isActive) {
      throw new Error("User not found or inactive");
    }

    const currentRole = await ctx.db.get(currentUser.roleId);
    if (!currentRole) {
      throw new Error("Role not found");
    }

    let users: Doc<"users">[] = [];

    if (currentRole.scopeLevel === "system") {
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
    } else if (currentRole.scopeLevel === "parent" && currentUser.storeId) {
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
        const role = await ctx.db.get(user.roleId);
        let storeName: string | undefined;
        if (user.storeId) {
          const store = await ctx.db.get(user.storeId);
          storeName = store?.name;
        }

        return {
          _id: user._id,
          username: user.username,
          name: user.name,
          roleId: user.roleId,
          roleName: role?.name ?? "Unknown",
          storeId: user.storeId,
          storeName,
          isActive: user.isActive,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
        };
      })
    );

    return enrichedUsers;
  },
});

// Get single user
export const get = query({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      username: v.string(),
      name: v.string(),
      roleId: v.id("roles"),
      storeId: v.optional(v.id("stores")),
      isActive: v.boolean(),
      pin: v.optional(v.string()),
      createdAt: v.number(),
      lastLoginAt: v.optional(v.number()),
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

    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    return {
      _id: user._id,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
      storeId: user.storeId,
      isActive: user.isActive,
      pin: user.pin,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  },
});

// Internal mutation to create user (called by action after password hashing)
export const insertUser = internalMutation({
  args: {
    username: v.string(),
    passwordHash: v.string(),
    name: v.string(),
    roleId: v.id("roles"),
    storeId: v.optional(v.id("stores")),
    pin: v.optional(v.string()),
    creatorId: v.id("users"),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    // Check for duplicate username
    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();

    if (existing) {
      throw new Error("Username already exists");
    }

    // Verify creator has permission
    await requirePermission(ctx, args.creatorId, "users.manage");

    return await ctx.db.insert("users", {
      username: args.username,
      passwordHash: args.passwordHash,
      name: args.name,
      roleId: args.roleId,
      storeId: args.storeId,
      isActive: true,
      pin: args.pin,
      createdAt: Date.now(),
      lastLoginAt: undefined,
    });
  },
});

// Action to create user (handles password hashing with bcrypt)
export const create = action({
  args: {
    token: v.string(),
    username: v.string(),
    password: v.string(),
    name: v.string(),
    roleId: v.id("roles"),
    storeId: v.optional(v.id("stores")),
    pin: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => {
    // Validate session using the sessions module
    const sessionResult = await ctx.runQuery(api.sessions.validateSession, {
      token: args.token,
    });

    if (!sessionResult.valid) {
      throw new Error("Invalid session");
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(args.password, salt);

    // Create user
    return await ctx.runMutation(internal.users.insertUser, {
      username: args.username,
      passwordHash,
      name: args.name,
      roleId: args.roleId,
      storeId: args.storeId,
      pin: args.pin,
      creatorId: sessionResult.user._id,
    });
  },
});

// Update user (non-password fields)
export const update = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    name: v.optional(v.string()),
    roleId: v.optional(v.id("roles")),
    storeId: v.optional(v.id("stores")),
    pin: v.optional(v.string()),
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

    const currentUser = await ctx.db.get(session.userId);
    if (!currentUser) throw new Error("User not found");

    await requirePermission(ctx, currentUser._id, "users.manage");

    const { token, userId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    await ctx.db.patch(userId, filteredUpdates);
    return null;
  },
});

// Internal mutation to update password
export const updatePasswordInternal = internalMutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    updaterId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify updater has permission
    await requirePermission(ctx, args.updaterId, "users.manage");

    await ctx.db.patch(args.userId, { passwordHash: args.passwordHash });
    return null;
  },
});

// Action to reset password
export const resetPassword = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Validate session using the sessions module
    const sessionResult = await ctx.runQuery(api.sessions.validateSession, {
      token: args.token,
    });

    if (!sessionResult.valid) {
      throw new Error("Invalid session");
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(args.newPassword, salt);

    // Update password
    await ctx.runMutation(internal.users.updatePasswordInternal, {
      userId: args.userId,
      passwordHash,
      updaterId: sessionResult.user._id,
    });

    return null;
  },
});
