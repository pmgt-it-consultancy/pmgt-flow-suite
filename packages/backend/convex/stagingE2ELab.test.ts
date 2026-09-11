import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

async function seedRoles(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["system.settings"],
      scopeLevel: "branch",
      isSystem: true,
    });
    await ctx.db.insert("roles", {
      name: "Staff",
      permissions: [],
      scopeLevel: "branch",
      isSystem: true,
    });
  });
}

it("creates one isolated lab store and reuses it on retry", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://aromatic-dalmatian-30.convex.site");
  const t = convexTest(schema, modules);
  await seedRoles(t);

  const first = await t.mutation(internal.stagingE2ELabData.prepareLab, {});
  const second = await t.mutation(internal.stagingE2ELabData.prepareLab, {});
  const discovered = await t.query(internal.stagingE2ELabData.getLab, {});

  expect(first.created).toBe(true);
  expect(second).toEqual({ ...first, created: false });
  expect(discovered).toEqual({ storeId: first.storeId });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("stores")
        .withIndex("by_tin", (q) => q.eq("tin", "STAGING-BSE2E"))
        .collect(),
    ),
  ).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.get(first.storeId))).not.toHaveProperty("clientId");
});

it("assigns dedicated users to the lab without changing another store", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://aromatic-dalmatian-30.convex.site");
  const t = convexTest(schema, modules);
  await seedRoles(t);
  const lab = await t.mutation(internal.stagingE2ELabData.prepareLab, {});
  const unrelatedStoreId = await t.run((ctx) =>
    ctx.db.insert("stores", {
      name: "Existing store",
      address1: "Existing",
      tin: "EXISTING",
      min: "EXISTING",
      vatRate: 12,
      isActive: true,
      createdAt: 1,
    }),
  );
  const managerUserId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "manager@bounded-sync.test", isActive: false }),
  );
  const cashierUserId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "cashier@bounded-sync.test", isActive: false }),
  );

  await t.mutation(internal.stagingE2ELabData.assignUser, {
    userId: managerUserId,
    storeId: lab.storeId,
    roleId: lab.managerRoleId,
  });
  await t.mutation(internal.stagingE2ELabData.assignUser, {
    userId: cashierUserId,
    storeId: lab.storeId,
    roleId: lab.cashierRoleId,
  });

  expect(await t.run((ctx) => ctx.db.get(managerUserId))).toMatchObject({
    storeId: lab.storeId,
    roleId: lab.managerRoleId,
    isActive: true,
  });
  expect(await t.run((ctx) => ctx.db.get(cashierUserId))).toMatchObject({
    storeId: lab.storeId,
    roleId: lab.cashierRoleId,
    isActive: true,
  });
  expect(await t.run((ctx) => ctx.db.get(unrelatedStoreId))).toMatchObject({
    name: "Existing store",
  });
});

it("refuses provisioning outside the approved staging deployment", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://loyal-shark-813.convex.site");
  const t = convexTest(schema, modules);
  await seedRoles(t);

  await expect(t.mutation(internal.stagingE2ELabData.prepareLab, {})).rejects.toThrow(
    "approved staging deployment",
  );
});
