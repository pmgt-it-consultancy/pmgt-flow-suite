import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

it("repairs legacy option visibility on incremental sync without changing option identity or price", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://aromatic-dalmatian-30.convex.site");
  const t = convexTest(schema, modules);
  const { storeId, groupId, optionId } = await t.run(async (ctx) => {
    const storeId = await ctx.db.insert("stores", {
      name: "Test",
      address1: "Test",
      tin: "Test",
      min: "Test",
      vatRate: 12,
      isActive: true,
      createdAt: 1,
    });
    const groupId = await ctx.db.insert("modifierGroups", {
      storeId,
      name: "Drink Size",
      selectionType: "single",
      minSelections: 1,
      sortOrder: 0,
      isActive: true,
      createdAt: 1,
    });
    const optionId = await ctx.db.insert("modifierOptions", {
      modifierGroupId: groupId,
      name: "Large",
      priceAdjustment: 20,
      isDefault: false,
      isAvailable: true,
      sortOrder: 0,
      createdAt: 1,
    });
    return { storeId, groupId, optionId };
  });
  const pull = () =>
    t.query(internal.sync.pullTablePage, {
      storeId,
      table: "modifierOptions",
      since: Date.now() - 1000,
      cursor: null,
      fkFields: ["modifierGroupId"],
    });
  const before = await pull();
  expect([...before.bucket.created, ...before.bucket.updated]).toHaveLength(0);
  const preview = await t.mutation(internal.modifierMaintenance.repairLegacyOptions, {
    dryRun: true,
  });
  expect(preview.repairable).toBe(1);
  expect((await pull()).bucket.created).toHaveLength(0);
  await t.mutation(internal.modifierMaintenance.repairLegacyOptions, { dryRun: false });
  const after = await pull();
  expect([...after.bucket.created, ...after.bucket.updated]).toEqual([
    expect.objectContaining({
      id: optionId,
      modifierGroupId: groupId,
      name: "Large",
      priceAdjustment: 20,
      isAvailable: true,
    }),
  ]);
  expect(
    await t.mutation(internal.modifierMaintenance.repairLegacyOptions, { dryRun: false }),
  ).toEqual({ scanned: 0, repairable: 0, patched: 0, orphaned: 0 });
});

it("refuses to repair any non-staging deployment", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://loyal-shark-813.convex.site");
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(internal.modifierMaintenance.repairLegacyOptions, { dryRun: false }),
  ).rejects.toThrow("staging");
});
