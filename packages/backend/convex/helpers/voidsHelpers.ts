import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Internal query to get authenticated user ID
 * Used by actions that need to verify the current user
 */
export const getAuthenticatedUserId = internalQuery({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user || user.isActive === false) return null;

    return userId;
  },
});

// Internal query to get manager by ID with PIN
export const getManagerWithPin = internalQuery({
  args: { managerId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      pin: v.optional(v.string()),
      isActive: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.managerId);
    if (!user) return null;

    return {
      _id: user._id,
      name: user.name ?? "Unknown",
      pin: user.pin,
      isActive: user.isActive ?? false,
    };
  },
});

// Helper to recalculate order totals
async function recalculateOrderTotals(ctx: { db: any }, orderId: Id<"orders">): Promise<void> {
  // Import dynamically to avoid circular deps
  const { calculateItemTotals, aggregateOrderTotals } = await import("../lib/taxCalculations");

  // Get order to find store's VAT rate
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("Order not found");

  const store = await ctx.db.get(order.storeId);
  const vatRate = store?.vatRate ?? 0.12; // Default to 12% for backward compatibility

  // Get all active (non-voided) items
  const items = await ctx.db
    .query("orderItems")
    .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
    .collect();

  const activeItems = items.filter((i: any) => !i.isVoided);

  // Calculate each item's totals
  const itemCalculations = await Promise.all(
    activeItems.map(async (item: any) => {
      const product = await ctx.db.get(item.productId);
      const isVatable = product?.isVatable ?? true;
      return calculateItemTotals(item.productPrice, item.quantity, isVatable, 0, vatRate);
    }),
  );

  // Aggregate totals
  const totals = aggregateOrderTotals(itemCalculations);

  // Update order
  await ctx.db.patch(orderId, {
    grossSales: totals.grossSales,
    vatableSales: totals.vatableSales,
    vatAmount: totals.vatAmount,
    vatExemptSales: totals.vatExemptSales,
    nonVatSales: totals.nonVatSales,
    discountAmount: totals.discountAmount,
    netSales: totals.netSales,
  });
}

// Internal mutation to void an order item
export const voidOrderItemInternal = internalMutation({
  args: {
    orderItemId: v.id("orderItems"),
    reason: v.string(),
    requestedBy: v.id("users"),
    approvedBy: v.id("users"),
  },
  returns: v.id("orderVoids"),
  handler: async (ctx, args) => {
    // Get order item
    const item = await ctx.db.get(args.orderItemId);
    if (!item) throw new Error("Order item not found");
    if (item.isVoided) throw new Error("Item is already voided");

    // Get order
    const order = await ctx.db.get(item.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot void items in a closed order");
    }

    const now = Date.now();
    const voidAmount = item.productPrice * item.quantity;

    // Mark item as voided
    await ctx.db.patch(args.orderItemId, {
      isVoided: true,
      voidedBy: args.approvedBy,
      voidedAt: now,
      voidReason: args.reason,
    });

    // Create void record
    const voidId = await ctx.db.insert("orderVoids", {
      orderId: item.orderId,
      voidType: "item",
      orderItemId: args.orderItemId,
      reason: args.reason,
      approvedBy: args.approvedBy,
      requestedBy: args.requestedBy,
      amount: voidAmount,
      createdAt: now,
    });

    // Recalculate order totals
    await recalculateOrderTotals(ctx, item.orderId);

    // Log audit
    await ctx.db.insert("auditLogs", {
      storeId: order.storeId,
      action: "void_item",
      entityType: "orderItem",
      entityId: args.orderItemId,
      details: JSON.stringify({
        orderId: item.orderId,
        orderNumber: order.orderNumber,
        productName: item.productName,
        quantity: item.quantity,
        amount: voidAmount,
        reason: args.reason,
      }),
      userId: args.approvedBy,
      createdAt: now,
    });

    return voidId;
  },
});

// Internal mutation to void entire order
export const voidOrderInternal = internalMutation({
  args: {
    orderId: v.id("orders"),
    reason: v.string(),
    requestedBy: v.id("users"),
    approvedBy: v.id("users"),
  },
  returns: v.id("orderVoids"),
  handler: async (ctx, args) => {
    // Get order
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status === "voided") {
      throw new Error("Order is already voided");
    }
    if (order.status === "paid") {
      throw new Error("Cannot void a paid order");
    }

    const now = Date.now();

    // Create void record
    const voidId = await ctx.db.insert("orderVoids", {
      orderId: args.orderId,
      voidType: "full_order",
      orderItemId: undefined,
      reason: args.reason,
      approvedBy: args.approvedBy,
      requestedBy: args.requestedBy,
      amount: order.netSales,
      createdAt: now,
    });

    // Update order status (and takeout status if applicable)
    await ctx.db.patch(args.orderId, {
      status: "voided",
      ...(order.orderType === "takeout" ? { takeoutStatus: "cancelled" } : {}),
    });

    // Release table if dine-in
    if (order.tableId) {
      const table = await ctx.db.get(order.tableId);
      // Only release table if it still belongs to this order
      if (table && table.currentOrderId === args.orderId) {
        await ctx.db.patch(order.tableId, {
          status: "available",
          currentOrderId: undefined,
        });
      }
    }

    // Log audit
    await ctx.db.insert("auditLogs", {
      storeId: order.storeId,
      action: "void_order",
      entityType: "order",
      entityId: args.orderId,
      details: JSON.stringify({
        orderNumber: order.orderNumber,
        originalAmount: order.netSales,
        reason: args.reason,
      }),
      userId: args.approvedBy,
      createdAt: now,
    });

    return voidId;
  },
});

// Internal query to get voids for an order
export const getOrderVoidsInternal = internalQuery({
  args: { orderId: v.id("orders") },
  returns: v.array(
    v.object({
      _id: v.id("orderVoids"),
      voidType: v.union(v.literal("full_order"), v.literal("item")),
      orderItemId: v.optional(v.id("orderItems")),
      reason: v.string(),
      amount: v.number(),
      approvedByName: v.string(),
      requestedByName: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const voids = await ctx.db
      .query("orderVoids")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    const results = await Promise.all(
      voids.map(async (v) => {
        const approver = await ctx.db.get(v.approvedBy);
        const requester = await ctx.db.get(v.requestedBy);

        return {
          _id: v._id,
          voidType: v.voidType,
          orderItemId: v.orderItemId,
          reason: v.reason,
          amount: v.amount,
          approvedByName: approver?.name ?? "Unknown",
          requestedByName: requester?.name ?? "Unknown",
          createdAt: v.createdAt,
        };
      }),
    );

    return results;
  },
});
