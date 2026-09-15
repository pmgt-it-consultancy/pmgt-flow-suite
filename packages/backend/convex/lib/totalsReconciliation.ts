import { aggregateOrderTotals, calculateChange, calculateItemTotals } from "@packages/shared";
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

/** Run after all related rows in a successful push, never between parent/child writes. */
export async function reconcilePushedOrder(
  ctx: MutationCtx,
  orderId: Id<"orders">,
  evidence: { deviceId: string; mutationId: string },
): Promise<void> {
  const order = await ctx.db.get(orderId);
  if (!order) return;
  // A void preserves the settled snapshot; recomputing from now-voided items would be false evidence.
  if (order.status === "voided") return;
  const store = await ctx.db.get(order.storeId);
  if (!store) return;
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
  const unresolved = await ctx.db
    .query("totalsDivergences")
    .withIndex("by_orderId_and_status", (q) => q.eq("orderId", orderId).eq("status", "unresolved"))
    .collect();
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
    reportDate: getBusinessDayBoundaries(store.schedule, order.createdAt).businessDate,
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
