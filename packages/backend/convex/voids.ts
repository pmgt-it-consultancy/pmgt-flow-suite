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

// Action to get voids for an order (public facing)
export const getOrderVoids = action({
  args: {
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
