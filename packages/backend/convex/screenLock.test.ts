import bcrypt from "bcryptjs";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupScreenLockTestData(t: ReturnType<typeof convexTest>) {
  const managerPin = await bcrypt.hash("1234", 10);
  const overrideManagerPin = await bcrypt.hash("5678", 10);

  const storeId = await t.run(async (ctx) => {
    return await ctx.db.insert("stores", {
      name: "Test Store",
      address1: "123 Test St",
      tin: "123-456-789-000",
      min: "MIN-000001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  const managerRoleId = await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["discounts.approve", "system.settings"],
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

  const managerUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Manager User",
      email: "manager@test.com",
      roleId: managerRoleId,
      storeId,
      isActive: true,
      pin: managerPin,
    });
  });

  const overrideManagerUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Override Manager",
      email: "override-manager@test.com",
      roleId: managerRoleId,
      storeId,
      isActive: true,
      pin: overrideManagerPin,
    });
  });

  const staffUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Staff User",
      email: "staff@test.com",
      roleId: staffRoleId,
      storeId,
      isActive: true,
    });
  });

  return {
    managerRoleId,
    managerUserId,
    overrideManagerUserId,
    staffRoleId,
    staffUserId,
    storeId,
  };
}

describe("screenLock.getAutoLockTimeout", () => {
  it("returns the default timeout when no setting exists", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, storeId } = await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: managerUserId });

    const timeout = await authed.query(api.screenLock.getAutoLockTimeout, { storeId });

    expect(timeout).toBe(5);
  });

  it("returns the stored timeout when present", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, storeId } = await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: managerUserId });

    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        storeId,
        key: "autoLockTimeout",
        value: "10",
        updatedAt: Date.now(),
        updatedBy: managerUserId,
      });
    });

    const timeout = await authed.query(api.screenLock.getAutoLockTimeout, { storeId });

    expect(timeout).toBe(10);
  });

  it("falls back to the default timeout for invalid values", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, storeId } = await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: managerUserId });

    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        storeId,
        key: "autoLockTimeout",
        value: "invalid",
        updatedAt: Date.now(),
        updatedBy: managerUserId,
      });
    });

    const timeout = await authed.query(api.screenLock.getAutoLockTimeout, { storeId });

    expect(timeout).toBe(5);
  });
});

describe("screenLock.getUserHasPin", () => {
  it("returns true when the user has a PIN", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId } = await setupScreenLockTestData(t);

    const hasPin = await t.query(api.screenLock.getUserHasPin, { userId: managerUserId });

    expect(hasPin).toBe(true);
  });

  it("returns false when the user does not have a PIN", async () => {
    const t = convexTest(schema, modules);
    const { staffUserId } = await setupScreenLockTestData(t);

    const hasPin = await t.query(api.screenLock.getUserHasPin, { userId: staffUserId });

    expect(hasPin).toBe(false);
  });
});

describe("screenLock.screenLock", () => {
  it("writes an audit log for a manual lock event", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, storeId } = await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: managerUserId });

    await authed.mutation(api.screenLock.screenLock, {
      storeId,
      trigger: "manual",
    });

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_store", (q) => q.eq("storeId", storeId))
        .collect();
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("screen_locked");
    expect(logs[0]?.entityType).toBe("screen_lock");
    expect(logs[0]?.entityId).toBe(managerUserId);
    expect(JSON.parse(logs[0]?.details ?? "{}")).toEqual({
      trigger: "manual",
      userId: managerUserId,
    });
  });
});

describe("screenLock.setAutoLockTimeout", () => {
  it("creates the auto-lock timeout setting for a permitted user", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, storeId } = await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: managerUserId });

    await authed.mutation(api.screenLock.setAutoLockTimeout, {
      storeId,
      minutes: 15,
    });

    const setting = await t.run(async (ctx) => {
      return await ctx.db
        .query("settings")
        .withIndex("by_store_key", (q) => q.eq("storeId", storeId).eq("key", "autoLockTimeout"))
        .unique();
    });

    expect(setting?.value).toBe("15");
    expect(setting?.updatedBy).toBe(managerUserId);
  });

  it("updates an existing auto-lock timeout setting", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, storeId } = await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: managerUserId });

    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        storeId,
        key: "autoLockTimeout",
        value: "5",
        updatedAt: Date.now(),
        updatedBy: managerUserId,
      });
    });

    await authed.mutation(api.screenLock.setAutoLockTimeout, {
      storeId,
      minutes: 30,
    });

    const setting = await t.run(async (ctx) => {
      return await ctx.db
        .query("settings")
        .withIndex("by_store_key", (q) => q.eq("storeId", storeId).eq("key", "autoLockTimeout"))
        .unique();
    });

    expect(setting?.value).toBe("30");
  });

  it("rejects users without settings permission", async () => {
    const t = convexTest(schema, modules);
    const { staffUserId, storeId } = await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: staffUserId });

    await expect(
      authed.mutation(api.screenLock.setAutoLockTimeout, {
        storeId,
        minutes: 10,
      }),
    ).rejects.toThrowError("Permission denied: system.settings");
  });
});

describe("screenLockActions", () => {
  it("unlocks with the locked user's valid PIN and writes an audit log", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, storeId, staffUserId } = await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: staffUserId });

    const result = await authed.action(api.screenLockActions.screenUnlock, {
      userId: managerUserId,
      pin: "1234",
      storeId,
    });

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_store", (q) => q.eq("storeId", storeId))
        .collect();
    });

    expect(result).toEqual({ success: true });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("screen_unlocked");
    expect(JSON.parse(logs[0]?.details ?? "{}")).toEqual({
      method: "pin",
      userId: managerUserId,
    });
  });

  it("rejects an invalid unlock PIN", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, storeId, staffUserId } = await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: staffUserId });

    const result = await authed.action(api.screenLockActions.screenUnlock, {
      userId: managerUserId,
      pin: "9999",
      storeId,
    });

    expect(result).toEqual({
      success: false,
      error: "Invalid PIN",
    });
  });

  it("allows a manager override with a valid manager PIN and approval permission", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, overrideManagerUserId, storeId, staffUserId } =
      await setupScreenLockTestData(t);
    const authed = t.withIdentity({ subject: staffUserId });

    const result = await authed.action(api.screenLockActions.screenUnlockOverride, {
      lockedUserId: staffUserId,
      managerId: overrideManagerUserId,
      managerPin: "5678",
      storeId,
    });

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_store", (q) => q.eq("storeId", storeId))
        .collect();
    });

    expect(result).toEqual({ success: true });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("screen_unlock_override");
    expect(logs[0]?.userId).toBe(overrideManagerUserId);
    expect(JSON.parse(logs[0]?.details ?? "{}")).toEqual({
      lockedUserId: staffUserId,
      method: "manager_pin",
      overrideManagerId: overrideManagerUserId,
    });
    expect(managerUserId).not.toBe(overrideManagerUserId);
  });
});
