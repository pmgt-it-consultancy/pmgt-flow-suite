import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import { calculateChange } from "./lib/taxCalculations";

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

    // Get order
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Order is not open for payment");
    }

    // Validate cash received
    if (args.cashReceived < order.netSales) {
      throw new Error("Insufficient cash received");
    }

    // Calculate change
    const changeGiven = calculateChange(order.netSales, args.cashReceived);

    // Update order
    const now = Date.now();
    await ctx.db.patch(args.orderId, {
      status: "paid",
      paymentMethod: "cash",
      cashReceived: args.cashReceived,
      changeGiven,
      paidAt: now,
      paidBy: user._id,
    });

    // Release table if dine-in
    if (order.tableId) {
      await ctx.db.patch(order.tableId, {
        status: "available",
        currentOrderId: undefined,
      });
    }

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

    // Get order
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Order is not open for payment");
    }

    // Update order (no change for card payments)
    const now = Date.now();
    await ctx.db.patch(args.orderId, {
      status: "paid",
      paymentMethod: "card_ewallet",
      cashReceived: undefined,
      changeGiven: undefined,
      paidAt: now,
      paidBy: user._id,
    });

    // Release table if dine-in
    if (order.tableId) {
      await ctx.db.patch(order.tableId, {
        status: "available",
        currentOrderId: undefined,
      });
    }

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
      customerName: v.optional(v.string()),
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

      // Payment
      paymentMethod: v.optional(v.union(v.literal("cash"), v.literal("card_ewallet"))),
      cashReceived: v.optional(v.number()),
      changeGiven: v.optional(v.number()),
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

    return {
      storeName: store.name,
      storeAddress1: store.address1,
      storeAddress2: store.address2,
      tin: store.tin,
      min: store.min,
      vatRate: store.vatRate,

      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableName,
      customerName: order.customerName,
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

    // Release table if dine-in
    if (order.tableId) {
      await ctx.db.patch(order.tableId, {
        status: "available",
        currentOrderId: undefined,
      });
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
