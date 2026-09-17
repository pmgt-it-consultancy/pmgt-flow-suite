import * as shared from "@packages/shared";
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "../testUtils/scheduledTest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const createdAt = Date.parse("2026-09-15T05:00:00Z");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const roleId = await ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["reports.print_eod", "reports.daily"],
      scopeLevel: "branch",
      isSystem: false,
    });
    const storeId = await ctx.db.insert("stores", {
      name: "Test",
      address1: "Test",
      tin: "TEST",
      min: "TEST",
      vatRate: 12,
      isActive: true,
      createdAt,
    });
    const userId = await ctx.db.insert("users", {
      name: "Manager",
      roleId,
      storeId,
      isActive: true,
    });
    const categoryId = await ctx.db.insert("categories", {
      storeId,
      name: "Food",
      sortOrder: 0,
      isActive: true,
      createdAt,
    });
    const productId = await ctx.db.insert("products", {
      storeId,
      categoryId,
      name: "Meal",
      price: 112,
      isVatable: true,
      isActive: true,
      sortOrder: 0,
      createdAt,
      updatedAt: createdAt,
    });
    return { storeId, userId, productId };
  });
  const actor = t.withIdentity({ subject: ids.userId });
  async function push(
    netSales = 111,
    mutationId = "sale-1",
    includeItem = true,
    extraChanges: Record<string, unknown> = {},
    orderOverrides: Record<string, unknown> = {},
  ) {
    return t.mutation(internal.sync.syncPushCore, {
      ...{ storeId: ids.storeId, userId: ids.userId },
      deviceId: "tablet-1",
      payload: {
        clientMutationId: mutationId,
        changes: {
          orders: {
            created: [
              {
                id: "order-1",
                orderType: "takeout",
                status: "paid",
                orderNumber: "T-A001",
                grossSales: 112,
                vatableSales: 100,
                vatAmount: 12,
                vatExemptSales: 0,
                nonVatSales: 0,
                discountAmount: 0,
                netSales,
                createdAt,
                paidAt: createdAt,
                paymentMethod: "cash",
                itemCount: 1,
                ...orderOverrides,
              },
            ],
            updated: [],
            deleted: [],
          },
          ...(includeItem
            ? {
                orderItems: {
                  created: [
                    {
                      id: "item-1",
                      orderId: "order-1",
                      productId: ids.productId,
                      productName: "Meal",
                      productPrice: 112,
                      quantity: 1,
                    },
                  ],
                  updated: [],
                  deleted: [],
                },
              }
            : {}),
          ...extraChanges,
        },
      },
    });
  }
  return { t, actor, ...ids, push };
}

describe("Totals Reconciliation at push and closing boundaries", () => {
  it("blocks both days when an unchecked paid sale is moved and voided before its worker", async () => {
    const { t, actor, storeId, push } = await setup();
    await push();
    expect(
      await push(
        111,
        "moved-void",
        false,
        {},
        {
          status: "voided",
          createdAt: createdAt + 86400000,
        },
      ),
    ).toEqual({ success: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const reportDate of ["2026-09-15", "2026-09-16"]) {
      await expect(
        actor.mutation(api.closing.logDayClosing, { storeId, reportDate }),
      ).rejects.toThrow("Totals Reconciliation pending");
    }
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toMatchObject([{ mutationId: "sale-1", status: "failed" }]);
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-16",
      }),
    ).toMatchObject([{ mutationId: "moved-void", status: "failed" }]);
  });

  it("recognizes an unchanged verified aggregate after a fresh replay and overtaking void", async () => {
    const { t, actor, storeId, productId, push } = await setup();
    await push(112);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await push(112, "identical-replay");
    expect(
      await push(
        112,
        "void-replayed-sale",
        false,
        {
          orderItems: {
            updated: [
              {
                id: "item-1",
                orderId: "order-1",
                productId,
                productName: "Meal",
                productPrice: 112,
                quantity: 1,
                isVoided: true,
              },
            ],
          },
        },
        { status: "voided" },
      ),
    ).toEqual({ success: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("totalsReconciliationJobs").collect())).toMatchObject([
      { mutationId: "void-replayed-sale", checkedPaidMutationId: "sale-1" },
    ]);
  });

  it.each([
    {
      kind: "modifier",
      changes: {
        orderItemModifiers: {
          created: [
            {
              id: "new-modifier",
              orderItemId: "item-1",
              modifierGroupName: "Add-ons",
              modifierOptionName: "Extra",
              priceAdjustment: 20,
            },
          ],
        },
      },
    },
    {
      kind: "discount",
      changes: {
        orderDiscounts: {
          created: [
            {
              id: "new-discount",
              orderId: "order-1",
              discountType: "manual",
              customerName: "",
              customerId: "",
              quantityApplied: 0,
              discountAmount: 20,
              vatExemptAmount: 0,
            },
          ],
        },
      },
    },
    {
      kind: "payment",
      changes: {
        orderPayments: {
          created: [
            {
              id: "new-payment",
              orderId: "order-1",
              paymentMethod: "cash",
              amount: 50,
              createdAt,
            },
          ],
        },
      },
    },
  ])("blocks a new $kind on a formerly checked aggregate when its replay is overtaken by void", async ({
    changes,
  }) => {
    const { t, actor, storeId, push } = await setup();
    await push(112);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await push(112, "changed-child-replay", false, changes)).toEqual({ success: true });
    await push(112, "void-changed-replay", false, {}, { status: "voided" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).rejects.toThrow("Totals Reconciliation pending");
  });

  it.each([
    false,
    true,
  ])("blocks changed child money despite unchanged checked parent totals (replay=%s)", async (replay) => {
    const { t, actor, storeId, productId, push } = await setup();
    await push(112);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    if (replay) await push(112, "identical-replay");
    expect(
      await push(
        112,
        "void-altered-child",
        false,
        {
          orderItems: {
            updated: [
              {
                id: "item-1",
                orderId: "order-1",
                productId,
                productName: "Meal",
                productPrice: 224,
                quantity: 1,
                isVoided: true,
              },
            ],
          },
        },
        { status: "voided" },
      ),
    ).toEqual({ success: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).rejects.toThrow("Totals Reconciliation pending");
    expect(
      await actor.query(api.closing.getTotalsDivergences, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toEqual([]);
  });

  it("keeps a verified paid snapshot closeable after a void preserves its historical totals", async () => {
    const { t, actor, storeId, productId, push } = await setup();
    await push(112);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await push(
        112,
        "void-verified-sale",
        false,
        {
          orderItems: {
            updated: [
              {
                id: "item-1",
                orderId: "order-1",
                productId,
                productName: "Meal",
                productPrice: 112,
                quantity: 1,
                isVoided: true,
              },
            ],
          },
        },
        { status: "voided" },
      ),
    ).toEqual({ success: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("orders").first())).toMatchObject({
      status: "voided",
      netSales: 112,
      grossSales: 112,
    });
    expect(await t.run((ctx) => ctx.db.query("orderItems").first())).toMatchObject({
      isVoided: true,
    });
  });

  it("preserves a checked divergence when a void retains the historical totals", async () => {
    const { t, actor, storeId, push } = await setup();
    await push();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await push(111, "void-divergent-sale", false, {}, { status: "voided" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).rejects.toThrow("Unresolved Totals Divergences");
    expect(await t.run((ctx) => ctx.db.query("totalsDivergences").collect())).toMatchObject([
      { mutationId: "sale-1", status: "unresolved" },
    ]);
  });

  it("does not block closing for an order voided before it was ever paid", async () => {
    const { t, actor, storeId, push } = await setup();
    const unpaid = { status: "open", paidAt: undefined, paymentMethod: undefined };
    // Open-order totals may lag the device; the checked mismatch must not outlive the cancel.
    await push(111, "open-order", true, {}, unpaid);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("totalsDivergences").collect())).toHaveLength(1);
    await push(111, "cancel-open-order", false, {}, { ...unpaid, status: "voided" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toEqual([]);
    expect(
      await actor.query(api.closing.getTotalsDivergences, { storeId, reportDate: "2026-09-15" }),
    ).toEqual([]);
    await expect(
      actor.mutation(api.closing.logDayClosing, { storeId, reportDate: "2026-09-15" }),
    ).resolves.toBeNull();
  });

  it("does not block closing for an unpaid order voided before its worker ran", async () => {
    const { t, actor, storeId, push } = await setup();
    const unpaid = { status: "open", paidAt: undefined, paymentMethod: undefined };
    await push(112, "open-order", true, {}, unpaid);
    await push(112, "cancel-open-order", false, {}, { ...unpaid, status: "voided" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toEqual([]);
  });

  it("blocks a void that changes historical money after the paid snapshot was checked", async () => {
    const { t, actor, storeId, push } = await setup();
    await push(112);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await push(110, "void-changed-sale", false, {}, { status: "voided" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toMatchObject([{ status: "failed", blockedReason: "void_snapshot_unavailable" }]);
  });

  it("rechecks the original scope after an explicit replay restores it", async () => {
    const { t, actor, storeId, push } = await setup();
    await push();
    await push(112, "moved-sale", false, {}, { createdAt: createdAt + 86400000 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await push(112, "restored-sale", false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).resolves.toBeNull();
  });

  it("leaves failed calculations pending and permits an authorized idempotent retry", async () => {
    const { t, actor, storeId, push } = await setup();
    await push();
    const [job] = await t.run((ctx) => ctx.db.query("totalsReconciliationJobs").collect());
    // Isolate a worker invocation so its expected exception is observed by the test.
    await t.run((ctx) => ctx.scheduler.cancel(job.scheduledFunctionId!));
    const calculation = vi.spyOn(shared, "aggregateOrderTotals").mockImplementationOnce(() => {
      throw new Error("calculation failed");
    });
    try {
      await expect(
        t.mutation(internal.sync.reconcileOrderTotals, { jobId: job._id }),
      ).rejects.toThrow("calculation failed");
    } finally {
      calculation.mockRestore();
    }
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toMatchObject([{ status: "failed", mutationId: "sale-1" }]);
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).rejects.toThrow("Totals Reconciliation pending");
    await actor.mutation(api.closing.retryTotalsReconciliation, { jobId: job._id });
    await actor.mutation(api.closing.retryTotalsReconciliation, { jobId: job._id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("totalsDivergences").collect())).toMatchObject([
      { mutationId: "sale-1" },
    ]);
    await push(112, "corrected-after-failure", false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("totalsDivergences").collect())).toMatchObject([
      { status: "resolved", resolvedByMutationId: "corrected-after-failure" },
    ]);
  });

  it("coalesces queued replays and records the latest accepted mutation", async () => {
    const { t, push } = await setup();
    await push();
    await push(110, "latest-sale", false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("totalsDivergences").collect())).toMatchObject([
      { mutationId: "latest-sale", deviceTotals: { netSales: 110 } },
    ]);
    expect(await t.run((ctx) => ctx.db.query("totalsReconciliationJobs").collect())).toHaveLength(
      1,
    );
  });

  it("restricts retries to authorized staff in the job's store", async () => {
    const { t, actor, userId, push } = await setup();
    await push();
    const [job] = await t.run((ctx) => ctx.db.query("totalsReconciliationJobs").collect());
    await expect(
      t.mutation(api.closing.retryTotalsReconciliation, { jobId: job._id }),
    ).rejects.toThrow("Authentication required");
    await t.run((ctx) => ctx.db.patch(userId, { roleId: undefined }));
    await expect(
      actor.mutation(api.closing.retryTotalsReconciliation, { jobId: job._id }),
    ).rejects.toThrow("Permission denied");
    const otherStore = await t.run((ctx) =>
      ctx.db.insert("stores", {
        name: "Other",
        address1: "Other",
        tin: "OTHER",
        min: "OTHER",
        vatRate: 12,
        isActive: true,
        createdAt,
      }),
    );
    await t.run((ctx) => ctx.db.patch(userId, { storeId: otherStore }));
    await expect(
      actor.mutation(api.closing.retryTotalsReconciliation, { jobId: job._id }),
    ).rejects.toThrow("Authentication required");
    await expect(
      actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId: job.storeId,
        reportDate: job.reportDate,
      }),
    ).rejects.toThrow("Authentication required");
  });

  it("does not resolve checked evidence from another day when the moved order matches", async () => {
    const { t, actor, storeId, push } = await setup();
    await push();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await push(112, "moved-correct-sale", false, {}, { createdAt: createdAt + 86400000 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getTotalsDivergences, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toHaveLength(1);
  });

  it("retains the unchecked paid snapshot and blocks closing when void overtakes its worker", async () => {
    const { t, actor, storeId, push } = await setup();
    await push();
    await push(111, "void-sale", false, {}, { status: "voided" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toMatchObject([
      { mutationId: "sale-1", status: "failed", blockedReason: "void_snapshot_unavailable" },
    ]);
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).rejects.toThrow("Totals Reconciliation pending");
    expect(await t.run((ctx) => ctx.db.query("orders").first())).toMatchObject({ netSales: 111 });
    expect(
      await actor.query(api.closing.getTotalsDivergences, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toEqual([]);
  });

  it("keeps old-day evidence blocked and attributes a moved order only to its new mutation", async () => {
    const { t, actor, storeId, push } = await setup();
    await push();
    await push(111, "moved-sale", false, {}, { createdAt: createdAt + 86400000 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toMatchObject([
      { mutationId: "sale-1", status: "failed", blockedReason: "snapshot_superseded" },
    ]);
    expect(await t.run((ctx) => ctx.db.query("totalsDivergences").collect())).toMatchObject([
      { reportDate: "2026-09-16", mutationId: "moved-sale", deviceTotals: { netSales: 111 } },
    ]);
    await push(112, "correct-moved-sale", false, {}, { createdAt: createdAt + 86400000 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).rejects.toThrow("Totals Reconciliation pending");
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-16",
      }),
    ).resolves.toBeNull();
  });

  it("refuses to check an aggregate under a changed store schedule", async () => {
    const { t, actor, storeId, push } = await setup();
    await push();
    const day = { open: "06:00", close: "12:00" };
    await t.run((ctx) =>
      ctx.db.patch(storeId, {
        schedule: {
          monday: day,
          tuesday: day,
          wednesday: day,
          thursday: day,
          friday: day,
          saturday: day,
          sunday: day,
        },
      }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getPendingTotalsReconciliations, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toMatchObject([{ mutationId: "sale-1", status: "failed", blockedReason: "scope_changed" }]);
    expect(
      await actor.query(api.closing.getTotalsDivergences, {
        storeId,
        reportDate: "2026-09-16",
      }),
    ).toEqual([]);
  });

  it("accepts the sale before checking totals and prevents closing its pending day", async () => {
    const { t, actor, storeId, push } = await setup();
    expect(await push()).toEqual({ success: true });
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).rejects.toThrow("Totals Reconciliation pending");
    await expect(
      actor.mutation(api.closing.logDayClosing, {
        storeId,
        reportDate: "2026-09-14",
      }),
    ).resolves.toBeNull();
    expect(
      await actor.query(api.closing.getTotalsDivergences, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getTotalsDivergences, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toHaveLength(1);
  });

  it("accepts a divergent sale, preserves its totals, and records one discrepancy across retries", async () => {
    const { t, actor, storeId, push } = await setup();
    expect(await push()).toEqual({ success: true });
    expect(await push()).toEqual({ success: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const records = await actor.query(api.closing.getTotalsDivergences, {
      storeId,
      reportDate: "2026-09-15",
    });
    expect(records).toHaveLength(1);
    expect(records[0].deviceTotals.netSales).toBe(111);
    expect(records[0].reconciledTotals.netSales).toBe(112);
    expect(records[0].fields).toEqual(["netSales"]);
  });

  it("does not flag the intermediate order before the same push applies its item", async () => {
    const { t, actor, storeId, push } = await setup();
    expect(await push(112)).toEqual({ success: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getTotalsDivergences, { storeId, reportDate: "2026-09-15" }),
    ).toEqual([]);
  });

  it("blocks closing only the affected day and resolves only after a matching replay", async () => {
    const { t, actor, storeId, push } = await setup();
    await push();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(
      actor.mutation(api.closing.logDayClosing, { storeId, reportDate: "2026-09-15" }),
    ).rejects.toThrow("Totals Divergences");
    await expect(
      actor.mutation(api.closing.logDayClosing, { storeId, reportDate: "2026-09-14" }),
    ).resolves.toBeNull();
    await push(112, "sale-correction", false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getTotalsDivergences, { storeId, reportDate: "2026-09-15" }),
    ).toEqual([]);
    await expect(
      actor.mutation(api.closing.logDayClosing, { storeId, reportDate: "2026-09-15" }),
    ).resolves.toBeNull();
  });

  it("does not expose another store's financial evidence", async () => {
    const { t, actor, push } = await setup();
    await push();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const otherStore = await t.run((ctx) =>
      ctx.db.insert("stores", {
        name: "Other",
        address1: "Other",
        tin: "OTHER",
        min: "OTHER",
        vatRate: 12,
        isActive: true,
        createdAt,
      }),
    );
    await expect(
      actor.query(api.closing.getTotalsDivergences, {
        storeId: otherStore,
        reportDate: "2026-09-15",
      }),
    ).rejects.toThrow();
  });

  it("checks accepted sales even when an unrelated row was rejected", async () => {
    const { t, actor, storeId, push } = await setup();
    const rejectedChanges = { tables: { created: [], updated: [{ id: "missing-table" }] } };
    const response = await push(111, "mixed-push", true, rejectedChanges);
    expect(response).toMatchObject({ rejected: [{ table: "tables", clientId: "missing-table" }] });
    expect(await push(111, "mixed-push", true, rejectedChanges)).toEqual(response);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getTotalsDivergences, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toMatchObject([{ deviceTotals: { netSales: 111 } }]);
  });

  it("checks discount deletion even when no parent row is pushed", async () => {
    const { t, actor, storeId, userId, push } = await setup();
    await push(112, "with-discount", true, {
      orderDiscounts: {
        created: [
          {
            id: "discount-1",
            orderId: "order-1",
            discountType: "manual",
            customerName: "",
            customerId: "",
            quantityApplied: 0,
            discountAmount: 12,
            vatExemptAmount: 0,
          },
        ],
      },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getTotalsDivergences, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toHaveLength(1);
    expect(
      await t.mutation(internal.sync.syncPushCore, {
        storeId,
        userId,
        deviceId: "tablet-1",
        payload: {
          clientMutationId: "delete-discount",
          changes: {
            orderDiscounts: { deleted: ["discount-1"] },
          },
        },
      }),
    ).toEqual({ success: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await actor.query(api.closing.getTotalsDivergences, {
        storeId,
        reportDate: "2026-09-15",
      }),
    ).toEqual([]);
  });
});
