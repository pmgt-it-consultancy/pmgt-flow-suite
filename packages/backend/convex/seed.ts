"use node";

import { v } from "convex/values";
import { internalMutation, action } from "./_generated/server";
import { internal } from "./_generated/api";
import bcrypt from "bcryptjs";
import { DEFAULT_ROLE_PERMISSIONS } from "./lib/permissions";

// Internal mutation to insert seed data
export const insertSeedData = internalMutation({
  args: {
    roles: v.array(
      v.object({
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
    superAdmin: v.object({
      username: v.string(),
      passwordHash: v.string(),
      name: v.string(),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    // Check if already seeded
    const existingRoles = await ctx.db.query("roles").first();
    if (existingRoles) {
      return { success: false, message: "Database already seeded" };
    }

    // Create roles
    const roleIds: Record<string, any> = {};
    for (const role of args.roles) {
      const id = await ctx.db.insert("roles", role);
      roleIds[role.name] = id;
    }

    // Create super admin user
    await ctx.db.insert("users", {
      username: args.superAdmin.username,
      passwordHash: args.superAdmin.passwordHash,
      name: args.superAdmin.name,
      roleId: roleIds["Super Admin"],
      storeId: undefined,
      isActive: true,
      pin: undefined,
      createdAt: Date.now(),
      lastLoginAt: undefined,
    });

    return { success: true, message: "Database seeded successfully" };
  },
});

// Action to seed the database (uses Node.js for bcrypt)
export const seed = action({
  args: {
    superAdminUsername: v.string(),
    superAdminPassword: v.string(),
    superAdminName: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(args.superAdminPassword, salt);

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
        permissions: DEFAULT_ROLE_PERMISSIONS["Admin"],
        scopeLevel: "parent" as const,
        isSystem: true,
      },
      {
        name: "Manager",
        permissions: DEFAULT_ROLE_PERMISSIONS["Manager"],
        scopeLevel: "branch" as const,
        isSystem: true,
      },
      {
        name: "Staff",
        permissions: DEFAULT_ROLE_PERMISSIONS["Staff"],
        scopeLevel: "branch" as const,
        isSystem: true,
      },
    ];

    // Insert seed data
    return await ctx.runMutation(internal.seed.insertSeedData, {
      roles,
      superAdmin: {
        username: args.superAdminUsername,
        passwordHash,
        name: args.superAdminName,
      },
    });
  },
});
