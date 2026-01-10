import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { hasPermission, Permission } from "../lib/permissions";

/**
 * Internal query to check if a user has a specific permission
 * Used by actions that need to verify permissions
 */
export const checkUserPermission = internalQuery({
  args: {
    userId: v.id("users"),
    permission: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return hasPermission(ctx, args.userId, args.permission as Permission);
  },
});
