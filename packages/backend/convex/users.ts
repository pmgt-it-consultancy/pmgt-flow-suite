"use node";

import { createAccount } from "@convex-dev/auth/server";
import bcrypt from "bcryptjs";
import { v } from "convex/values";
import * as Scrypt from "scrypt-kdf";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

/**
 * User management actions
 *
 * Admin user management:
 * - create: Create new user accounts (admin only)
 * - resetPassword: Reset user passwords (admin only)
 *
 * POS-specific user management:
 * - Setting/updating manager PINs (for void approvals, etc.)
 * - Profile queries are in helpers/usersHelpers.ts
 */

// Action to set or update a user's PIN (handles bcrypt hashing)
export const setPin = action({
  args: {
    userId: v.id("users"),
    pin: v.string(),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // Validate authentication
    const currentUserId = await ctx.runQuery(
      internal.helpers.usersHelpers.getAuthenticatedUserId,
      {},
    );

    if (!currentUserId) {
      return { success: false as const, error: "Authentication required" };
    }

    // Validate PIN format (4-6 digits)
    if (!/^\d{4,6}$/.test(args.pin)) {
      return {
        success: false as const,
        error: "PIN must be 4-6 digits",
      };
    }

    try {
      // Hash the PIN
      const salt = await bcrypt.genSalt(10);
      const hashedPin = await bcrypt.hash(args.pin, salt);

      // Update the user's PIN
      await ctx.runMutation(internal.helpers.usersHelpers.setUserPinInternal, {
        userId: args.userId,
        hashedPin,
        updaterId: currentUserId,
      });

      return { success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to set PIN",
      };
    }
  },
});

// Action to verify a PIN (for void approvals, etc.)
export const verifyPin = action({
  args: {
    userId: v.id("users"),
    pin: v.string(),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // Validate authentication
    const currentUserId = await ctx.runQuery(
      internal.helpers.usersHelpers.getAuthenticatedUserId,
      {},
    );

    if (!currentUserId) {
      return { success: false as const, error: "Authentication required" };
    }

    // Get the user's hashed PIN
    const userPin = await ctx.runQuery(internal.helpers.usersHelpers.getUserPinInternal, {
      userId: args.userId,
    });

    if (!userPin) {
      return { success: false as const, error: "PIN not set for this user" };
    }

    // Verify PIN
    const isValid = await bcrypt.compare(args.pin, userPin);

    if (!isValid) {
      return { success: false as const, error: "Invalid PIN" };
    }

    return { success: true as const };
  },
});

/**
 * Create a new user (admin only)
 * Uses Convex Auth to properly hash passwords and create auth account
 */
export const create = action({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
    roleId: v.optional(v.id("roles")),
    storeId: v.optional(v.id("stores")),
  },
  returns: v.union(
    v.object({ success: v.literal(true), userId: v.id("users") }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // Validate authentication
    const currentUserId = await ctx.runQuery(
      internal.helpers.usersHelpers.getAuthenticatedUserId,
      {},
    );

    if (!currentUserId) {
      return { success: false as const, error: "Authentication required" };
    }

    // Check if user has permission to create users
    const hasPermission = await ctx.runQuery(
      internal.helpers.permissionsHelpers.checkUserPermission,
      { userId: currentUserId, permission: "users.manage" },
    );

    if (!hasPermission) {
      return { success: false as const, error: "Permission denied" };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(args.email)) {
      return { success: false as const, error: "Invalid email format" };
    }

    // Check for existing account with this email
    const existing = await ctx.runQuery(internal.helpers.usersHelpers.getAuthAccountByEmail, {
      email: args.email,
    });

    if (existing) {
      return { success: false as const, error: "Email already in use" };
    }

    try {
      // Create user with Convex Auth (handles password hashing internally)
      const { user } = await createAccount(ctx, {
        provider: "password",
        account: {
          id: args.email.toLowerCase(),
          secret: args.password,
        },
        profile: {
          name: args.name,
          email: args.email.toLowerCase(),
        },
      });

      // Update user with custom fields (roleId, storeId, isActive)
      await ctx.runMutation(internal.helpers.usersHelpers.updateUserAfterCreate, {
        userId: user._id,
        roleId: args.roleId,
        storeId: args.storeId,
        isActive: true,
      });

      return { success: true as const, userId: user._id };
    } catch (error) {
      console.error("Create user error:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to create user",
      };
    }
  },
});

/**
 * Reset a user's password (admin only)
 * Hashes the new password and updates the auth account
 */
export const resetPassword = action({
  args: {
    userId: v.id("users"),
    newPassword: v.string(),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // Validate authentication
    const currentUserId = await ctx.runQuery(
      internal.helpers.usersHelpers.getAuthenticatedUserId,
      {},
    );

    if (!currentUserId) {
      return { success: false as const, error: "Authentication required" };
    }

    // Check if user has permission to manage users
    const hasPermission = await ctx.runQuery(
      internal.helpers.permissionsHelpers.checkUserPermission,
      { userId: currentUserId, permission: "users.manage" },
    );

    if (!hasPermission) {
      return { success: false as const, error: "Permission denied" };
    }

    // Get user email to find their auth account
    const user = await ctx.runQuery(internal.helpers.usersHelpers.getUserById, {
      userId: args.userId,
    });

    if (!user || !user.email) {
      return { success: false as const, error: "User not found" };
    }

    // Find the auth account
    const authAccount = await ctx.runQuery(internal.helpers.usersHelpers.getAuthAccountByEmail, {
      email: user.email,
    });

    if (!authAccount) {
      return { success: false as const, error: "Auth account not found" };
    }

    try {
      // Hash new password using scrypt (same as Convex Auth Password provider)
      const keyBuffer = await Scrypt.kdf(args.newPassword, { logN: 15, r: 8, p: 1 });
      const hashedPassword = Buffer.from(keyBuffer).toString("base64");

      // Update auth account with new password
      await ctx.runMutation(internal.helpers.usersHelpers.updateAuthAccountSecret, {
        accountId: authAccount.accountId,
        newSecret: hashedPassword,
      });

      return { success: true as const };
    } catch (error) {
      console.error("Reset password error:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to reset password",
      };
    }
  },
});
