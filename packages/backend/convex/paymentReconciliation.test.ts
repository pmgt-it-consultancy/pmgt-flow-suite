import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2026-04-16 is a Thursday. 13:00 PHT Apr 16 = 05:00 UTC Apr 16 — safely inside
// the PHT business day for a store with no schedule (PHT-midnight boundaries).
const REPORT_DATE = "2026-04-16";
const CREATED_AT = new Date("2026-04-16T05:00:00Z").getTime();

async function setup(t: any) {
  const roleId = await t.run(async (ctx: any) =>
    ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["reports.view", "reports.generate", "checkout.process"],
      scopeLevel: "branch",
      isSystem: false,
    }),
  );
  const storeId = await t.run(async (ctx: any) =>
    ctx.db.insert("stores", {
      name: "Reconciliation Diner",
      address1: "1 Test St",
      tin: "111-222-333-000",
      min: "MIN-000001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
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
  const categoryId = await t.run(async (ctx: any) =>
    ctx.db.insert("categories", {
      storeId,
      name: "Food",
      sortOrder: 1,
      isActive: true,
      createdAt: Date.now(),
    }),
  );
  const productId = await t.run(async (ctx: any) =>
    ctx.db.insert("products", {
      storeId,
      name: "Adobo",
      categoryId,
      price: 100,
      isVatable: true,
      isActive: true,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  return { storeId, userId, productId };
}

async function seedPaidOrder(
  t: any,
  opts: {
    storeId: any;
    userId: any;
    netSales: number;
    paymentMethod?: "cash" | "card_ewallet";
    cardPaymentType?: string;
    cardReferenceNumber?: string;
  },
): Promise<string> {
  return t.run(async (ctx: any) =>
    ctx.db.insert("orders", {
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
      ...(opts.paymentMethod ? { paymentMethod: opts.paymentMethod } : {}),
      ...(opts.cardPaymentType ? { cardPaymentType: opts.cardPaymentType } : {}),
      ...(opts.cardReferenceNumber ? { cardReferenceNumber: opts.cardReferenceNumber } : {}),
      createdBy: opts.userId,
      createdAt: CREATED_AT,
      paidAt: CREATED_AT,
      paidBy: opts.userId,
    }),
  );
}

async function seedPayment(
  t: any,
  opts: {
    orderId: string;
    storeId: any;
    userId: any;
    paymentMethod: "cash" | "card_ewallet";
    amount: number;
  },
): Promise<void> {
  await t.run(async (ctx: any) =>
    ctx.db.insert("orderPayments", {
      orderId: opts.orderId,
      storeId: opts.storeId,
      paymentMethod: opts.paymentMethod,
      amount: opts.amount,
      createdAt: CREATED_AT,
      createdBy: opts.userId,
      updatedAt: CREATED_AT,
    }),
  );
}

async function generate(t: any, storeId: any, userId: any) {
  const asUser = t.withIdentity({ subject: userId });
  await asUser.mutation(api.reports.generateDailyReport, {
    storeId,
    reportDate: REPORT_DATE,
  });
  return asUser.query(api.reports.getDailyReport, {
    storeId,
    reportDate: REPORT_DATE,
  });
}

describe("Z-report payment reconciliation — Cash + Card === Net Sales", () => {
  it("single cash payment: cashTotal equals net and breakdown sums to net", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setup(t);
    const orderId = await seedPaidOrder(t, { storeId, userId, netSales: 500 });
    await seedPayment(t, {
      orderId,
      storeId,
      userId,
      paymentMethod: "cash",
      amount: 500,
    });

    const report = await generate(t, storeId, userId);

    expect(report?.cashTotal).toBe(500);
    expect(report?.cardEwalletTotal).toBe(0);
    expect((report?.cashTotal ?? 0) + (report?.cardEwalletTotal ?? 0)).toBe(report?.netSales);
  });

  it("split cash + card payment: breakdown sums to net", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setup(t);
    const orderId = await seedPaidOrder(t, { storeId, userId, netSales: 500 });
    await seedPayment(t, {
      orderId,
      storeId,
      userId,
      paymentMethod: "cash",
      amount: 300,
    });
    await seedPayment(t, {
      orderId,
      storeId,
      userId,
      paymentMethod: "card_ewallet",
      amount: 200,
    });

    const report = await generate(t, storeId, userId);

    expect(report?.cashTotal).toBe(300);
    expect(report?.cardEwalletTotal).toBe(200);
    expect((report?.cashTotal ?? 0) + (report?.cardEwalletTotal ?? 0)).toBe(report?.netSales);
  });

  it("legacy card order (no orderPayments rows): attributed to card, balances to net", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setup(t);
    await seedPaidOrder(t, {
      storeId,
      userId,
      netSales: 450,
      paymentMethod: "card_ewallet",
    });

    const report = await generate(t, storeId, userId);

    expect(report?.cardEwalletTotal).toBe(450);
    expect(report?.cashTotal).toBe(0);
    expect((report?.cashTotal ?? 0) + (report?.cardEwalletTotal ?? 0)).toBe(report?.netSales);
  });

  it("rejects a duplicate offline payment push for an already-settled order", async () => {
    // The online processPayment mutation no-ops when order.status is already
    // "paid" (checkout.ts processPaymentCore), so a retried/double-tapped
    // checkout is safe there. The offline sync push path for orderPayments
    // (sync.ts applyPushedRow) writes rows directly and only dedupes by
    // clientId, with no equivalent check — so a double-tap on the tablet that
    // creates a second local payment record (fresh clientId, same order) gets
    // pushed and accepted as a second, independent payment, inflating the
    // Z-report's Cash/Card breakdown above net sales.
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setup(t);
    const orderId = await seedPaidOrder(t, { storeId, userId, netSales: 500 });

    const pushPayment = (clientId: string) =>
      t.mutation(internal.sync.syncPushCore, {
        storeId,
        userId,
        deviceId: "tablet-a",
        payload: {
          lastPulledAt: 0,
          clientMutationId: `push-${clientId}`,
          changes: {
            orderPayments: {
              created: [
                {
                  id: clientId,
                  orderId,
                  paymentMethod: "cash",
                  amount: 500,
                  createdAt: CREATED_AT,
                },
              ],
            },
          },
        },
      });

    await pushPayment("payment-attempt-1");
    const retryResponse = await pushPayment("payment-attempt-2");

    expect(retryResponse).toEqual({
      rejected: [
        {
          table: "orderPayments",
          clientId: "payment-attempt-2",
          reason: expect.any(String),
        },
      ],
    });

    const report = await generate(t, storeId, userId);
    expect((report?.cashTotal ?? 0) + (report?.cardEwalletTotal ?? 0)).toBe(report?.netSales);
    expect(report?.cashTotal).toBe(500);
  });

  it("paid order with no payment rows AND no paymentMethod still balances (defaults to cash)", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setup(t);
    // No orderPayments, no paymentMethod — would previously vanish from the
    // breakdown, leaving Cash + Card < Net. Must now default into cash.
    await seedPaidOrder(t, { storeId, userId, netSales: 320 });

    const report = await generate(t, storeId, userId);

    expect((report?.cashTotal ?? 0) + (report?.cardEwalletTotal ?? 0)).toBe(report?.netSales);
    expect(report?.cashTotal).toBe(320);
  });

  it("mixed orders across the day: breakdown total equals net sales", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setup(t);

    const o1 = await seedPaidOrder(t, { storeId, userId, netSales: 500 });
    await seedPayment(t, {
      orderId: o1,
      storeId,
      userId,
      paymentMethod: "cash",
      amount: 500,
    });

    const o2 = await seedPaidOrder(t, { storeId, userId, netSales: 250 });
    await seedPayment(t, {
      orderId: o2,
      storeId,
      userId,
      paymentMethod: "card_ewallet",
      amount: 250,
    });

    // Legacy + unattributed orders too.
    await seedPaidOrder(t, {
      storeId,
      userId,
      netSales: 100,
      paymentMethod: "card_ewallet",
    });
    await seedPaidOrder(t, { storeId, userId, netSales: 80 });

    const report = await generate(t, storeId, userId);

    expect(report?.netSales).toBe(930);
    expect((report?.cashTotal ?? 0) + (report?.cardEwalletTotal ?? 0)).toBe(report?.netSales);
  });
});

describe("Refund replacement order keeps the original payment method", () => {
  it("partial refund of a card order records the replacement payment as card (not cash)", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setup(t);

    // Paid card order with two items @ 100.
    const orderId = await seedPaidOrder(t, {
      storeId,
      userId,
      netSales: 200,
      paymentMethod: "card_ewallet",
      cardPaymentType: "GCash",
      cardReferenceNumber: "REF-ORIG",
    });
    const itemIds = await t.run(async (ctx: any) => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        ids.push(
          await ctx.db.insert("orderItems", {
            orderId,
            storeId,
            productId,
            productName: "Adobo",
            productPrice: 100,
            quantity: 1,
            isVoided: false,
            updatedAt: CREATED_AT,
          }),
        );
      }
      return ids;
    });

    const result = await t.mutation(internal.helpers.voidsHelpers.voidPaidOrderInternal, {
      orderId,
      refundedItemIds: [itemIds[0]],
      reason: "Customer returned one item",
      refundMethod: "card_ewallet",
      requestedBy: userId,
      approvedBy: userId,
    });

    expect(result.replacementOrderId).toBeDefined();

    const replacementPayments = await t.run(async (ctx: any) =>
      ctx.db
        .query("orderPayments")
        .withIndex("by_order", (q: any) => q.eq("orderId", result.replacementOrderId))
        .collect(),
    );

    expect(replacementPayments).toHaveLength(1);
    const payment = replacementPayments[0];
    expect(payment.paymentMethod).toBe("card_ewallet");
    expect(payment.cardPaymentType).toBe("GCash");
    expect(payment.cardReferenceNumber).toBe("REF-ORIG");
    expect(payment.amount).toBeGreaterThan(0);
    // Must be sync-visible.
    expect(payment.updatedAt).toBeDefined();
  });
});
