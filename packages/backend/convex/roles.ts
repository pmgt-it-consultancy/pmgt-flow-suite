import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedUserWithRole } from "./lib/auth";
import { requirePermission } from "./lib/permissions";

const scopeLevelValidator = v.union(v.literal("system"), v.literal("parent"), v.literal("branch"));

const roleValidator = v.object({
  _id: v.id("roles"),
  name: v.string(),
  permissions: v.array(v.string()),
  scopeLevel: scopeLevelValidator,
  isSystem: v.boolean(),
});

function canManageScope(
  currentScope: "system" | "parent" | "branch",
  targetScope: "system" | "parent" | "branch",
) {
  if (currentScope === "system") return true;
  if (currentScope === "parent") return targetScope !== "system";
  return targetScope === "branch";
}

// List all roles
export const list = query({
  args: {},
  returns: v.array(roleValidator),
  handler: async (ctx) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUserWithRole(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    const { role } = currentUser;
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
    roleId: v.id("roles"),
  },
  returns: v.union(roleValidator, v.null()),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUserWithRole(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
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

export const create = mutation({
  args: {
    name: v.string(),
    permissions: v.array(v.string()),
    scopeLevel: scopeLevelValidator,
  },
  returns: v.id("roles"),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUserWithRole(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    if (!currentUser.role) {
      throw new Error("Role not found");
    }

    await requirePermission(ctx, currentUser._id, "system.roles");

    if (!canManageScope(currentUser.role.scopeLevel, args.scopeLevel)) {
      throw new Error("Cannot manage roles above your scope");
    }

    const existingRole = await ctx.db
      .query("roles")
      .withIndex("by_name", (q) => q.eq("name", args.name.trim()))
      .unique();
    if (existingRole) {
      throw new Error("Role name already exists");
    }

    return await ctx.db.insert("roles", {
      name: args.name.trim(),
      permissions: Array.from(new Set(args.permissions)),
      scopeLevel: args.scopeLevel,
      isSystem: false,
    });
  },
});

export const update = mutation({
  args: {
    roleId: v.id("roles"),
    name: v.string(),
    permissions: v.array(v.string()),
    scopeLevel: scopeLevelValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUserWithRole(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    if (!currentUser.role) {
      throw new Error("Role not found");
    }

    await requirePermission(ctx, currentUser._id, "system.roles");

    const role = await ctx.db.get(args.roleId);
    if (!role) {
      throw new Error("Role not found");
    }

    if (
      !canManageScope(currentUser.role.scopeLevel, role.scopeLevel) ||
      !canManageScope(currentUser.role.scopeLevel, args.scopeLevel)
    ) {
      throw new Error("Cannot manage roles above your scope");
    }

    const existingRole = await ctx.db
      .query("roles")
      .withIndex("by_name", (q) => q.eq("name", args.name.trim()))
      .unique();
    if (existingRole && existingRole._id !== args.roleId) {
      throw new Error("Role name already exists");
    }

    await ctx.db.patch(args.roleId, {
      name: args.name.trim(),
      permissions: Array.from(new Set(args.permissions)),
      scopeLevel: args.scopeLevel,
    });

    return null;
  },
});
