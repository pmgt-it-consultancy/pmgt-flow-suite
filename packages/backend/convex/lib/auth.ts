import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get the currently authenticated user from Convex Auth
 * Returns the full user document with role information
 */
export async function getAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;

  const user = await ctx.db.get(userId);
  if (!user || user.isActive === false) return null;

  return user;
}

/**
 * Get the authenticated user with their role information
 */
export async function getAuthenticatedUserWithRole(ctx: QueryCtx | MutationCtx) {
  const user = await getAuthenticatedUser(ctx);
  if (!user) return null;

  if (!user.roleId) return { ...user, role: null };

  const role = await ctx.db.get(user.roleId);
  return { ...user, role };
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const user = await getAuthenticatedUser(ctx);
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}

/**
 * Require authentication with role - throws if not authenticated
 */
export async function requireAuthWithRole(ctx: QueryCtx | MutationCtx) {
  const userWithRole = await getAuthenticatedUserWithRole(ctx);
  if (!userWithRole) {
    throw new Error("Authentication required");
  }
  return userWithRole;
}

/**
 * Get user by ID with role information
 */
export async function getUserWithRole(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const user = await ctx.db.get(userId);
  if (!user) return null;

  if (!user.roleId) return { ...user, role: null };

  const role = await ctx.db.get(user.roleId);
  return { ...user, role };
}

/**
 * Get the stores accessible by a user based on their role scope
 */
export async function getUserStoreScope(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const user = await ctx.db.get(userId);
  if (!user) return { storeIds: [], scopeLevel: null };

  if (!user.roleId) return { storeIds: [], scopeLevel: null };

  const role = await ctx.db.get(user.roleId);
  if (!role) return { storeIds: [], scopeLevel: null };

  // Super Admin: all stores
  if (role.scopeLevel === "system") {
    const allStores = await ctx.db.query("stores").collect();
    return {
      storeIds: allStores.map((s) => s._id),
      scopeLevel: "system" as const,
    };
  }

  // Admin: parent store + branches
  if (role.scopeLevel === "parent" && user.storeId) {
    const branches = await ctx.db
      .query("stores")
      .withIndex("by_parent", (q) => q.eq("parentId", user.storeId))
      .collect();
    return {
      storeIds: [user.storeId, ...branches.map((b) => b._id)],
      scopeLevel: "parent" as const,
    };
  }

  // Manager/Staff: single branch
  if (role.scopeLevel === "branch" && user.storeId) {
    return {
      storeIds: [user.storeId],
      scopeLevel: "branch" as const,
    };
  }

  return { storeIds: [], scopeLevel: null };
}
