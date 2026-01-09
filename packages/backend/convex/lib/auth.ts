import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export async function getSessionUser(
  ctx: QueryCtx | MutationCtx,
  token: string | null
) {
  if (!token) return null;

  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();

  if (!session) return null;
  if (session.expiresAt < Date.now()) return null;

  const user = await ctx.db.get(session.userId);
  if (!user || !user.isActive) return null;

  return user;
}

export async function getUserWithRole(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const user = await ctx.db.get(userId);
  if (!user) return null;

  const role = await ctx.db.get(user.roleId);
  return { ...user, role };
}

export async function getUserStoreScope(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const user = await ctx.db.get(userId);
  if (!user) return { storeIds: [], scopeLevel: null };

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

export function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getSessionExpiry(): number {
  // 24 hours from now
  return Date.now() + 24 * 60 * 60 * 1000;
}
