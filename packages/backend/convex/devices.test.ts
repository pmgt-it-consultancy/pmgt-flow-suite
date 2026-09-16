import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const STREAM = "orders";

async function setup(t: any, permissions: string[] = ["devices.manage"]) {
  const roleId = await t.run(async (ctx: any) =>
    ctx.db.insert("roles", { name: "Manager", permissions, scopeLevel: "branch", isSystem: false }),
  );
  const storeId = await t.run(async (ctx: any) =>
    ctx.db.insert("stores", {
      name: "Store A",
      address1: "1 Test St",
      tin: "000-000-000-000",
      min: "MIN-A",
      vatRate: 12,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const userId = await t.run(async (ctx: any) =>
    ctx.db.insert("users", {
      name: "Manager",
      email: "manager@test.com",
      roleId,
      storeId,
      isActive: true,
    }),
  );
  return { storeId, userId, asUser: t.withIdentity({ subject: userId }) };
}

async function reportPending(t: any, storeId: any, deviceId: string, pendingCount: number) {
  await t.run(async (ctx: any) =>
    ctx.db.insert("deviceSyncStates", {
      storeId,
      deviceId,
      stream: STREAM,
      generation: "g1",
      pendingCount,
      status: pendingCount > 0 ? "attention_required" : "active",
      updatedAt: Date.now(),
    }),
  );
}

async function bindings(t: any, deviceId: string) {
  return await t.run(async (ctx: any) =>
    ctx.db
      .query("syncDevices")
      .withIndex("by_deviceId", (q: any) => q.eq("deviceId", deviceId))
      .collect(),
  );
}

async function auditCount(t: any, action: string) {
  return await t.run(
    async (ctx: any) =>
      (
        await ctx.db
          .query("auditLogs")
          .withIndex("by_action", (q: any) => q.eq("action", action))
          .collect()
      ).length,
  );
}

describe("Device Retirement", () => {
  it("requires devices.manage", async () => {
    const t = convexTest(schema, modules);
    const { storeId, asUser } = await setup(t, ["stores.manage"]);
    await t.mutation(internal.sync.registerDeviceCore, { deviceId: "tablet-1", storeId });
    await reportPending(t, storeId, "tablet-1", 0);

    await expect(
      asUser.mutation(api.devices.retire, { deviceId: "tablet-1", storeId }),
    ).rejects.toThrow(/devices.manage/);
  });

  it("refuses while the tablet still has Pending Local Work, naming the count", async () => {
    const t = convexTest(schema, modules);
    const { storeId, asUser } = await setup(t);
    await t.mutation(internal.sync.registerDeviceCore, { deviceId: "tablet-1", storeId });
    await reportPending(t, storeId, "tablet-1", 3);

    await expect(
      asUser.mutation(api.devices.retire, { deviceId: "tablet-1", storeId }),
    ).rejects.toThrow(/3 record/);
  });

  it("refuses when the tablet has never reported that it is Sync-Clean", async () => {
    const t = convexTest(schema, modules);
    const { storeId, asUser } = await setup(t);
    await t.mutation(internal.sync.registerDeviceCore, { deviceId: "tablet-1", storeId });

    await expect(
      asUser.mutation(api.devices.retire, { deviceId: "tablet-1", storeId }),
    ).rejects.toThrow(/Sync-Clean/);
  });

  it("retires a Sync-Clean tablet, retains the row and writes one audit entry", async () => {
    const t = convexTest(schema, modules);
    const { storeId, asUser, userId } = await setup(t);
    await t.mutation(internal.sync.registerDeviceCore, { deviceId: "tablet-1", storeId });
    await reportPending(t, storeId, "tablet-1", 0);

    const { retiredAt } = await asUser.mutation(api.devices.retire, {
      deviceId: "tablet-1",
      storeId,
    });
    expect(retiredAt).toBeGreaterThan(0);

    const rows = await bindings(t, "tablet-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].retiredAt).toBe(retiredAt);
    expect(rows[0].retiredBy).toBe(userId);
    expect(await auditCount(t, "device.retired")).toBe(1);

    // Idempotent: retiring again succeeds without a second audit entry.
    await asUser.mutation(api.devices.retire, { deviceId: "tablet-1", storeId });
    expect(await auditCount(t, "device.retired")).toBe(1);
  });
});

describe("Device Commissioning", () => {
  it("refuses while the tablet is still an Active Tablet elsewhere", async () => {
    const t = convexTest(schema, modules);
    const { storeId: storeA } = await setup(t);
    const { storeId: storeB, asUser } = await setup(t);
    await t.mutation(internal.sync.registerDeviceCore, { deviceId: "tablet-1", storeId: storeA });

    await expect(
      asUser.mutation(api.devices.commission, { deviceId: "tablet-1", storeId: storeB }),
    ).rejects.toThrow(/Active Tablet/);
  });

  it("commissions a retired tablet with a fresh code and empty order-number counters", async () => {
    const t = convexTest(schema, modules);
    const { storeId: storeA, asUser: managerA } = await setup(t);
    await t.mutation(internal.sync.registerDeviceCore, { deviceId: "tablet-1", storeId: storeA });
    await t.run(async (ctx: any) => {
      const row = await ctx.db
        .query("syncDevices")
        .withIndex("by_deviceId", (q: any) => q.eq("deviceId", "tablet-1"))
        .unique();
      await ctx.db.patch(row._id, { orderNumberCounters: { "T-": 42 } });
    });
    await reportPending(t, storeA, "tablet-1", 0);
    await managerA.mutation(api.devices.retire, { deviceId: "tablet-1", storeId: storeA });

    const { storeId: storeB, asUser: managerB } = await setup(t);
    const { deviceCode } = await managerB.mutation(api.devices.commission, {
      deviceId: "tablet-1",
      storeId: storeB,
    });

    expect(deviceCode).toBe("A");
    const rows = await bindings(t, "tablet-1");
    expect(rows).toHaveLength(2);
    const active = rows.find((row: any) => row.retiredAt === undefined);
    expect(active.storeId).toBe(storeB);
    expect(active.orderNumberCounters).toBeUndefined();
    expect(await auditCount(t, "device.commissioned")).toBe(1);
  });

  /**
   * Device Retirement keeps the old row, so a moved tablet has two rows on by_deviceId. Any lookup
   * still using .unique() throws and any using .first() picks the retired one, which would strand
   * the tablet at its new store: unable to report sync state, and issuing the old store's numbers.
   */
  it("lets a moved tablet report sync state and use its new device code", async () => {
    const t = convexTest(schema, modules);
    const { storeId: storeA, asUser: managerA } = await setup(t);
    await t.mutation(internal.sync.registerDeviceCore, { deviceId: "tablet-1", storeId: storeA });
    await reportPending(t, storeA, "tablet-1", 0);
    await managerA.mutation(api.devices.retire, { deviceId: "tablet-1", storeId: storeA });

    const { storeId: storeB, asUser: managerB } = await setup(t);
    const { deviceCode } = await managerB.mutation(api.devices.commission, {
      deviceId: "tablet-1",
      storeId: storeB,
    });

    // Day closing has to be able to read the tablet at its new store.
    await expect(
      managerB.mutation(api.closing.confirmReadyForDayClosing, {
        storeId: storeB,
        deviceId: "tablet-1",
        generation: "g2",
        pendingCount: 0,
        clientNow: Date.now(),
      }),
    ).resolves.toBeDefined();

    // And the active binding is the new one, not the retired row.
    const active = (await bindings(t, "tablet-1")).find((row: any) => row.retiredAt === undefined);
    expect(active.storeId).toBe(storeB);
    expect(active.deviceCode).toBe(deviceCode);
  });

  it("commissions a tablet that has no prior binding, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const { storeId, asUser } = await setup(t);

    const first = await asUser.mutation(api.devices.commission, {
      deviceId: "tablet-new",
      storeId,
    });
    const again = await asUser.mutation(api.devices.commission, {
      deviceId: "tablet-new",
      storeId,
    });

    expect(again.deviceCode).toBe(first.deviceCode);
    expect(await bindings(t, "tablet-new")).toHaveLength(1);
  });

  it("lets a retired tablet register against its new store again", async () => {
    const t = convexTest(schema, modules);
    const { storeId: storeA, asUser: managerA } = await setup(t);
    await t.mutation(internal.sync.registerDeviceCore, { deviceId: "tablet-1", storeId: storeA });
    await reportPending(t, storeA, "tablet-1", 0);
    await managerA.mutation(api.devices.retire, { deviceId: "tablet-1", storeId: storeA });

    const { storeId: storeB } = await setup(t);
    const result = await t.mutation(internal.sync.registerDeviceCore, {
      deviceId: "tablet-1",
      storeId: storeB,
    });
    expect(result.deviceCode).toBeTruthy();
  });
});
