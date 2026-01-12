"use node";

import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { DEFAULT_ROLE_PERMISSIONS } from "./lib/permissions";

// Type definition for seed result
type SeedResult = {
  success: boolean;
  message: string;
};

// Action to seed the database
export const seed = action({
  args: {
    superAdminEmail: v.string(),
    superAdminPassword: v.string(),
    superAdminName: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args): Promise<SeedResult> => {
    // Define roles
    const roles = [
      {
        name: "Super Admin",
        permissions: DEFAULT_ROLE_PERMISSIONS["Super Admin"],
        scopeLevel: "system" as const,
        isSystem: true,
      },
      {
        name: "Admin",
        permissions: DEFAULT_ROLE_PERMISSIONS.Admin,
        scopeLevel: "parent" as const,
        isSystem: true,
      },
      {
        name: "Manager",
        permissions: DEFAULT_ROLE_PERMISSIONS.Manager,
        scopeLevel: "branch" as const,
        isSystem: true,
      },
      {
        name: "Staff",
        permissions: DEFAULT_ROLE_PERMISSIONS.Staff,
        scopeLevel: "branch" as const,
        isSystem: true,
      },
    ];

    // Step 1: Create roles and get Super Admin role ID
    const seedResult = await ctx.runMutation(internal.helpers.seedHelpers.insertRolesAndPrepare, {
      roles,
    });

    if (!seedResult.success) {
      return seedResult;
    }

    // Step 2: Create user with proper password hashing via Convex Auth
    // The createAccount function handles scrypt hashing internally
    const { user } = await createAccount(ctx, {
      provider: "password",
      account: {
        id: args.superAdminEmail.toLowerCase(),
        secret: args.superAdminPassword, // Plain password - library handles hashing
      },
      profile: {
        name: args.superAdminName,
        email: args.superAdminEmail.toLowerCase(),
      },
    });

    // Step 3: Update the created user with our custom fields (roleId, isActive)
    await ctx.runMutation(internal.helpers.seedHelpers.updateUserWithRole, {
      userId: user._id,
      roleId: seedResult.superAdminRoleId!,
    });

    return { success: true, message: "Database seeded successfully" };
  },
});
