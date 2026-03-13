"use node";

import bcrypt from "bcryptjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const screenUnlock = action({
  args: {
    userId: v.id("users"),
    pin: v.string(),
    storeId: v.id("stores"),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const currentUserId = await ctx.runQuery(
      internal.helpers.usersHelpers.getAuthenticatedUserId,
      {},
    );
    if (!currentUserId) {
      return { success: false, error: "Authentication required" } as const;
    }

    const lockedUser = await ctx.runQuery(internal.helpers.usersHelpers.getUserById, {
      userId: args.userId,
    });
    if (!lockedUser || lockedUser.isActive === false) {
      return { success: false, error: "User not found" } as const;
    }

    if (lockedUser.storeId !== args.storeId) {
      return { success: false, error: "User does not belong to this store" } as const;
    }

    const userPin = await ctx.runQuery(internal.helpers.usersHelpers.getUserPinInternal, {
      userId: args.userId,
    });
    if (!userPin) {
      return { success: false, error: "PIN not set" } as const;
    }

    const isValid = await bcrypt.compare(args.pin, userPin);
    if (!isValid) {
      return { success: false, error: "Invalid PIN" } as const;
    }

    await ctx.runMutation(internal.screenLock.logScreenUnlock, {
      storeId: args.storeId,
      userId: args.userId,
    });

    return { success: true } as const;
  },
});

export const screenUnlockOverride = action({
  args: {
    lockedUserId: v.id("users"),
    managerId: v.id("users"),
    managerPin: v.string(),
    storeId: v.id("stores"),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const currentUserId = await ctx.runQuery(
      internal.helpers.usersHelpers.getAuthenticatedUserId,
      {},
    );
    if (!currentUserId) {
      return { success: false, error: "Authentication required" } as const;
    }

    const [lockedUser, manager] = await Promise.all([
      ctx.runQuery(internal.helpers.usersHelpers.getUserById, {
        userId: args.lockedUserId,
      }),
      ctx.runQuery(internal.helpers.usersHelpers.getUserById, {
        userId: args.managerId,
      }),
    ]);

    if (!lockedUser || lockedUser.isActive === false) {
      return { success: false, error: "Locked user not found" } as const;
    }

    if (!manager || manager.isActive === false) {
      return { success: false, error: "Manager not found" } as const;
    }

    if (lockedUser.storeId !== args.storeId || manager.storeId !== args.storeId) {
      return { success: false, error: "User does not belong to this store" } as const;
    }

    const hasApprovalPermission = await ctx.runQuery(
      internal.helpers.permissionsHelpers.checkUserPermission,
      {
        userId: args.managerId,
        permission: "discounts.approve",
      },
    );
    if (!hasApprovalPermission) {
      return { success: false, error: "Manager approval required" } as const;
    }

    const managerPin = await ctx.runQuery(internal.helpers.usersHelpers.getUserPinInternal, {
      userId: args.managerId,
    });
    if (!managerPin) {
      return { success: false, error: "Manager PIN not set" } as const;
    }

    const isValid = await bcrypt.compare(args.managerPin, managerPin);
    if (!isValid) {
      return { success: false, error: "Invalid manager PIN" } as const;
    }

    await ctx.runMutation(internal.screenLock.logScreenUnlockOverride, {
      storeId: args.storeId,
      lockedUserId: args.lockedUserId,
      managerId: args.managerId,
    });

    return { success: true } as const;
  },
});
