import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { getPHTDayBoundaries } from "../lib/dateUtils";
import { aggregateOrderTotals, calculateItemTotals } from "../lib/taxCalculations";
import { recomputeOrderItemCount } from "../orders";

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
    await recomputeOrderItemCount(ctx, item.orderId);

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
      voidType: v.union(v.literal("full_order"), v.literal("item"), v.literal("refund")),
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

// Internal mutation to void a paid order and create replacement with remaining items
export const voidPaidOrderInternal = internalMutation({
  args: {
    orderId: v.id("orders"),
    refundedItemIds: v.array(v.id("orderItems")),
    reason: v.string(),
    refundMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
    requestedBy: v.id("users"),
    approvedBy: v.id("users"),
  },
  returns: v.object({
    voidId: v.id("orderVoids"),
    replacementOrderId: v.optional(v.id("orders")),
    refundAmount: v.number(),
  }),
  handler: async (ctx, args) => {
    // 1. Get and validate order
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "paid") throw new Error("Can only refund paid orders");

    // 2. Get all items for this order
    const allItems = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q: any) => q.eq("orderId", args.orderId))
      .collect();

    const activeItems = allItems.filter((i: any) => !i.isVoided);

    // Validate refunded item IDs
    const refundedIdSet = new Set(args.refundedItemIds.map((id) => id.toString()));
    for (const itemId of args.refundedItemIds) {
      const item = activeItems.find((i: any) => i._id.toString() === itemId.toString());
      if (!item) throw new Error(`Item ${itemId} not found or already voided`);
    }

    const remainingItems = activeItems.filter((i: any) => !refundedIdSet.has(i._id.toString()));

    const now = Date.now();
    let replacementOrderId: Id<"orders"> | undefined;
    let refundAmount: number;

    if (remainingItems.length === 0) {
      // All items refunded — full refund, no replacement order
      refundAmount = order.netSales;
    } else {
      // Partial refund — create replacement order
      const store = await ctx.db.get(order.storeId);
      const vatRate = store?.vatRate ?? 0.12;

      // Generate new order number
      const prefix = order.orderType === "dine_in" ? "D" : "T";
      const { startOfDay, endOfDay } = getPHTDayBoundaries();
      const todaysOrders = await ctx.db
        .query("orders")
        .withIndex("by_store_createdAt", (q: any) =>
          q.eq("storeId", order.storeId).gte("createdAt", startOfDay),
        )
        .filter((q: any) =>
          q.and(q.lt(q.field("createdAt"), endOfDay), q.eq(q.field("orderType"), order.orderType)),
        )
        .collect();

      let maxNumber = 0;
      for (const o of todaysOrders) {
        const match = o.orderNumber?.match(/\d+$/);
        if (match) {
          maxNumber = Math.max(maxNumber, Number.parseInt(match[0], 10));
        }
      }
      const orderNumber = `${prefix}-${(maxNumber + 1).toString().padStart(3, "0")}`;

      // Create new order (totals will be recalculated below)
      replacementOrderId = await ctx.db.insert("orders", {
        storeId: order.storeId,
        orderNumber,
        orderType: order.orderType,
        orderChannel: order.orderChannel,
        tableId: order.tableId,
        customerName: order.customerName,
        orderCategory: order.orderCategory,
        tableMarker: order.tableMarker,
        pax: order.pax,
        status: "paid",
        takeoutStatus: order.takeoutStatus,
        grossSales: 0,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 0,
        createdBy: args.approvedBy,
        createdAt: now,
        paidAt: now,
        paidBy: args.approvedBy,
        refundedFromOrderId: args.orderId,
      });

      // Copy remaining items and their modifiers
      const oldItemToNewItem = new Map<string, Id<"orderItems">>();

      for (const item of remainingItems) {
        const newItemId = await ctx.db.insert("orderItems", {
          orderId: replacementOrderId,
          productId: item.productId,
          productName: item.productName,
          productPrice: item.productPrice,
          quantity: item.quantity,
          notes: item.notes,
          serviceType: item.serviceType,
          isVoided: false,
          isSentToKitchen: item.isSentToKitchen,
        });
        oldItemToNewItem.set(item._id.toString(), newItemId);

        // Copy modifiers
        const modifiers = await ctx.db
          .query("orderItemModifiers")
          .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", item._id))
          .collect();

        for (const mod of modifiers) {
          await ctx.db.insert("orderItemModifiers", {
            orderItemId: newItemId,
            modifierGroupName: mod.modifierGroupName,
            modifierOptionName: mod.modifierOptionName,
            priceAdjustment: mod.priceAdjustment,
          });
        }
      }

      // Copy applicable discounts (only for items that were kept)
      const originalDiscounts = await ctx.db
        .query("orderDiscounts")
        .withIndex("by_order", (q: any) => q.eq("orderId", args.orderId))
        .collect();

      for (const discount of originalDiscounts) {
        if (discount.orderItemId) {
          // Item-level discount — only copy if item was kept
          const newItemId = oldItemToNewItem.get(discount.orderItemId.toString());
          if (newItemId) {
            await ctx.db.insert("orderDiscounts", {
              orderId: replacementOrderId,
              orderItemId: newItemId,
              discountType: discount.discountType,
              customerName: discount.customerName,
              customerId: discount.customerId,
              quantityApplied: discount.quantityApplied,
              discountAmount: discount.discountAmount,
              vatExemptAmount: discount.vatExemptAmount,
              approvedBy: discount.approvedBy,
              createdAt: now,
            });
          }
        } else {
          // Order-level discount — copy as-is
          await ctx.db.insert("orderDiscounts", {
            orderId: replacementOrderId,
            orderItemId: undefined,
            discountType: discount.discountType,
            customerName: discount.customerName,
            customerId: discount.customerId,
            quantityApplied: discount.quantityApplied,
            discountAmount: discount.discountAmount,
            vatExemptAmount: discount.vatExemptAmount,
            approvedBy: discount.approvedBy,
            createdAt: now,
          });
        }
      }

      // Recalculate new order totals
      const newItems = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", replacementOrderId))
        .collect();

      const newDiscounts = await ctx.db
        .query("orderDiscounts")
        .withIndex("by_order", (q: any) => q.eq("orderId", replacementOrderId))
        .collect();

      const itemDiscountQty = new Map<string, number>();
      let orderLevelDiscountAmount = 0;

      for (const discount of newDiscounts) {
        if (discount.orderItemId) {
          const current = itemDiscountQty.get(discount.orderItemId.toString()) ?? 0;
          itemDiscountQty.set(discount.orderItemId.toString(), current + discount.quantityApplied);
        } else {
          orderLevelDiscountAmount += discount.discountAmount;
        }
      }

      const itemCalculations = await Promise.all(
        newItems.map(async (item: any) => {
          const product = await ctx.db.get(item.productId as Id<"products">);
          const isVatable = product?.isVatable ?? true;

          const modifiers = await ctx.db
            .query("orderItemModifiers")
            .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", item._id))
            .collect();
          const modifierTotal = modifiers.reduce(
            (sum: number, m: any) => sum + m.priceAdjustment,
            0,
          );
          const effectivePrice = item.productPrice + modifierTotal;
          const scPwdQuantity = itemDiscountQty.get(item._id.toString()) ?? 0;

          return calculateItemTotals(
            effectivePrice,
            item.quantity,
            isVatable,
            scPwdQuantity,
            vatRate,
          );
        }),
      );

      const totals = aggregateOrderTotals(itemCalculations);
      const netSales = totals.netSales - orderLevelDiscountAmount;
      const totalDiscountAmount = totals.discountAmount + orderLevelDiscountAmount;

      await ctx.db.patch(replacementOrderId, {
        grossSales: totals.grossSales,
        vatableSales: totals.vatableSales,
        vatAmount: totals.vatAmount,
        vatExemptSales: totals.vatExemptSales,
        nonVatSales: totals.nonVatSales,
        discountAmount: totalDiscountAmount,
        netSales: netSales,
      });

      // Update denormalized item count on replacement order
      await recomputeOrderItemCount(ctx, replacementOrderId);

      // Create payment record for the new order
      await ctx.db.insert("orderPayments", {
        orderId: replacementOrderId,
        storeId: order.storeId,
        paymentMethod: "cash",
        amount: netSales,
        createdAt: now,
        createdBy: args.approvedBy,
      });

      // Refund amount = original netSales - new netSales
      refundAmount = order.netSales - netSales;
    }

    // Void the original order
    await ctx.db.patch(args.orderId, {
      status: "voided",
    });

    // Create void record
    const voidId = await ctx.db.insert("orderVoids", {
      orderId: args.orderId,
      voidType: "refund",
      orderItemId: undefined,
      reason: args.reason,
      approvedBy: args.approvedBy,
      requestedBy: args.requestedBy,
      amount: refundAmount,
      createdAt: now,
      refundMethod: args.refundMethod,
      replacementOrderId,
    });

    // Audit log
    const refundedItems = activeItems.filter((i: any) => refundedIdSet.has(i._id.toString()));
    await ctx.db.insert("auditLogs", {
      storeId: order.storeId,
      action: "refund_order",
      entityType: "order",
      entityId: args.orderId,
      details: JSON.stringify({
        orderNumber: order.orderNumber,
        refundedItems: refundedItems.map((i: any) => ({
          name: i.productName,
          quantity: i.quantity,
          price: i.productPrice,
        })),
        refundAmount,
        refundMethod: args.refundMethod,
        replacementOrderId,
        reason: args.reason,
      }),
      userId: args.approvedBy,
      createdAt: now,
    });

    return { voidId, replacementOrderId, refundAmount };
  },
});
