import { aggregateOrderTotals, calculateChange, calculateItemTotals } from "@packages/shared";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getBusinessDayBoundaries } from "./businessDay";

const moneyFields = [
  "grossSales",
  "vatableSales",
  "vatAmount",
  "vatExemptSales",
  "nonVatSales",
  "discountAmount",
  "netSales",
] as const;

export function paidTotalsSnapshotKey(order: Doc<"orders">) {
  return JSON.stringify([
    ...moneyFields.map((field) => order[field]),
    order.paymentMethod,
    order.cashReceived,
    order.changeGiven,
  ]);
}

export function reconciliationScope(store: Doc<"stores">, order: Doc<"orders">) {
  const boundaries = getBusinessDayBoundaries(store.schedule, order.createdAt);
  return {
    reportDate: boundaries.businessDate,
    // The relevant schedule boundaries and VAT rate are part of the reference snapshot.
    scopeKey: JSON.stringify([order.storeId, order.createdAt, boundaries, store.vatRate]),
  };
}

export async function scheduleTotalsReconciliation(
  ctx: MutationCtx,
  jobId: Id<"totalsReconciliationJobs">,
) {
  try {
    const scheduledFunctionId = await ctx.scheduler.runAfter(
      0,
      internal.sync.reconcileOrderTotals,
      {
        jobId,
      },
    );
    await ctx.db.patch(jobId, { scheduledFunctionId });
  } catch {
    // The durable pending record keeps closing blocked and permits an explicit retry.
    await ctx.db.patch(jobId, { scheduledFunctionId: undefined });
  }
}

export async function queueTotalsReconciliation(
  ctx: MutationCtx,
  orderId: Id<"orders">,
  evidence: { deviceId: string; mutationId: string },
) {
  const order = await ctx.db.get(orderId);
  if (!order) return;
  const store = await ctx.db.get(order.storeId);
  if (!store) return;
  const scope = reconciliationScope(store, order);
  const existing = await ctx.db
    .query("totalsReconciliationJobs")
    .withIndex("by_orderId_and_generation", (q) => q.eq("orderId", orderId))
    .order("desc")
    .first();
  // A full void retains historical money. Keep the completed check and any
  // unresolved discrepancy when that exact paid snapshot has already been checked.
  if (
    order.status === "voided" &&
    existing?.status === "complete" &&
    existing.scopeKey === scope.scopeKey &&
    existing.checkedPaidTotalsKey === paidTotalsSnapshotKey(order)
  )
    return;
  // The historical paid aggregate is no longer available after a void. Retain its
  // provenance instead of replacing it with an unchecked void's mutation ID.
  if (order.status === "voided" && existing?.status === "pending") {
    await ctx.db.patch(existing._id, { blockedReason: "void_snapshot_unavailable" });
    return;
  }
  const sameScope =
    existing?.scopeKey === scope.scopeKey
      ? existing
      : await ctx.db
          .query("totalsReconciliationJobs")
          .withIndex("by_orderId_and_scopeKey", (q) =>
            q.eq("orderId", orderId).eq("scopeKey", scope.scopeKey),
          )
          .unique();
  if (existing?.status === "pending" && existing._id !== sameScope?._id) {
    await ctx.db.patch(existing._id, { blockedReason: "snapshot_superseded" });
  }
  const generation = (existing?.generation ?? 0) + 1;
  const blockedReason = order.status === "voided" ? "void_snapshot_unavailable" : undefined;
  const jobId = sameScope
    ? sameScope._id
    : await ctx.db.insert("totalsReconciliationJobs", {
        storeId: order.storeId,
        orderId,
        ...scope,
        ...evidence,
        status: "pending",
        generation,
        orderCreatedAt: order.createdAt,
        blockedReason,
      });
  if (sameScope) {
    await ctx.db.patch(jobId, { ...evidence, generation, status: "pending", blockedReason });
    const scheduled = sameScope.scheduledFunctionId
      ? await ctx.db.system.get(sameScope.scheduledFunctionId)
      : null;
    if (
      sameScope.status === "pending" &&
      (scheduled?.state.kind === "pending" || scheduled?.state.kind === "inProgress")
    )
      return;
  }
  await scheduleTotalsReconciliation(ctx, jobId);
}

export function pendingTotalsReconciliations(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"stores">,
  reportDate: string,
) {
  return ctx.db
    .query("totalsReconciliationJobs")
    .withIndex("by_storeId_and_reportDate_and_status", (q) =>
      q.eq("storeId", storeId).eq("reportDate", reportDate).eq("status", "pending"),
    );
}

/** Run after all related rows in a successful push, never between parent/child writes. */
export async function reconcilePushedOrder(
  ctx: MutationCtx,
  orderId: Id<"orders">,
  evidence: { deviceId: string; mutationId: string },
): Promise<void> {
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("Order snapshot unavailable");
  // A void preserves the settled snapshot; recomputing from now-voided items would be false evidence.
  if (order.status === "voided") throw new Error("Voided order snapshot unavailable");
  const store = await ctx.db.get(order.storeId);
  if (!store) throw new Error("Store snapshot unavailable");
  const reportDate = getBusinessDayBoundaries(store.schedule, order.createdAt).businessDate;
  const items = await ctx.db
    .query("orderItems")
    .withIndex("by_order", (q) => q.eq("orderId", orderId))
    .collect();
  const discounts = await ctx.db
    .query("orderDiscounts")
    .withIndex("by_order", (q) => q.eq("orderId", orderId))
    .collect();
  const calculations = await Promise.all(
    items
      .filter((item) => !item.isVoided)
      .map(async (item) => {
        const product = await ctx.db.get(item.productId);
        const modifiers = await ctx.db
          .query("orderItemModifiers")
          .withIndex("by_orderItem", (q) => q.eq("orderItemId", item._id))
          .collect();
        const modifierTotal = modifiers.reduce(
          (sum, modifier) => sum + modifier.priceAdjustment,
          0,
        );
        const discountedQuantity = discounts
          .filter((d) => d.orderItemId === item._id)
          .reduce((sum, d) => sum + d.quantityApplied, 0);
        return calculateItemTotals(
          item.productPrice + modifierTotal,
          item.quantity,
          product?.isVatable ?? false,
          discountedQuantity,
          store.vatRate,
        );
      }),
  );
  const totals = aggregateOrderTotals(calculations);
  const globalDiscount = discounts
    .filter((d) => !d.orderItemId)
    .reduce((sum, d) => sum + d.discountAmount, 0);
  // Match the existing device checkout contract, including its unrounded global discount subtraction.
  if (globalDiscount > 0) {
    totals.discountAmount += globalDiscount;
    totals.netSales = Math.max(0, totals.netSales - globalDiscount);
  }
  const deviceTotals: Record<string, number> = {};
  const reconciledTotals: Record<string, number> = {};
  const fields: string[] = [];
  for (const field of moneyFields) {
    deviceTotals[field] = order[field];
    reconciledTotals[field] = totals[field];
    if (order[field] !== totals[field]) fields.push(field);
  }
  const payments = await ctx.db
    .query("orderPayments")
    .withIndex("by_order", (q) => q.eq("orderId", orderId))
    .collect();
  // Older orders only have legacy payment fields. Compare payment rows only when they exist.
  if (order.status === "paid" && payments.length > 0) {
    const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    deviceTotals.paymentTotal = paid;
    reconciledTotals.paymentTotal = totals.netSales;
    if (calculateChange(totals.netSales, paid) !== 0) fields.push("paymentTotal");
  }
  const orderDivergences = await ctx.db
    .query("totalsDivergences")
    .withIndex("by_orderId_and_status", (q) => q.eq("orderId", orderId).eq("status", "unresolved"))
    .collect();
  // A check on a new Business Day cannot resolve or deduplicate another day's evidence.
  const unresolved = orderDivergences.filter((record) => record.reportDate === reportDate);
  if (fields.length === 0) {
    for (const record of unresolved)
      await ctx.db.patch(record._id, {
        status: "resolved",
        resolvedAt: Date.now(),
        resolvedByMutationId: evidence.mutationId,
      });
    return;
  }
  // A new mutation with the identical mismatch must not flood the closing screen.
  if (unresolved.some((record) => sameEvidence(record, deviceTotals, reconciledTotals, fields)))
    return;
  await ctx.db.insert("totalsDivergences", {
    storeId: order.storeId,
    orderId,
    reportDate,
    ...evidence,
    status: "unresolved",
    deviceTotals,
    reconciledTotals,
    fields,
    createdAt: Date.now(),
  });
}

function sameEvidence(
  record: Doc<"totalsDivergences">,
  device: Record<string, number>,
  reference: Record<string, number>,
  fields: string[],
): boolean {
  return (
    record.fields.join(",") === fields.join(",") &&
    Object.keys(device).length === Object.keys(record.deviceTotals).length &&
    Object.keys(device).every(
      (key) =>
        record.deviceTotals[key] === device[key] && record.reconciledTotals[key] === reference[key],
    )
  );
}

export function unresolvedTotalsDivergences(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"stores">,
  reportDate: string,
) {
  return ctx.db
    .query("totalsDivergences")
    .withIndex("by_storeId_and_reportDate_and_status", (q) =>
      q.eq("storeId", storeId).eq("reportDate", reportDate).eq("status", "unresolved"),
    )
    .collect();
}
