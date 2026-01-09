"use node";

import { v } from "convex/values";
import { query } from "./_generated/server";

// List all roles
export const list = query({
  args: {
    token: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("roles"),
      name: v.string(),
      permissions: v.array(v.string()),
      scopeLevel: v.union(
        v.literal("system"),
        v.literal("parent"),
        v.literal("branch")
      ),
      isSystem: v.boolean(),
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

    const user = await ctx.db.get(session.userId);
    if (!user || !user.isActive) {
      throw new Error("User not found or inactive");
    }

    const role = await ctx.db.get(user.roleId);
    if (!role) {
      throw new Error("Role not found");
    }

    // Get all roles
    const roles = await ctx.db.query("roles").collect();

    // Filter roles based on user's scope level
    // Super Admin can see all roles
    // Admin can see Admin, Manager, Staff
    // Manager/Staff can see Manager, Staff
    const allowedRoles = roles.filter((r) => {
      if (role.scopeLevel === "system") return true;
      if (role.scopeLevel === "parent") {
        return r.scopeLevel !== "system";
      }
      return r.scopeLevel === "branch";
    });

    return allowedRoles.map((r) => ({
      _id: r._id,
      name: r.name,
      permissions: r.permissions,
      scopeLevel: r.scopeLevel,
      isSystem: r.isSystem,
    }));
  },
});

// Get single role
export const get = query({
  args: {
    token: v.string(),
    roleId: v.id("roles"),
  },
  returns: v.union(
    v.object({
      _id: v.id("roles"),
      name: v.string(),
      permissions: v.array(v.string()),
      scopeLevel: v.union(
        v.literal("system"),
        v.literal("parent"),
        v.literal("branch")
      ),
      isSystem: v.boolean(),
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

    const role = await ctx.db.get(args.roleId);
    if (!role) return null;

    return {
      _id: role._id,
      name: role.name,
      permissions: role.permissions,
      scopeLevel: role.scopeLevel,
      isSystem: role.isSystem,
    };
  },
});
