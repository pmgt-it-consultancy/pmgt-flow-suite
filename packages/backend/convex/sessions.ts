import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthenticatedUser, getAuthenticatedUserWithRole } from "./lib/auth";

/**
 * Get current authenticated user with role information
 * This replaces the old token-based getCurrentUser query
 */
export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("users"),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      roleId: v.optional(v.id("roles")),
      storeId: v.optional(v.id("stores")),
      role: v.union(
        v.object({
          _id: v.id("roles"),
          name: v.string(),
          permissions: v.array(v.string()),
          scopeLevel: v.union(v.literal("system"), v.literal("parent"), v.literal("branch")),
        }),
        v.null(),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userWithRole = await getAuthenticatedUserWithRole(ctx);
    if (!userWithRole) return null;

    return {
      _id: userWithRole._id,
      email: userWithRole.email,
      name: userWithRole.name,
      roleId: userWithRole.roleId,
      storeId: userWithRole.storeId,
      role: userWithRole.role
        ? {
            _id: userWithRole.role._id,
            name: userWithRole.role.name,
            permissions: userWithRole.role.permissions,
            scopeLevel: userWithRole.role.scopeLevel,
          }
        : null,
    };
  },
});

/**
 * Check if current session is valid
 * This replaces the old token-based validateSession query
 */
export const isAuthenticated = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    return user !== null;
  },
});
