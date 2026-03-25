import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requirePermission } from "./lib/permissions";
import {
  aggregateOrderTotals,
  calculateItemTotals,
  calculateScPwdDiscount,
  type ItemCalculation,
} from "./lib/taxCalculations";

// Discount types
const discountTypeValidator = v.union(
  v.literal("senior_citizen"),
  v.literal("pwd"),
  v.literal("promo"),
  v.literal("manual"),
);

function hasExistingScPwdDiscount(
  discounts: Array<Pick<Doc<"orderDiscounts">, "discountType">>,
): boolean {
  return discounts.some(
    (discount) => discount.discountType === "senior_citizen" || discount.discountType === "pwd",
  );
}

// Apply SC/PWD discount to an order item
export const applyScPwdDiscount = mutation({
  args: {
    orderId: v.id("orders"),
    orderItemId: v.id("orderItems"),
    discountType: v.union(v.literal("senior_citizen"), v.literal("pwd")),
    customerName: v.string(),
    customerId: v.string(), // SC/PWD ID number
    quantityApplied: v.number(),
    managerId: v.id("users"), // Manager who approved
  },
  returns: v.id("orderDiscounts"),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Verify manager has approval permission
    await requirePermission(ctx, args.managerId, "discounts.approve");

    // Get order and validate status
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot apply discount to closed order");
    }

    // Get order item
    const orderItem = await ctx.db.get(args.orderItemId);
    if (!orderItem) throw new Error("Order item not found");
    if (orderItem.orderId !== args.orderId) {
      throw new Error("Item does not belong to this order");
    }
    if (orderItem.isVoided) {
      throw new Error("Cannot apply discount to voided item");
    }

    // Validate quantity
    if (args.quantityApplied > orderItem.quantity) {
      throw new Error("Discount quantity exceeds item quantity");
    }

    // Check total discounted quantity on this item (multiple seniors can share)
    const existingDiscounts = await ctx.db
      .query("orderDiscounts")
      .withIndex("by_orderItem", (q) => q.eq("orderItemId", args.orderItemId))
      .collect();
    if (hasExistingScPwdDiscount(existingDiscounts)) {
      throw new Error("Item already has an SC/PWD discount");
    }
    const totalDiscountedQty = existingDiscounts.reduce((sum, d) => sum + d.quantityApplied, 0);
    if (totalDiscountedQty + args.quantityApplied > orderItem.quantity) {
      throw new Error(
        `Cannot apply discount: only ${orderItem.quantity - totalDiscountedQty} undiscounted quantity remaining`,
      );
    }

    // Get store's VAT rate
    const store = await ctx.db.get(order.storeId);
    const vatRate = store?.vatRate ?? 0.12;

    // Calculate effective price including modifiers
    const product = await ctx.db.get(orderItem.productId);
    if (!product) throw new Error("Product not found");

    // Calculate effective price including modifiers
    const modifiers = await ctx.db
      .query("orderItemModifiers")
      .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", args.orderItemId))
      .collect();
    const modifierTotal = modifiers.reduce((sum: number, m: any) => sum + m.priceAdjustment, 0);
    const effectivePrice = orderItem.productPrice + modifierTotal;

    // Calculate SC/PWD discount on full price (product + modifiers)
    const scPwd = calculateScPwdDiscount(effectivePrice, product.isVatable ? vatRate : 0);
    const discountAmount = scPwd.discountAmount * args.quantityApplied;
    const vatExemptAmount = scPwd.vatExemptAmount * args.quantityApplied;

    // Create discount record
    const discountId = await ctx.db.insert("orderDiscounts", {
      orderId: args.orderId,
      orderItemId: args.orderItemId,
      discountType: args.discountType,
      customerName: args.customerName,
      customerId: args.customerId,
      quantityApplied: args.quantityApplied,
      discountAmount,
      vatExemptAmount,
      approvedBy: args.managerId,
      createdAt: Date.now(),
    });

    // Recalculate order totals
    await recalculateOrderTotalsWithDiscounts(ctx, args.orderId);

    return discountId;
  },
});

// Apply SC/PWD discount to multiple order items at once
export const applyBulkScPwdDiscount = mutation({
  args: {
    orderId: v.id("orders"),
    items: v.array(
      v.object({
        orderItemId: v.id("orderItems"),
        quantityApplied: v.number(),
      }),
    ),
    discountType: v.union(v.literal("senior_citizen"), v.literal("pwd")),
    customerName: v.string(),
    customerId: v.string(),
    managerId: v.id("users"),
  },
  returns: v.array(v.id("orderDiscounts")),
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    await requirePermission(ctx, args.managerId, "discounts.approve");

    if (args.items.length === 0) {
      throw new Error("No items selected for discount");
    }

    const uniqueIds = new Set(args.items.map((i) => i.orderItemId));
    if (uniqueIds.size !== args.items.length) {
      throw new Error("Duplicate items in discount request");
    }

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot apply discount to closed order");
    }

    // Get store's VAT rate
    const store = await ctx.db.get(order.storeId);
    const vatRate = store?.vatRate ?? 0.12;

    const discountIds: Id<"orderDiscounts">[] = [];

    for (const item of args.items) {
      const orderItem = await ctx.db.get(item.orderItemId);
      if (!orderItem) throw new Error(`Order item not found: ${item.orderItemId}`);
      if (orderItem.orderId !== args.orderId) {
        throw new Error("Item does not belong to this order");
      }
      if (orderItem.isVoided) {
        throw new Error(`Cannot apply discount to voided item: ${orderItem.productName}`);
      }
      if (item.quantityApplied > orderItem.quantity) {
        throw new Error(`Discount quantity exceeds item quantity for ${orderItem.productName}`);
      }

      const product = await ctx.db.get(orderItem.productId);
      if (!product) throw new Error(`Product not found for ${orderItem.productName}`);

      // Check existing discounts on this item
      const existingDiscounts = await ctx.db
        .query("orderDiscounts")
        .withIndex("by_orderItem", (q) => q.eq("orderItemId", item.orderItemId))
        .collect();
      if (hasExistingScPwdDiscount(existingDiscounts)) {
        throw new Error(
          `Cannot apply discount to ${orderItem.productName}: item already has an SC/PWD discount`,
        );
      }
      const totalDiscountedQty = existingDiscounts.reduce((sum, d) => sum + d.quantityApplied, 0);
      if (totalDiscountedQty + item.quantityApplied > orderItem.quantity) {
        throw new Error(
          `Cannot apply discount to ${orderItem.productName}: only ${orderItem.quantity - totalDiscountedQty} undiscounted quantity remaining`,
        );
      }

      // Calculate effective price including modifiers
      const modifiers = await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", item.orderItemId))
        .collect();
      const modifierTotal = modifiers.reduce((sum: number, m: any) => sum + m.priceAdjustment, 0);
      const effectivePrice = orderItem.productPrice + modifierTotal;

      const scPwd = calculateScPwdDiscount(effectivePrice, product.isVatable ? vatRate : 0);
      const discountAmount = scPwd.discountAmount * item.quantityApplied;
      const vatExemptAmount = scPwd.vatExemptAmount * item.quantityApplied;

      const discountId = await ctx.db.insert("orderDiscounts", {
        orderId: args.orderId,
        orderItemId: item.orderItemId,
        discountType: args.discountType,
        customerName: args.customerName,
        customerId: args.customerId,
        quantityApplied: item.quantityApplied,
        discountAmount,
        vatExemptAmount,
        approvedBy: args.managerId,
        createdAt: Date.now(),
      });

      discountIds.push(discountId);
    }

    // Recalculate order totals once (not per item)
    await recalculateOrderTotalsWithDiscounts(ctx, args.orderId);

    return discountIds;
  },
});

// Apply promo or manual discount to an order
export const applyOrderDiscount = mutation({
  args: {
    orderId: v.id("orders"),
    discountType: v.union(v.literal("promo"), v.literal("manual")),
    customerName: v.string(),
    discountAmount: v.number(),
    managerId: v.id("users"), // Manager who approved
  },
  returns: v.id("orderDiscounts"),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Verify manager has approval permission
    await requirePermission(ctx, args.managerId, "discounts.approve");

    // Get order and validate status
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot apply discount to closed order");
    }

    // Validate discount doesn't exceed order total
    if (args.discountAmount > order.grossSales) {
      throw new Error("Discount exceeds order total");
    }

    // Create discount record (order-level, no orderItemId)
    const discountId = await ctx.db.insert("orderDiscounts", {
      orderId: args.orderId,
      orderItemId: undefined,
      discountType: args.discountType,
      customerName: args.customerName,
      customerId: "", // Not applicable for promo/manual
      quantityApplied: 1,
      discountAmount: args.discountAmount,
      vatExemptAmount: 0, // Promo/manual don't exempt VAT
      approvedBy: args.managerId,
      createdAt: Date.now(),
    });

    // Recalculate order totals
    await recalculateOrderTotalsWithDiscounts(ctx, args.orderId);

    return discountId;
  },
});

// Remove a discount
export const removeDiscount = mutation({
  args: {
    discountId: v.id("orderDiscounts"),
    managerId: v.id("users"), // Manager who approved
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Verify manager has approval permission
    await requirePermission(ctx, args.managerId, "discounts.approve");

    // Get discount
    const discount = await ctx.db.get(args.discountId);
    if (!discount) throw new Error("Discount not found");

    // Validate order is still open
    const order = await ctx.db.get(discount.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot remove discount from closed order");
    }

    // Delete discount
    await ctx.db.delete(args.discountId);

    // Recalculate order totals
    await recalculateOrderTotalsWithDiscounts(ctx, discount.orderId);

    return null;
  },
});

// Get discounts for an order
export const getOrderDiscounts = query({
  args: {
    orderId: v.id("orders"),
  },
  returns: v.array(
    v.object({
      _id: v.id("orderDiscounts"),
      orderItemId: v.optional(v.id("orderItems")),
      itemName: v.optional(v.string()),
      discountType: discountTypeValidator,
      customerName: v.string(),
      customerId: v.string(),
      quantityApplied: v.number(),
      discountAmount: v.number(),
      vatExemptAmount: v.number(),
      approvedByName: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get discounts
    const discounts = await ctx.db
      .query("orderDiscounts")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    // Get additional info
    const results = await Promise.all(
      discounts.map(async (discount) => {
        let itemName: string | undefined;
        if (discount.orderItemId) {
          const item = await ctx.db.get(discount.orderItemId);
          itemName = item?.productName;
        }

        const approver = await ctx.db.get(discount.approvedBy);
        const approvedByName = approver?.name ?? "Unknown";

        return {
          _id: discount._id,
          orderItemId: discount.orderItemId,
          itemName,
          discountType: discount.discountType,
          customerName: discount.customerName,
          customerId: discount.customerId,
          quantityApplied: discount.quantityApplied,
          discountAmount: discount.discountAmount,
          vatExemptAmount: discount.vatExemptAmount,
          approvedByName,
          createdAt: discount.createdAt,
        };
      }),
    );

    return results;
  },
});

// Helper: Recalculate order totals including all discounts
async function recalculateOrderTotalsWithDiscounts(
  ctx: { db: any },
  orderId: Id<"orders">,
): Promise<void> {
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

  const activeItems: Doc<"orderItems">[] = items.filter((i: Doc<"orderItems">) => !i.isVoided);

  // Get all discounts for this order
  const discounts: Doc<"orderDiscounts">[] = await ctx.db
    .query("orderDiscounts")
    .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
    .collect();

  // Sum discounted quantities per item for SC/PWD total recalculation.
  const itemDiscountQty = new Map<string, number>();
  let orderLevelDiscountAmount = 0;

  for (const discount of discounts) {
    if (discount.orderItemId) {
      const current = itemDiscountQty.get(discount.orderItemId) ?? 0;
      itemDiscountQty.set(discount.orderItemId, current + discount.quantityApplied);
    } else {
      orderLevelDiscountAmount += discount.discountAmount;
    }
  }

  // Calculate each item's totals
  const itemCalculations: ItemCalculation[] = await Promise.all(
    activeItems.map(async (item: Doc<"orderItems">) => {
      const product = await ctx.db.get(item.productId);
      const isVatable = product?.isVatable ?? true;

      // Sum modifier price adjustments
      const modifiers = await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", item._id))
        .collect();
      const modifierTotal = modifiers.reduce((sum: number, m: any) => sum + m.priceAdjustment, 0);
      const effectivePrice = item.productPrice + modifierTotal;

      // Get total SC/PWD discounted quantity for this item
      const scPwdQuantity = itemDiscountQty.get(item._id) ?? 0;

      return calculateItemTotals(effectivePrice, item.quantity, isVatable, scPwdQuantity, vatRate);
    }),
  );

  // Aggregate totals
  const totals = aggregateOrderTotals(itemCalculations);

  // Apply order-level discounts
  const netSalesAfterOrderDiscount = totals.netSales - orderLevelDiscountAmount;
  const totalDiscountAmount = totals.discountAmount + orderLevelDiscountAmount;

  // Update order
  await ctx.db.patch(orderId, {
    grossSales: totals.grossSales,
    vatableSales: totals.vatableSales,
    vatAmount: totals.vatAmount,
    vatExemptSales: totals.vatExemptSales,
    nonVatSales: totals.nonVatSales,
    discountAmount: totalDiscountAmount,
    netSales: netSalesAfterOrderDiscount,
  });
}

// Get SC/PWD discount summary for BIR reporting
export const getScPwdSummary = query({
  args: {
    storeId: v.id("stores"),
    startDate: v.number(),
    endDate: v.number(),
  },
  returns: v.object({
    seniorCitizenCount: v.number(),
    seniorCitizenAmount: v.number(),
    pwdCount: v.number(),
    pwdAmount: v.number(),
    totalCount: v.number(),
    totalAmount: v.number(),
  }),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get orders for the store in date range
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .gte("createdAt", args.startDate)
          .lte("createdAt", args.endDate),
      )
      .collect();

    const _orderIds = new Set(orders.map((o) => o._id));

    // Get all SC/PWD discounts
    let scCount = 0;
    let scAmount = 0;
    let pwdCount = 0;
    let pwdAmount = 0;

    // Iterate through orders and get discounts
    for (const order of orders) {
      const discounts = await ctx.db
        .query("orderDiscounts")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .collect();

      for (const discount of discounts) {
        if (discount.discountType === "senior_citizen") {
          scCount += discount.quantityApplied;
          scAmount += discount.discountAmount;
        } else if (discount.discountType === "pwd") {
          pwdCount += discount.quantityApplied;
          pwdAmount += discount.discountAmount;
        }
      }
    }

    return {
      seniorCitizenCount: scCount,
      seniorCitizenAmount: scAmount,
      pwdCount: pwdCount,
      pwdAmount: pwdAmount,
      totalCount: scCount + pwdCount,
      totalAmount: scAmount + pwdAmount,
    };
  },
});
