import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireStagingLab } from "./lib/stagingLab";

const LAB_TIN = "STAGING-BSE2E";

export const getLab = internalQuery({
  args: {},
  returns: v.union(v.object({ storeId: v.id("stores") }), v.null()),
  handler: async (ctx) => {
    requireStagingLab();
    const store = await ctx.db
      .query("stores")
      .withIndex("by_tin", (q) => q.eq("tin", LAB_TIN))
      .unique();
    return store ? { storeId: store._id } : null;
  },
});

export const prepareLab = internalMutation({
  args: {},
  returns: v.object({
    storeId: v.id("stores"),
    managerRoleId: v.id("roles"),
    cashierRoleId: v.id("roles"),
    created: v.boolean(),
  }),
  handler: async (ctx) => {
    requireStagingLab();
    const managerRole = await ctx.db
      .query("roles")
      .withIndex("by_name", (q) => q.eq("name", "Manager"))
      .unique();
    const cashierRole = await ctx.db
      .query("roles")
      .withIndex("by_name", (q) => q.eq("name", "Staff"))
      .unique();
    if (!managerRole || !cashierRole) throw new Error("Manager and Staff roles are required");

    const existing = await ctx.db
      .query("stores")
      .withIndex("by_tin", (q) => q.eq("tin", LAB_TIN))
      .unique();
    if (existing) {
      if (existing.clientId !== undefined) {
        await ctx.db.patch(existing._id, { clientId: undefined, updatedAt: Date.now() });
      }
      return {
        storeId: existing._id,
        managerRoleId: managerRole._id,
        cashierRoleId: cashierRole._id,
        created: false,
      };
    }

    const now = Date.now();
    const storeId = await ctx.db.insert("stores", {
      name: "Bounded Sync E2E Lab",
      address1: "Staging Emulator Lab",
      tin: LAB_TIN,
      min: "STAGING-BSE2E",
      vatRate: 12,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return {
      storeId,
      managerRoleId: managerRole._id,
      cashierRoleId: cashierRole._id,
      created: true,
    };
  },
});

export const assignUser = internalMutation({
  args: {
    userId: v.id("users"),
    storeId: v.id("stores"),
    roleId: v.id("roles"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireStagingLab();
    await ctx.db.patch(args.userId, {
      storeId: args.storeId,
      roleId: args.roleId,
      isActive: true,
      updatedAt: Date.now(),
    });
    return null;
  },
});
