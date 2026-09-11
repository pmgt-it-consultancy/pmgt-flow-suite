import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

it("requires every non-retired registered device to be sync-clean before final closing", async () => {
  const t = convexTest(schema, modules);
  const { storeId, userId } = await t.run(async (ctx) => {
    const roleId = await ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["reports.generate"],
      scopeLevel: "branch",
      isSystem: false,
    });
    const storeId = await ctx.db.insert("stores", {
      name: "Closing Store",
      address1: "1 Test Street",
      tin: "TIN",
      min: "MIN",
      vatRate: 0.12,
      isActive: true,
      createdAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      name: "Manager",
      email: "manager@example.test",
      roleId,
      storeId,
      isActive: true,
    });
    await ctx.db.insert("appConfig", {
      storeId,
      key: "sync_clean_closing_v2",
      value: "1",
      updatedAt: 1,
    });
    for (const [deviceId, deviceCode] of [
      ["device-a", "A"],
      ["device-b", "B"],
    ]) {
      await ctx.db.insert("syncDevices", {
        deviceId,
        deviceCode,
        storeId,
        registeredAt: 1,
        lastSeenAt: 1,
      });
    }
    return { storeId, userId };
  });
  const asManager = t.withIdentity({ subject: userId });

  await asManager.mutation(api.closing.confirmReadyForDayClosing, {
    storeId,
    deviceId: "device-a",
    generation: "generation-1",
    checkpoint: "cursor-1",
    pendingCount: 0,
    clientNow: Date.now(),
  });
  const missing = await asManager.query(api.closing.getDayClosingReadiness, { storeId });
  expect(missing.ready).toBe(false);
  expect(missing.missingDeviceIds).toEqual(["device-b"]);

  await asManager.mutation(api.closing.retireDevice, {
    storeId,
    deviceId: "device-b",
    reason: "Tablet permanently lost",
  });
  const ready = await asManager.query(api.closing.getDayClosingReadiness, { storeId });
  expect(ready.ready).toBe(true);

  await asManager.mutation(api.closing.logDayClosing, {
    storeId,
    reportDate: "2026-09-11",
  });
  const revisions = await t.run(async (ctx) =>
    ctx.db
      .query("businessDayReportRevisions")
      .withIndex("by_store_date_revision", (q) =>
        q.eq("storeId", storeId).eq("reportDate", "2026-09-11"),
      )
      .collect(),
  );
  expect(revisions).toHaveLength(1);
  expect(revisions[0].status).toBe("final");
});
