import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("usersHelpers.list", () => {
  it("marks active approval users without a PIN as needing PIN setup", async () => {
    const t = convexTest(schema, modules);

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

    const adminRoleId = await t.run(async (ctx) => {
      return await ctx.db.insert("roles", {
        name: "Admin",
        permissions: ["users.manage", "discounts.approve"],
        scopeLevel: "parent",
        isSystem: false,
      });
    });

    const managerRoleId = await t.run(async (ctx) => {
      return await ctx.db.insert("roles", {
        name: "Manager",
        permissions: ["discounts.approve"],
        scopeLevel: "branch",
        isSystem: false,
      });
    });

    const staffRoleId = await t.run(async (ctx) => {
      return await ctx.db.insert("roles", {
        name: "Staff",
        permissions: ["orders.view"],
        scopeLevel: "branch",
        isSystem: false,
      });
    });

    const adminUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Current Admin",
        email: "admin@test.com",
        roleId: adminRoleId,
        storeId,
        isActive: true,
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Manager Missing PIN",
        email: "manager-missing@test.com",
        roleId: managerRoleId,
        storeId,
        isActive: true,
      });

      await ctx.db.insert("users", {
        name: "Manager Ready",
        email: "manager-ready@test.com",
        roleId: managerRoleId,
        storeId,
        pin: "hashed-pin",
        isActive: true,
      });

      await ctx.db.insert("users", {
        name: "Staff Missing PIN",
        email: "staff@test.com",
        roleId: staffRoleId,
        storeId,
        isActive: true,
      });

      await ctx.db.insert("users", {
        name: "Inactive Manager Missing PIN",
        email: "inactive-manager@test.com",
        roleId: managerRoleId,
        storeId,
        isActive: false,
      });
    });

    const authed = t.withIdentity({ subject: adminUserId });
    const result = (await authed.query(api.helpers.usersHelpers.list, { storeId })) as Array<{
      name?: string;
      pendingPinSetup?: boolean;
    }>;

    expect(result.find((user) => user.name === "Manager Missing PIN")?.pendingPinSetup).toBe(true);
    expect(result.find((user) => user.name === "Manager Ready")?.pendingPinSetup).toBe(false);
    expect(result.find((user) => user.name === "Staff Missing PIN")?.pendingPinSetup).toBe(false);
    expect(
      result.find((user) => user.name === "Inactive Manager Missing PIN")?.pendingPinSetup,
    ).toBe(false);
  });
});
