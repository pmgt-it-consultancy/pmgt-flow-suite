import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import { calculateChange } from "./lib/taxCalculations";

// Helper: Release table only if no other open orders remain
async function releaseTableIfLastOrder(
  ctx: { db: any },
  tableId: Id<"tables">,
  closingOrderId: Id<"orders">,
): Promise<void> {
  // Check for other open orders on this table
  const otherOpenOrders = await ctx.db
    .query("orders")
    .withIndex("by_tableId_status", (q: any) => q.eq("tableId", tableId).eq("status", "open"))
    .collect();

  // Filter out the order being closed
  const remainingOpenOrders = otherOpenOrders.filter(
    (o: { _id: Id<"orders"> }) => o._id !== closingOrderId,
  );

  // Only release table if no other open orders exist
  if (remainingOpenOrders.length === 0) {
    await ctx.db.patch(tableId, {
      status: "available",
      currentOrderId: undefined,
    });
  }
}

// Core split-payment logic shared by processPayment and legacy single-method mutations
async function processPaymentCore(
  ctx: MutationCtx,
  orderId: Id<"orders">,
  payments: Array<{
    paymentMethod: "cash" | "card_ewallet";
    amount: number;
    cashReceived?: number;
    cardPaymentType?: string;
    cardReferenceNumber?: string;
  }>,
  userId: Id<"users">,
): Promise<{ success: boolean; totalChange: number }> {
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status === "paid") return { success: true, totalChange: 0 };
  if (order.status !== "open") throw new Error("Order is not open");

  const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);
  if (totalPayments < order.netSales) throw new Error("Total payments insufficient");

  for (const payment of payments) {
    if (payment.amount <= 0) throw new Error("Payment amount must be positive");
    if (payment.paymentMethod === "card_ewallet") {
      if (!payment.cardPaymentType) throw new Error("Card payment type required");
      if (!payment.cardReferenceNumber) throw new Error("Reference number required");
    }
  }

  let totalChange = 0;
  for (const payment of payments) {
    let changeGiven: number | undefined;
    if (payment.paymentMethod === "cash" && payment.cashReceived !== undefined) {
      changeGiven = payment.cashReceived - payment.amount;
      if (changeGiven > 0) totalChange += changeGiven;
      if (changeGiven < 0) changeGiven = 0;
    }

    await ctx.db.insert("orderPayments", {
      orderId,
      storeId: order.storeId,
      paymentMethod: payment.paymentMethod,
      amount: payment.amount,
      cashReceived: payment.cashReceived,
      changeGiven,
      cardPaymentType: payment.cardPaymentType,
      cardReferenceNumber: payment.cardReferenceNumber,
      createdAt: Date.now(),
      createdBy: userId,
    });
  }

  await ctx.db.patch(orderId, {
    status: "paid",
    paidAt: Date.now(),
    paidBy: userId,
  });

  if (order.tableId) {
    await releaseTableIfLastOrder(ctx, order.tableId, orderId);
  }

  if (order.orderType === "takeout" && order.takeoutStatus === "pending") {
    await ctx.db.patch(orderId, { takeoutStatus: "preparing" });
  }

  return { success: true, totalChange };
}

// Process split or single payment (supports multiple payment methods)
export const processPayment = mutation({
  args: {
    orderId: v.id("orders"),
    payments: v.array(
      v.object({
        paymentMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
        amount: v.number(),
        cashReceived: v.optional(v.number()),
        cardPaymentType: v.optional(v.string()),
        cardReferenceNumber: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ success: v.boolean(), totalChange: v.number() }),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }
    return processPaymentCore(ctx, args.orderId, args.payments, user._id);
  },
});

// Process cash payment
export const processCashPayment = mutation({
  args: {
    orderId: v.id("orders"),
    cashReceived: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
    changeGiven: v.number(),
  }),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get order for idempotency and legacy-field checks before delegating
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      if (order.status === "paid" && order.paymentMethod === "cash") {
        return { success: true, changeGiven: order.changeGiven ?? 0 };
      }
      throw new Error("Order is not open for payment");
    }

    // Validate cash received
    if (args.cashReceived < order.netSales) {
      throw new Error("Insufficient cash received");
    }

    // Calculate change using existing helper
    const changeGiven = calculateChange(order.netSales, args.cashReceived);

    // Delegate to shared core (inserts orderPayments row + patches status/paidAt/paidBy)
    await processPaymentCore(
      ctx,
      args.orderId,
      [{ paymentMethod: "cash", amount: order.netSales, cashReceived: args.cashReceived }],
      user._id,
    );

    // Patch legacy order-level payment fields for backwards compatibility
    await ctx.db.patch(args.orderId, {
      paymentMethod: "cash",
      cashReceived: args.cashReceived,
      changeGiven,
    });

    return {
      success: true,
      changeGiven,
    };
  },
});

// Process card/e-wallet payment
export const processCardPayment = mutation({
  args: {
    orderId: v.id("orders"),
    paymentType: v.string(),
    referenceNumber: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get order for idempotency check before delegating
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      if (order.status === "paid" && order.paymentMethod === "card_ewallet") {
        return { success: true };
      }
      throw new Error("Order is not open for payment");
    }

    // Delegate to shared core (inserts orderPayments row + patches status/paidAt/paidBy)
    await processPaymentCore(
      ctx,
      args.orderId,
      [
        {
          paymentMethod: "card_ewallet",
          amount: order.netSales,
          cardPaymentType: args.paymentType,
          cardReferenceNumber: args.referenceNumber,
        },
      ],
      user._id,
    );

    // Patch legacy order-level payment fields for backwards compatibility
    await ctx.db.patch(args.orderId, {
      paymentMethod: "card_ewallet",
      cashReceived: undefined,
      changeGiven: undefined,
      cardPaymentType: args.paymentType,
      cardReferenceNumber: args.referenceNumber,
    });

    return {
      success: true,
    };
  },
});

// Get receipt data for printing
export const getReceipt = query({
  args: {
    orderId: v.id("orders"),
  },
  returns: v.union(
    v.object({
      // Store info
      storeName: v.string(),
      storeAddress1: v.string(),
      storeAddress2: v.optional(v.string()),
      tin: v.string(),
      min: v.string(),
      vatRate: v.number(),

      // Order info
      orderNumber: v.string(),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableName: v.optional(v.string()),
      pax: v.optional(v.number()),
      customerName: v.optional(v.string()),
      orderCategory: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
      tableMarker: v.optional(v.string()),
      createdAt: v.number(),
      paidAt: v.optional(v.number()),
      cashierName: v.string(),

      // Items
      items: v.array(
        v.object({
          name: v.string(),
          quantity: v.number(),
          unitPrice: v.number(),
          lineTotal: v.number(),
        }),
      ),

      // BIR-compliant breakdown
      grossSales: v.number(),
      vatableSales: v.number(),
      vatAmount: v.number(),
      vatExemptSales: v.number(),
      nonVatSales: v.number(),
      discountAmount: v.number(),
      netSales: v.number(),

      // Payment (legacy single-method fields — kept for backward compatibility)
      paymentMethod: v.optional(v.union(v.literal("cash"), v.literal("card_ewallet"))),
      cashReceived: v.optional(v.number()),
      changeGiven: v.optional(v.number()),
      cardPaymentType: v.optional(v.string()),
      cardReferenceNumber: v.optional(v.string()),

      // Payments array — populated from orderPayments table for split payments,
      // or synthesized from legacy order fields for older orders
      payments: v.array(
        v.object({
          paymentMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
          amount: v.number(),
          cashReceived: v.optional(v.number()),
          changeGiven: v.optional(v.number()),
          cardPaymentType: v.optional(v.string()),
          cardReferenceNumber: v.optional(v.string()),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Get order
    const order = await ctx.db.get(args.orderId);
    if (!order) return null;

    // Get store
    const store = await ctx.db.get(order.storeId);
    if (!store) return null;

    // Get table name
    let tableName: string | undefined;
    if (order.tableId) {
      const table = await ctx.db.get(order.tableId);
      tableName = table?.name;
    }

    // Get cashier name
    const cashier = await ctx.db.get(order.createdBy);
    const cashierName = cashier?.name ?? "Unknown";

    // Get items
    const orderItems = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    const items = orderItems
      .filter((i) => !i.isVoided)
      .map((i) => ({
        name: i.productName,
        quantity: i.quantity,
        unitPrice: i.productPrice,
        lineTotal: i.productPrice * i.quantity,
      }));

    // Fetch payment rows from orderPayments table
    const paymentRows = await ctx.db
      .query("orderPayments")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    // Build payments array — use orderPayments if available, else legacy fields
    const payments =
      paymentRows.length > 0
        ? paymentRows.map((p) => ({
            paymentMethod: p.paymentMethod,
            amount: p.amount,
            cashReceived: p.cashReceived,
            changeGiven: p.changeGiven,
            cardPaymentType: p.cardPaymentType,
            cardReferenceNumber: p.cardReferenceNumber,
          }))
        : order.paymentMethod
          ? [
              {
                paymentMethod: order.paymentMethod,
                amount: order.netSales,
                cashReceived: order.cashReceived,
                changeGiven: order.changeGiven,
                cardPaymentType: order.cardPaymentType,
                cardReferenceNumber: order.cardReferenceNumber,
              },
            ]
          : [];

    return {
      storeName: store.name,
      storeAddress1: store.address1,
      storeAddress2: store.address2,
      tin: store.tin,
      min: store.min,
      vatRate: store.vatRate,

      orderNumber: order.orderNumber ?? "",
      orderType: order.orderType,
      tableName,
      pax: order.pax,
      customerName: order.customerName,
      orderCategory: order.orderCategory,
      tableMarker: order.tableMarker,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      cashierName,

      items,

      grossSales: order.grossSales,
      vatableSales: order.vatableSales,
      vatAmount: order.vatAmount,
      vatExemptSales: order.vatExemptSales,
      nonVatSales: order.nonVatSales,
      discountAmount: order.discountAmount,
      netSales: order.netSales,

      paymentMethod: order.paymentMethod,
      cashReceived: order.cashReceived,
      changeGiven: order.changeGiven,
      cardPaymentType: order.cardPaymentType,
      cardReferenceNumber: order.cardReferenceNumber,

      payments,
    };
  },
});

// Cancel an unpaid order
export const cancelOrder = mutation({
  args: {
    orderId: v.id("orders"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Get order
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Can only cancel open orders");
    }

    // Check if any items have been sent to kitchen
    const allItems = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    const hasSentItems = allItems.some((i) => i.isSentToKitchen);
    if (hasSentItems) {
      throw new Error(
        "Cannot cancel order with items already sent to kitchen. Void individual items instead.",
      );
    }

    // Get items and delete them
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    // Release table if dine-in and this was the last open order
    // Note: We check before deleting the order, so we pass a dummy ID check
    if (order.tableId) {
      // Check for other open orders on this table (excluding the one being cancelled)
      const otherOpenOrders = await ctx.db
        .query("orders")
        .withIndex("by_tableId_status", (q) => q.eq("tableId", order.tableId).eq("status", "open"))
        .collect();

      const remainingOpenOrders = otherOpenOrders.filter((o) => o._id !== args.orderId);

      if (remainingOpenOrders.length === 0) {
        await ctx.db.patch(order.tableId, {
          status: "available",
          currentOrderId: undefined,
        });
      }
    }

    // Delete the order
    await ctx.db.delete(args.orderId);

    return null;
  },
});

// Log receipt reprint for audit trail
export const logReceiptReprint = mutation({
  args: {
    orderId: v.id("orders"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");

    await ctx.db.insert("auditLogs", {
      storeId: order.storeId,
      action: "receipt_reprint",
      entityType: "orders",
      entityId: args.orderId,
      details: JSON.stringify({
        orderNumber: order.orderNumber,
        reprintedBy: user.name ?? "Unknown",
      }),
      userId: user._id,
      createdAt: Date.now(),
    });

    return null;
  },
});

// Quick calculation for change (before completing payment)
export const calculateChangeAmount = query({
  args: {
    orderId: v.id("orders"),
    cashReceived: v.number(),
  },
  returns: v.object({
    netSales: v.number(),
    cashReceived: v.number(),
    changeAmount: v.number(),
    isValid: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");

    const changeAmount = calculateChange(order.netSales, args.cashReceived);

    return {
      netSales: order.netSales,
      cashReceived: args.cashReceived,
      changeAmount,
      isValid: changeAmount >= 0,
    };
  },
});
