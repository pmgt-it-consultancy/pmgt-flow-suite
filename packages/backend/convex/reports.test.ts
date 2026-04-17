import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2026-04-16 is a Thursday PHT. 17:00 PHT Thu = 09:00 UTC Thu.
// 00:30 PHT Fri = 16:30 UTC Thu.
const THU_APR_16 = "2026-04-16";
const UTC_THU_APR_16_18_00 = new Date("2026-04-16T10:00:00Z").getTime(); // 18:00 PHT Thu
const UTC_FRI_APR_17_00_30 = new Date("2026-04-16T16:30:00Z").getTime(); // 00:30 PHT Fri

const LATE_NIGHT_SCHEDULE = {
  monday: { open: "17:00", close: "01:00" },
  tuesday: { open: "17:00", close: "01:00" },
  wednesday: { open: "17:00", close: "01:00" },
  thursday: { open: "17:00", close: "01:00" },
  friday: { open: "17:00", close: "01:00" },
  saturday: { open: "17:00", close: "01:00" },
  sunday: { open: "17:00", close: "01:00" },
};

async function setupStoreWithSchedule(t: any, schedule?: any) {
  const roleId = await t.run(async (ctx: any) =>
    ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["reports.view", "reports.generate"],
      scopeLevel: "branch",
      isSystem: false,
    }),
  );
  const storeId = await t.run(async (ctx: any) =>
    ctx.db.insert("stores", {
      name: "Kusina ng Nanay",
      address1: "1 Test St",
      tin: "111-222-333-000",
      min: "MIN-000001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
      ...(schedule ? { schedule } : {}),
    }),
  );
  const userId = await t.run(async (ctx: any) =>
    ctx.db.insert("users", {
      name: "Cashier",
      email: "c@test.com",
      roleId,
      storeId,
      isActive: true,
    }),
  );
  return { storeId, userId };
}

async function seedPaidOrder(
  t: any,
  opts: { storeId: any; userId: any; createdAt: number; netSales: number },
) {
  await t.run(async (ctx: any) => {
    return ctx.db.insert("orders", {
      storeId: opts.storeId,
      orderNumber: "D-001",
      status: "paid",
      orderType: "dine_in",
      grossSales: opts.netSales,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: opts.netSales,
      netSales: opts.netSales,
      discountAmount: 0,
      createdBy: opts.userId,
      createdAt: opts.createdAt,
      paidAt: opts.createdAt,
      paidBy: opts.userId,
    });
  });
}

describe("generateDailyReport — schedule-aware boundaries", () => {
  it("includes 00:30 Fri order in Thu's report when schedule closes at 01:00", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupStoreWithSchedule(t, LATE_NIGHT_SCHEDULE);
    const asUser = t.withIdentity({ subject: userId });

    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_THU_APR_16_18_00, netSales: 500 });
    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_FRI_APR_17_00_30, netSales: 300 });

    await asUser.mutation(api.reports.generateDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    const report = await asUser.query(api.reports.getDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    expect(report?.transactionCount).toBe(2);
    expect(report?.grossSales).toBe(800);
  });

  it("custom range 17:00–01:00 matches schedule-aware Full Day", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupStoreWithSchedule(t, LATE_NIGHT_SCHEDULE);
    const asUser = t.withIdentity({ subject: userId });

    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_THU_APR_16_18_00, netSales: 500 });
    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_FRI_APR_17_00_30, netSales: 300 });

    await asUser.mutation(api.reports.generateDailyReport, {
      storeId,
      reportDate: THU_APR_16,
      startTime: "17:00",
      endTime: "01:00",
    });

    const report = await asUser.query(api.reports.getDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    expect(report?.transactionCount).toBe(2);
    expect(report?.grossSales).toBe(800);
  });

  it("store without schedule uses PHT midnight — excludes 00:30 Fri order from Thu", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupStoreWithSchedule(t); // no schedule
    const asUser = t.withIdentity({ subject: userId });

    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_THU_APR_16_18_00, netSales: 500 });
    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_FRI_APR_17_00_30, netSales: 300 });

    await asUser.mutation(api.reports.generateDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    const report = await asUser.query(api.reports.getDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    expect(report?.transactionCount).toBe(1);
    expect(report?.grossSales).toBe(500);
  });

  it("store without schedule + cross-midnight custom range works", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupStoreWithSchedule(t);
    const asUser = t.withIdentity({ subject: userId });

    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_THU_APR_16_18_00, netSales: 500 });
    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_FRI_APR_17_00_30, netSales: 300 });

    await asUser.mutation(api.reports.generateDailyReport, {
      storeId,
      reportDate: THU_APR_16,
      startTime: "17:00",
      endTime: "01:00",
    });

    const report = await asUser.query(api.reports.getDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    expect(report?.transactionCount).toBe(2);
    expect(report?.grossSales).toBe(800);
  });
});
