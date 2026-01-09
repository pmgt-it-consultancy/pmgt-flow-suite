import { v } from "convex/values";
import { query } from "./_generated/server";

export const validateSession = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      valid: v.literal(true),
      user: v.object({
        _id: v.id("users"),
        username: v.string(),
        name: v.string(),
        roleId: v.id("roles"),
        storeId: v.optional(v.id("stores")),
      }),
      role: v.object({
        _id: v.id("roles"),
        name: v.string(),
        permissions: v.array(v.string()),
        scopeLevel: v.union(
          v.literal("system"),
          v.literal("parent"),
          v.literal("branch")
        ),
      }),
    }),
    v.object({
      valid: v.literal(false),
    })
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session) {
      return { valid: false };
    }

    if (session.expiresAt < Date.now()) {
      return { valid: false };
    }

    const user = await ctx.db.get(session.userId);
    if (!user || !user.isActive) {
      return { valid: false };
    }

    const role = await ctx.db.get(user.roleId);
    if (!role) {
      return { valid: false };
    }

    return {
      valid: true,
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        roleId: user.roleId,
        storeId: user.storeId,
      },
      role: {
        _id: role._id,
        name: role.name,
        permissions: role.permissions,
        scopeLevel: role.scopeLevel,
      },
    };
  },
});

export const getCurrentUser = query({
  args: { token: v.optional(v.string()) },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      username: v.string(),
      name: v.string(),
      roleId: v.id("roles"),
      storeId: v.optional(v.id("stores")),
      role: v.object({
        name: v.string(),
        permissions: v.array(v.string()),
        scopeLevel: v.union(
          v.literal("system"),
          v.literal("parent"),
          v.literal("branch")
        ),
      }),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    if (!args.token) return null;

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      return null;
    }

    const user = await ctx.db.get(session.userId);
    if (!user || !user.isActive) {
      return null;
    }

    const role = await ctx.db.get(user.roleId);
    if (!role) {
      return null;
    }

    return {
      _id: user._id,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
      storeId: user.storeId,
      role: {
        name: role.name,
        permissions: role.permissions,
        scopeLevel: role.scopeLevel,
      },
    };
  },
});
