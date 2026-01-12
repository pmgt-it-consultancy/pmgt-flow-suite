import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// Internal mutation to insert roles and prepare for user creation
export const insertRolesAndPrepare = internalMutation({
  args: {
    roles: v.array(
      v.object({
        name: v.string(),
        permissions: v.array(v.string()),
        scopeLevel: v.union(v.literal("system"), v.literal("parent"), v.literal("branch")),
        isSystem: v.boolean(),
      }),
    ),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
    superAdminRoleId: v.optional(v.id("roles")),
  }),
  handler: async (ctx, args) => {
    // Check if already seeded
    const existingRoles = await ctx.db.query("roles").first();
    if (existingRoles) {
      return {
        success: false,
        message: "Database already seeded",
        superAdminRoleId: undefined,
      };
    }

    // Create roles
    const roleIds: Record<string, any> = {};
    for (const role of args.roles) {
      const id = await ctx.db.insert("roles", role);
      roleIds[role.name] = id;
    }

    return {
      success: true,
      message: "Roles created",
      superAdminRoleId: roleIds["Super Admin"],
    };
  },
});

// Internal mutation to update user with role after Convex Auth creates them
export const updateUserWithRole = internalMutation({
  args: {
    userId: v.id("users"),
    roleId: v.id("roles"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      roleId: args.roleId,
      isActive: true,
    });
  },
});
