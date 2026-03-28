"use node";

import bcrypt from "bcryptjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";

// Type definitions for action return types (to avoid circular reference errors)
type VoidItemResult =
  | { success: true; voidId: Id<"orderVoids"> }
  | { success: false; error: string };

type VoidOrderResult =
  | { success: true; voidId: Id<"orderVoids"> }
  | { success: false; error: string };

type VoidPaidOrderResult =
  | {
      success: true;
      voidId: Id<"orderVoids">;
      replacementOrderId?: Id<"orders">;
      refundAmount: number;
    }
  | { success: false; error: string };

type OrderVoidRecord = {
  _id: Id<"orderVoids">;
  voidType: "full_order" | "item" | "refund";
  orderItemId?: Id<"orderItems">;
  reason: string;
  amount: number;
  approvedByName: string;
  requestedByName: string;
  createdAt: number;
};

// Action: Void order item with PIN verification
export const voidOrderItem = action({
  args: {
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
    }),
  ),
  handler: async (ctx, args): Promise<VoidItemResult> => {
    // Get authenticated user ID using Convex Auth
    const requesterId = await ctx.runQuery(
      internal.helpers.voidsHelpers.getAuthenticatedUserId,
      {},
    );

    if (!requesterId) {
      return { success: false as const, error: "Authentication required" };
    }

    // Get manager with PIN
    const manager = await ctx.runQuery(internal.helpers.voidsHelpers.getManagerWithPin, {
      managerId: args.managerId,
    });

    if (!manager || !manager.isActive) {
      return {
        success: false as const,
        error: "Manager not found or inactive",
      };
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
      const voidId = await ctx.runMutation(internal.helpers.voidsHelpers.voidOrderItemInternal, {
        orderItemId: args.orderItemId,
        reason: args.reason,
        requestedBy: requesterId,
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
    }),
  ),
  handler: async (ctx, args): Promise<VoidOrderResult> => {
    // Get authenticated user ID using Convex Auth
    const requesterId = await ctx.runQuery(
      internal.helpers.voidsHelpers.getAuthenticatedUserId,
      {},
    );

    if (!requesterId) {
      return { success: false as const, error: "Authentication required" };
    }

    // Get manager with PIN
    const manager = await ctx.runQuery(internal.helpers.voidsHelpers.getManagerWithPin, {
      managerId: args.managerId,
    });

    if (!manager || !manager.isActive) {
      return {
        success: false as const,
        error: "Manager not found or inactive",
      };
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
      const voidId = await ctx.runMutation(internal.helpers.voidsHelpers.voidOrderInternal, {
        orderId: args.orderId,
        reason: args.reason,
        requestedBy: requesterId,
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

// Action: Bulk void multiple orders with PIN verification
export const bulkVoidOrders = action({
  args: {
    orderIds: v.array(v.id("orders")),
    managerId: v.id("users"),
    managerPin: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      voidedCount: v.number(),
      skippedCount: v.number(),
    }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    if (args.orderIds.length === 0) {
      return { success: false as const, error: "No orders selected" };
    }
    if (args.orderIds.length > 50) {
      return { success: false as const, error: "Maximum 50 orders per batch" };
    }

    // 1. Authenticate requester
    const requesterId = await ctx.runQuery(
      internal.helpers.voidsHelpers.getAuthenticatedUserId,
      {},
    );
    if (!requesterId) {
      return { success: false as const, error: "Authentication required" };
    }

    // 2. Verify manager PIN (once for entire batch)
    const manager = await ctx.runQuery(internal.helpers.voidsHelpers.getManagerWithPin, {
      managerId: args.managerId,
    });
    if (!manager || !manager.pin || !manager.isActive) {
      return { success: false as const, error: "Manager not found, inactive, or PIN not set" };
    }
    const pinValid = await bcrypt.compare(args.managerPin, manager.pin);
    if (!pinValid) {
      return { success: false as const, error: "Invalid manager PIN" };
    }

    // 3. Process each order sequentially, skip failures
    let voidedCount = 0;
    let skippedCount = 0;

    for (const orderId of args.orderIds) {
      try {
        await ctx.runMutation(internal.helpers.voidsHelpers.voidOrderInternal, {
          orderId,
          reason: "Bulk void - abandoned order",
          requestedBy: requesterId,
          approvedBy: args.managerId,
        });
        voidedCount++;
      } catch {
        skippedCount++;
      }
    }

    return { success: true as const, voidedCount, skippedCount };
  },
});

// Action: Void a paid order (refund & re-ring) with PIN verification
export const voidPaidOrder = action({
  args: {
    orderId: v.id("orders"),
    refundedItemIds: v.array(v.id("orderItems")),
    reason: v.string(),
    refundMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
    managerId: v.id("users"),
    managerPin: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      voidId: v.id("orderVoids"),
      replacementOrderId: v.optional(v.id("orders")),
      refundAmount: v.number(),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<VoidPaidOrderResult> => {
    const requesterId = await ctx.runQuery(
      internal.helpers.voidsHelpers.getAuthenticatedUserId,
      {},
    );
    if (!requesterId) {
      return { success: false as const, error: "Authentication required" };
    }

    const manager = await ctx.runQuery(internal.helpers.voidsHelpers.getManagerWithPin, {
      managerId: args.managerId,
    });
    if (!manager || !manager.isActive) {
      return { success: false as const, error: "Manager not found or inactive" };
    }
    if (!manager.pin) {
      return { success: false as const, error: "Manager PIN not set" };
    }

    const pinValid = await bcrypt.compare(args.managerPin, manager.pin);
    if (!pinValid) {
      return { success: false as const, error: "Invalid manager PIN" };
    }

    if (args.refundedItemIds.length === 0) {
      return { success: false as const, error: "No items selected for refund" };
    }

    try {
      const result = await ctx.runMutation(internal.helpers.voidsHelpers.voidPaidOrderInternal, {
        orderId: args.orderId,
        refundedItemIds: args.refundedItemIds,
        reason: args.reason,
        refundMethod: args.refundMethod,
        requestedBy: requesterId,
        approvedBy: args.managerId,
      });

      return {
        success: true as const,
        voidId: result.voidId,
        replacementOrderId: result.replacementOrderId,
        refundAmount: result.refundAmount,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to process refund",
      };
    }
  },
});

// Action to get voids for an order (public facing)
export const getOrderVoids = action({
  args: {
    orderId: v.id("orders"),
  },
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
  handler: async (ctx, args): Promise<OrderVoidRecord[]> => {
    // Get authenticated user ID using Convex Auth
    const userId = await ctx.runQuery(internal.helpers.voidsHelpers.getAuthenticatedUserId, {});

    if (!userId) {
      throw new Error("Authentication required");
    }

    return await ctx.runQuery(internal.helpers.voidsHelpers.getOrderVoidsInternal, {
      orderId: args.orderId,
    });
  },
});
