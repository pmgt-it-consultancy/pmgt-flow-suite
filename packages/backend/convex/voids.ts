"use node";

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import bcrypt from "bcryptjs";

// Type definitions for action return types (to avoid circular reference errors)
type VoidItemResult =
  | { success: true; voidId: Id<"orderVoids"> }
  | { success: false; error: string };

type VoidOrderResult =
  | { success: true; voidId: Id<"orderVoids"> }
  | { success: false; error: string };

type OrderVoidRecord = {
  _id: Id<"orderVoids">;
  voidType: "full_order" | "item";
  orderItemId?: Id<"orderItems">;
  reason: string;
  amount: number;
  approvedByName: string;
  requestedByName: string;
  createdAt: number;
};

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
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.managerId);
    if (!user) return null;

    return {
      _id: user._id,
      name: user.name,
      pin: user.pin,
      isActive: user.isActive,
    };
  },
});

// Internal query to validate session
export const validateSession = internalQuery({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      isValid: v.boolean(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      return null;
    }

    return {
      userId: session.userId,
      isValid: true,
    };
  },
});

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

    // Update order status
    await ctx.db.patch(args.orderId, {
      status: "voided",
    });

    // Release table if dine-in
    if (order.tableId) {
      await ctx.db.patch(order.tableId, {
        status: "available",
        currentOrderId: undefined,
      });
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

// Helper to recalculate order totals (copied from orders.ts for independence)
async function recalculateOrderTotals(
  ctx: { db: any },
  orderId: Id<"orders">
): Promise<void> {
  // Import dynamically to avoid circular deps
  const { calculateItemTotals, aggregateOrderTotals } = await import(
    "./lib/taxCalculations"
  );

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
      return calculateItemTotals(item.productPrice, item.quantity, isVatable, 0);
    })
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

// Action: Void order item with PIN verification
export const voidOrderItem = action({
  args: {
    token: v.string(),
    orderItemId: v.id("orderItems"),
    reason: v.string(),
    managerId: v.id("users"),
    managerPin: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      voidId: v.id("orderVoids"),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args): Promise<VoidItemResult> => {
    // Validate session
    const session = await ctx.runQuery(internal.voids.validateSession, {
      token: args.token,
    });

    if (!session) {
      return { success: false as const, error: "Invalid session" };
    }

    // Get manager with PIN
    const manager = await ctx.runQuery(internal.voids.getManagerWithPin, {
      managerId: args.managerId,
    });

    if (!manager || !manager.isActive) {
      return { success: false as const, error: "Manager not found or inactive" };
    }

    if (!manager.pin) {
      return { success: false as const, error: "Manager PIN not set" };
    }

    // Verify PIN
    const pinValid = await bcrypt.compare(args.managerPin, manager.pin);
    if (!pinValid) {
      return { success: false as const, error: "Invalid manager PIN" };
    }

    // Perform void
    try {
      const voidId = await ctx.runMutation(internal.voids.voidOrderItemInternal, {
        orderItemId: args.orderItemId,
        reason: args.reason,
        requestedBy: session.userId,
        approvedBy: args.managerId,
      });

      return { success: true as const, voidId };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to void item",
      };
    }
  },
});

// Action: Void entire order with PIN verification
export const voidOrder = action({
  args: {
    token: v.string(),
    orderId: v.id("orders"),
    reason: v.string(),
    managerId: v.id("users"),
    managerPin: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      voidId: v.id("orderVoids"),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args): Promise<VoidOrderResult> => {
    // Validate session
    const session = await ctx.runQuery(internal.voids.validateSession, {
      token: args.token,
    });

    if (!session) {
      return { success: false as const, error: "Invalid session" };
    }

    // Get manager with PIN
    const manager = await ctx.runQuery(internal.voids.getManagerWithPin, {
      managerId: args.managerId,
    });

    if (!manager || !manager.isActive) {
      return { success: false as const, error: "Manager not found or inactive" };
    }

    if (!manager.pin) {
      return { success: false as const, error: "Manager PIN not set" };
    }

    // Verify PIN
    const pinValid = await bcrypt.compare(args.managerPin, manager.pin);
    if (!pinValid) {
      return { success: false as const, error: "Invalid manager PIN" };
    }

    // Perform void
    try {
      const voidId = await ctx.runMutation(internal.voids.voidOrderInternal, {
        orderId: args.orderId,
        reason: args.reason,
        requestedBy: session.userId,
        approvedBy: args.managerId,
      });

      return { success: true as const, voidId };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to void order",
      };
    }
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
    })
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
      })
    );

    return results;
  },
});

// Action to get voids for an order (public facing)
export const getOrderVoids = action({
  args: {
    token: v.string(),
    orderId: v.id("orders"),
  },
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
    })
  ),
  handler: async (ctx, args): Promise<OrderVoidRecord[]> => {
    // Validate session
    const session = await ctx.runQuery(internal.voids.validateSession, {
      token: args.token,
    });

    if (!session) {
      throw new Error("Invalid session");
    }

    return await ctx.runQuery(internal.voids.getOrderVoidsInternal, {
      orderId: args.orderId,
    });
  },
});
