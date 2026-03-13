import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupRoleTestData(t: ReturnType<typeof convexTest>) {
  const storeId = await t.run(async (ctx) => {
    return await ctx.db.insert("stores", {
      name: "Main Store",
      address1: "123 Test St",
      tin: "123-456-789-000",
      min: "MIN-000001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  const superAdminRoleId = await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      name: "Super Admin",
      permissions: ["system.roles", "users.manage", "users.view"],
      scopeLevel: "system",
      isSystem: true,
    });
  });

  const adminRoleId = await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      name: "Admin",
      permissions: ["system.roles", "users.manage", "users.view"],
      scopeLevel: "parent",
      isSystem: true,
    });
  });

  const managerRoleId = await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["users.view"],
      scopeLevel: "branch",
      isSystem: true,
    });
  });

  const superAdminUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "System Owner",
      email: "super@test.com",
      roleId: superAdminRoleId,
      isActive: true,
    });
  });

  const adminUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Area Admin",
      email: "admin@test.com",
      roleId: adminRoleId,
      storeId,
      isActive: true,
    });
  });

  const managerUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Branch Manager",
      email: "manager@test.com",
      roleId: managerRoleId,
      storeId,
      isActive: true,
    });
  });

  return {
    adminRoleId,
    adminUserId,
    managerRoleId,
    managerUserId,
    storeId,
    superAdminRoleId,
    superAdminUserId,
  };
}

describe("roles.create", () => {
  it("creates a new role for a user with system.roles permission", async () => {
    const t = convexTest(schema, modules);
    const { superAdminUserId } = await setupRoleTestData(t);
    const authed = t.withIdentity({ subject: superAdminUserId });

    const roleId = await authed.mutation(api.roles.create, {
      name: "Shift Lead",
      permissions: ["orders.view", "users.view"],
      scopeLevel: "branch",
    });

    const createdRole = await t.run(async (ctx) => ctx.db.get(roleId));

    expect(createdRole).toMatchObject({
      name: "Shift Lead",
      permissions: ["orders.view", "users.view"],
      scopeLevel: "branch",
      isSystem: false,
    });
  });

  it("rejects users without the system.roles permission", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId } = await setupRoleTestData(t);
    const authed = t.withIdentity({ subject: managerUserId });

    await expect(
      authed.mutation(api.roles.create, {
        name: "Cashier Lead",
        permissions: ["orders.view"],
        scopeLevel: "branch",
      }),
    ).rejects.toThrowError("Permission denied: system.roles");
  });

  it("prevents parent-scope admins from creating system-scope roles", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId } = await setupRoleTestData(t);
    const authed = t.withIdentity({ subject: adminUserId });

    await expect(
      authed.mutation(api.roles.create, {
        name: "Regional Super Admin",
        permissions: ["system.roles"],
        scopeLevel: "system",
      }),
    ).rejects.toThrowError("Cannot manage roles above your scope");
  });
});

describe("roles.update", () => {
  it("updates a seeded system role when performed by a system user", async () => {
    const t = convexTest(schema, modules);
    const { adminRoleId, superAdminUserId } = await setupRoleTestData(t);
    const authed = t.withIdentity({ subject: superAdminUserId });

    await authed.mutation(api.roles.update, {
      roleId: adminRoleId,
      name: "Operations Admin",
      permissions: ["system.roles", "users.manage", "reports.daily"],
      scopeLevel: "parent",
    });

    const updatedRole = await t.run(async (ctx) => ctx.db.get(adminRoleId));

    expect(updatedRole).toMatchObject({
      name: "Operations Admin",
      permissions: ["system.roles", "users.manage", "reports.daily"],
      scopeLevel: "parent",
      isSystem: true,
    });
  });
});
