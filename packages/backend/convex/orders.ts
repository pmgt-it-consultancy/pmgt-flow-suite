import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { getPHTDayBoundaries } from "./lib/dateUtils";
import {
  aggregateOrderTotals,
  calculateItemTotals,
  type ItemCalculation,
} from "./lib/taxCalculations";

// Generate next order number for today (PHT timezone)
async function getNextOrderNumber(
  ctx: { db: any },
  storeId: Id<"stores">,
  orderType: "dine_in" | "takeout",
): Promise<string> {
  const prefix = orderType === "dine_in" ? "D" : "T";
  const { startOfDay, endOfDay } = getPHTDayBoundaries();

  // Get today's orders of this type (using PHT day boundaries)
  const todaysOrders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q.eq("storeId", storeId).gte("createdAt", startOfDay),
    )
    .filter((q: any) =>
      q.and(q.lt(q.field("createdAt"), endOfDay), q.eq(q.field("orderType"), orderType)),
    )
    .collect();

  // Also get still-open orders of this type from previous days
  // to avoid collisions in the active orders display
  const openOrdersFromPreviousDays = await ctx.db
    .query("orders")
    .withIndex("by_store_status", (q: any) => q.eq("storeId", storeId).eq("status", "open"))
    .filter((q: any) =>
      q.and(q.lt(q.field("createdAt"), startOfDay), q.eq(q.field("orderType"), orderType)),
    )
    .collect();

  // Find the highest existing number across both sets
  let maxNumber = 0;
  for (const order of [...todaysOrders, ...openOrdersFromPreviousDays]) {
    const match = order.orderNumber?.match(/\d+$/);
    if (match) {
      maxNumber = Math.max(maxNumber, Number.parseInt(match[0], 10));
    }
  }

  const nextNumber = maxNumber + 1;
  return `${prefix}-${nextNumber.toString().padStart(3, "0")}`;
}

// Create a new order
export const create = mutation({
  args: {
    storeId: v.id("stores"),
    orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
    tableId: v.optional(v.id("tables")),
    customerName: v.optional(v.string()),
    pax: v.optional(v.number()),
  },
  returns: v.id("orders"),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    // Validate dine-in orders have a table
    if (args.orderType === "dine_in" && !args.tableId) {
      throw new Error("Dine-in orders require a table");
    }

    // Validate dine-in orders have pax
    if (args.orderType === "dine_in" && !args.pax) {
      throw new Error("Dine-in orders require a guest count (pax)");
    }

    // Check table exists and get next tab number if dine-in
    let tabNumber: number | undefined;
    let tabName: string | undefined;
    let shouldMarkTableOccupied = false;

    if (args.tableId) {
      const table = await ctx.db.get(args.tableId);
      if (!table) throw new Error("Table not found");

      // Get existing open orders for this table to determine tab number
      const existingOpenOrders = await ctx.db
        .query("orders")
        .withIndex("by_tableId_status", (q) => q.eq("tableId", args.tableId).eq("status", "open"))
        .collect();

      // Find the highest tab number among open orders
      const maxTabNumber = existingOpenOrders.reduce(
        (max, order) => Math.max(max, order.tabNumber ?? 1),
        0,
      );
      tabNumber = maxTabNumber + 1;
      tabName = `Tab ${tabNumber}`;

      // Only mark table as occupied if this is the first tab
      shouldMarkTableOccupied = existingOpenOrders.length === 0;
    }

    // Generate order number
    const orderNumber = await getNextOrderNumber(ctx, args.storeId, args.orderType);

    // Determine order channel and takeout status
    const orderChannel = args.orderType === "dine_in" ? "walk_in_dine_in" : "walk_in_takeout";
    const takeoutStatus = args.orderType === "takeout" ? "pending" : undefined;

    // Create order with zero totals
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      storeId: args.storeId,
      orderNumber,
      orderType: args.orderType,
      orderChannel,
      takeoutStatus,
      tableId: args.tableId,
      customerName: args.customerName,
      status: "open",
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      paymentMethod: undefined,
      cashReceived: undefined,
      changeGiven: undefined,
      createdBy: user._id,
      createdAt: now,
      paidAt: undefined,
      paidBy: undefined,
      pax: args.pax,
      tabNumber,
      tabName,
    });

    // Update table status if dine-in and this is the first tab
    if (args.tableId && shouldMarkTableOccupied) {
      await ctx.db.patch(args.tableId, {
        status: "occupied",
        currentOrderId: orderId,
      });
    }

    return orderId;
  },
});

// Create a draft takeout order (not yet submitted for payment)
export const createDraftOrder = mutation({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.id("orders"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const { startOfDay } = getPHTDayBoundaries();

    // Count all drafts created today (monotonic — gaps allowed if drafts are discarded)
    const todaysDrafts = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay),
      )
      .filter((q) => q.eq(q.field("status"), "draft"))
      .collect();

    // Also include submitted (formerly draft) orders to avoid reusing numbers
    const todaysTakeoutOrders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay),
      )
      .filter((q) =>
        q.and(q.eq(q.field("orderType"), "takeout"), q.neq(q.field("draftLabel"), undefined)),
      )
      .collect();

    const allWithLabels = [...todaysDrafts, ...todaysTakeoutOrders];
    let maxNumber = 0;
    for (const draft of allWithLabels) {
      const match = draft.draftLabel?.match(/\d+$/);
      if (match) {
        maxNumber = Math.max(maxNumber, parseInt(match[0], 10));
      }
    }

    const draftLabel = `Customer #${maxNumber + 1}`;
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      storeId: args.storeId,
      orderType: "takeout",
      status: "draft",
      draftLabel,
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      createdBy: user._id,
      createdAt: now,
    });
    return orderId;
  },
});

// Submit a draft order — transitions draft → open
export const submitDraft = mutation({
  args: { orderId: v.id("orders") },
  returns: v.object({ orderNumber: v.string() }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "draft") throw new Error("Only draft orders can be submitted");

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .filter((q) => q.eq(q.field("isVoided"), false))
      .collect();
    if (items.length === 0) throw new Error("Cannot submit a draft with no items");

    const orderNumber = await getNextOrderNumber(ctx, order.storeId, "takeout");
    await ctx.db.patch(args.orderId, {
      status: "open",
      orderNumber,
      orderChannel: "walk_in_takeout",
      takeoutStatus: "pending",
    });
    return { orderNumber };
  },
});

// Discard a draft order — hard-deletes order, items, and modifiers
export const discardDraft = mutation({
  args: { orderId: v.id("orders") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "draft") throw new Error("Only draft orders can be discarded");

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();
    for (const item of items) {
      const modifiers = await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItem", (q) => q.eq("orderItemId", item._id))
        .collect();
      for (const mod of modifiers) {
        await ctx.db.delete(mod._id);
      }
      await ctx.db.delete(item._id);
    }
    await ctx.db.delete(args.orderId);
    return null;
  },
});

// Get all draft orders for a store
export const getDraftOrders = query({
  args: { storeId: v.id("stores") },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      draftLabel: v.optional(v.string()),
      customerName: v.optional(v.string()),
      itemCount: v.number(),
      subtotal: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const drafts = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q) => q.eq("storeId", args.storeId).eq("status", "draft"))
      .collect();

    const results = await Promise.all(
      drafts.map(async (draft) => {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", draft._id))
          .collect();
        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);
        return {
          _id: draft._id,
          draftLabel: draft.draftLabel,
          customerName: draft.customerName,
          itemCount,
          subtotal: draft.netSales,
          createdAt: draft.createdAt,
        };
      }),
    );
    return results;
  },
});

// Clean up expired drafts (created before today)
export const cleanupExpiredDrafts = mutation({
  args: { storeId: v.id("stores") },
  returns: v.object({ deletedCount: v.number() }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const { startOfDay } = getPHTDayBoundaries();

    const expiredDrafts = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q) => q.eq("storeId", args.storeId).eq("status", "draft"))
      .collect();
    const oldDrafts = expiredDrafts.filter((d) => d.createdAt < startOfDay);

    for (const draft of oldDrafts) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) => q.eq("orderId", draft._id))
        .collect();
      for (const item of items) {
        const modifiers = await ctx.db
          .query("orderItemModifiers")
          .withIndex("by_orderItem", (q) => q.eq("orderItemId", item._id))
          .collect();
        for (const mod of modifiers) {
          await ctx.db.delete(mod._id);
        }
        await ctx.db.delete(item._id);
      }
      await ctx.db.delete(draft._id);
    }
    return { deletedCount: oldDrafts.length };
  },
});

// Get single order with items
export const get = query({
  args: {
    orderId: v.id("orders"),
  },
  returns: v.union(
    v.object({
      _id: v.id("orders"),
      storeId: v.id("stores"),
      orderNumber: v.optional(v.string()),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableId: v.optional(v.id("tables")),
      tableName: v.optional(v.string()),
      tabNumber: v.optional(v.number()),
      tabName: v.optional(v.string()),
      pax: v.optional(v.number()),
      customerName: v.optional(v.string()),
      draftLabel: v.optional(v.string()),
      status: v.union(
        v.literal("draft"),
        v.literal("open"),
        v.literal("paid"),
        v.literal("voided"),
      ),
      takeoutStatus: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("preparing"),
          v.literal("ready_for_pickup"),
          v.literal("completed"),
          v.literal("cancelled"),
        ),
      ),
      grossSales: v.number(),
      vatableSales: v.number(),
      vatAmount: v.number(),
      vatExemptSales: v.number(),
      nonVatSales: v.number(),
      discountAmount: v.number(),
      netSales: v.number(),
      paymentMethod: v.optional(v.union(v.literal("cash"), v.literal("card_ewallet"))),
      cashReceived: v.optional(v.number()),
      changeGiven: v.optional(v.number()),
      cardPaymentType: v.optional(v.string()),
      cardReferenceNumber: v.optional(v.string()),
      createdBy: v.id("users"),
      createdByName: v.string(),
      createdAt: v.number(),
      paidAt: v.optional(v.number()),
      paidBy: v.optional(v.id("users")),
      items: v.array(
        v.object({
          _id: v.id("orderItems"),
          productId: v.id("products"),
          productName: v.string(),
          productPrice: v.number(),
          quantity: v.number(),
          notes: v.optional(v.string()),
          isVoided: v.boolean(),
          isSentToKitchen: v.optional(v.boolean()),
          lineTotal: v.number(),
          modifiers: v.array(
            v.object({
              groupName: v.string(),
              optionName: v.string(),
              priceAdjustment: v.number(),
            }),
          ),
        }),
      ),
      discounts: v.array(
        v.object({
          discountType: v.union(
            v.literal("senior_citizen"),
            v.literal("pwd"),
            v.literal("promo"),
            v.literal("manual"),
          ),
          customerName: v.string(),
          customerId: v.string(),
          quantityApplied: v.number(),
          discountAmount: v.number(),
        }),
      ),
      voids: v.array(
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
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) return null;

    // Get table name
    let tableName: string | undefined;
    if (order.tableId) {
      const table = await ctx.db.get(order.tableId);
      tableName = table?.name;
    }

    // Get creator name
    const creator = await ctx.db.get(order.createdBy);
    const createdByName = creator?.name ?? "Unknown";

    // Get order items
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    const itemsWithTotals = await Promise.all(
      items.map(async (item) => {
        // Fetch modifier snapshots
        const modifiers = await ctx.db
          .query("orderItemModifiers")
          .withIndex("by_orderItem", (q) => q.eq("orderItemId", item._id))
          .collect();

        const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);

        return {
          _id: item._id,
          productId: item.productId,
          productName: item.productName,
          productPrice: item.productPrice,
          quantity: item.quantity,
          notes: item.notes,
          isVoided: item.isVoided,
          isSentToKitchen: item.isSentToKitchen,
          lineTotal: item.isVoided ? 0 : (item.productPrice + modifierTotal) * item.quantity,
          modifiers: modifiers.map((m) => ({
            groupName: m.modifierGroupName,
            optionName: m.modifierOptionName,
            priceAdjustment: m.priceAdjustment,
          })),
        };
      }),
    );

    // Get order discounts
    const discountRecords = await ctx.db
      .query("orderDiscounts")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    const voidRecords = await ctx.db
      .query("orderVoids")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .order("desc")
      .collect();

    const voids = await Promise.all(
      voidRecords.map(async (voidRecord) => {
        const approver = await ctx.db.get(voidRecord.approvedBy);
        const requester = await ctx.db.get(voidRecord.requestedBy);

        return {
          _id: voidRecord._id,
          voidType: voidRecord.voidType,
          orderItemId: voidRecord.orderItemId,
          reason: voidRecord.reason,
          amount: voidRecord.amount,
          approvedByName: approver?.name ?? "Unknown",
          requestedByName: requester?.name ?? "Unknown",
          createdAt: voidRecord.createdAt,
        };
      }),
    );

    return {
      _id: order._id,
      storeId: order.storeId,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableId: order.tableId,
      tableName,
      tabNumber: order.tabNumber,
      tabName: order.tabName,
      pax: order.pax,
      customerName: order.customerName,
      draftLabel: order.draftLabel,
      status: order.status,
      takeoutStatus: order.takeoutStatus,
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
      createdBy: order.createdBy,
      createdByName,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      paidBy: order.paidBy,
      items: itemsWithTotals,
      discounts: discountRecords.map((d) => ({
        discountType: d.discountType,
        customerName: d.customerName,
        customerId: d.customerId,
        quantityApplied: d.quantityApplied,
        discountAmount: d.discountAmount,
      })),
      voids,
    };
  },
});

// List orders for a store
export const list = query({
  args: {
    storeId: v.id("stores"),
    status: v.optional(v.union(v.literal("open"), v.literal("paid"), v.literal("voided"))),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.optional(v.string()),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableName: v.optional(v.string()),
      tabNumber: v.optional(v.number()),
      tabName: v.optional(v.string()),
      customerName: v.optional(v.string()),
      status: v.union(
        v.literal("draft"),
        v.literal("open"),
        v.literal("paid"),
        v.literal("voided"),
      ),
      netSales: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get orders
    let orders: Doc<"orders">[];

    if (args.status) {
      const status = args.status;
      orders = await ctx.db
        .query("orders")
        .withIndex("by_store_status", (q) => q.eq("storeId", args.storeId).eq("status", status))
        .order("desc")
        .take(args.limit ?? 100);
    } else {
      const allOrders = await ctx.db
        .query("orders")
        .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
        .filter((q) => q.neq(q.field("status"), "draft"))
        .order("desc")
        .take(args.limit ?? 100);
      orders = allOrders;
    }

    // Get additional info for each order
    const results = await Promise.all(
      orders.map(async (order) => {
        // Get table name
        let tableName: string | undefined;
        if (order.tableId) {
          const table = await ctx.db.get(order.tableId);
          tableName = table?.name;
        }

        // Get item count
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .collect();

        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);

        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          tableName,
          tabNumber: order.tabNumber,
          tabName: order.tabName,
          customerName: order.customerName,
          status: order.status,
          netSales: order.netSales,
          itemCount,
          createdAt: order.createdAt,
        };
      }),
    );

    return results;
  },
});

// Get order history with date range, search, and status filtering
export const getOrderHistory = query({
  args: {
    storeId: v.id("stores"),
    startDate: v.number(),
    endDate: v.number(),
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("paid"), v.literal("voided"))),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.optional(v.string()),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableName: v.optional(v.string()),
      customerName: v.optional(v.string()),
      status: v.union(
        v.literal("draft"),
        v.literal("open"),
        v.literal("paid"),
        v.literal("voided"),
      ),
      netSales: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
      paymentMethod: v.optional(v.union(v.literal("cash"), v.literal("card_ewallet"))),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const allOrders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", args.startDate),
      )
      .filter((q) => q.lte(q.field("createdAt"), args.endDate))
      .order("desc")
      .collect();

    // Exclude draft orders
    let filtered = allOrders.filter((o) => o.status !== "draft");

    // Apply status filter
    if (args.status) {
      filtered = filtered.filter((o) => o.status === args.status);
    }

    // Apply search filter
    if (args.search) {
      const search = args.search.toLowerCase();
      filtered = filtered.filter(
        (o) =>
          (o.orderNumber?.toLowerCase().includes(search) ?? false) ||
          (o.customerName && o.customerName.toLowerCase().includes(search)),
      );
    }

    // Apply limit
    const limited = filtered.slice(0, args.limit ?? 50);

    // Resolve table names and item counts
    const results = await Promise.all(
      limited.map(async (order) => {
        let tableName: string | undefined;
        if (order.tableId) {
          const table = await ctx.db.get(order.tableId);
          tableName = table?.name;
        }

        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .collect();

        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);

        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          tableName,
          customerName: order.customerName,
          status: order.status,
          netSales: order.netSales,
          itemCount,
          createdAt: order.createdAt,
          paymentMethod: order.paymentMethod,
        };
      }),
    );

    return results;
  },
});

// Get open order for a table
export const getOpenByTable = query({
  args: {
    tableId: v.id("tables"),
  },
  returns: v.union(v.id("orders"), v.null()),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get the table's current order
    const table = await ctx.db.get(args.tableId);
    if (!table || !table.currentOrderId) return null;

    // Verify the order is still open
    const order = await ctx.db.get(table.currentOrderId);
    if (!order || order.status !== "open") return null;

    return order._id;
  },
});

// Add item to order
export const addItem = mutation({
  args: {
    orderId: v.id("orders"),
    productId: v.id("products"),
    quantity: v.number(),
    notes: v.optional(v.string()),
    customPrice: v.optional(v.number()),
    modifiers: v.optional(
      v.array(
        v.object({
          modifierGroupName: v.string(),
          modifierOptionName: v.string(),
          priceAdjustment: v.number(),
        }),
      ),
    ),
  },
  returns: v.id("orderItems"),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Validate order is open or draft
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open" && order.status !== "draft") {
      throw new Error("Cannot add items to a closed order");
    }

    // Get product
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Product not found");
    if (!product.isActive) throw new Error("Product is not available");

    // Resolve price: open-price products require customPrice
    let itemPrice: number;
    if (product.isOpenPrice) {
      if (args.customPrice === undefined) {
        throw new Error("Custom price is required for open-price products");
      }
      if (product.minPrice === undefined || product.maxPrice === undefined) {
        throw new Error("Open-price product is missing min/max price configuration");
      }
      if (args.customPrice < product.minPrice || args.customPrice > product.maxPrice) {
        throw new Error(`Price must be between ${product.minPrice} and ${product.maxPrice}`);
      }
      itemPrice = args.customPrice;
    } else {
      itemPrice = product.price;
    }

    // Create order item with product snapshot
    const itemId = await ctx.db.insert("orderItems", {
      orderId: args.orderId,
      productId: args.productId,
      productName: product.name,
      productPrice: itemPrice,
      quantity: args.quantity,
      notes: args.notes,
      isVoided: false,
      isSentToKitchen: false,
      voidedBy: undefined,
      voidedAt: undefined,
      voidReason: undefined,
    });

    // Insert modifier snapshots
    if (args.modifiers) {
      for (const mod of args.modifiers) {
        await ctx.db.insert("orderItemModifiers", {
          orderItemId: itemId,
          modifierGroupName: mod.modifierGroupName,
          modifierOptionName: mod.modifierOptionName,
          priceAdjustment: mod.priceAdjustment,
        });
      }
    }

    // Recalculate order totals
    await recalculateOrderTotals(ctx, args.orderId);

    return itemId;
  },
});

// Update item quantity
export const updateItemQuantity = mutation({
  args: {
    orderItemId: v.id("orderItems"),
    quantity: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get order item
    const item = await ctx.db.get(args.orderItemId);
    if (!item) throw new Error("Order item not found");
    if (item.isVoided) throw new Error("Cannot modify voided item");

    // Validate order is open or draft
    const order = await ctx.db.get(item.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open" && order.status !== "draft") {
      throw new Error("Cannot modify items in a closed order");
    }

    // Block quantity changes on sent items
    if (item.isSentToKitchen) {
      throw new Error("Cannot modify quantity of kitchen-sent items");
    }

    // Update quantity
    if (args.quantity <= 0) {
      throw new Error("Quantity must be positive");
    }

    await ctx.db.patch(args.orderItemId, { quantity: args.quantity });

    // Recalculate order totals
    await recalculateOrderTotals(ctx, item.orderId);

    return null;
  },
});

// Update item notes
export const updateItemNotes = mutation({
  args: {
    orderItemId: v.id("orderItems"),
    notes: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get order item
    const item = await ctx.db.get(args.orderItemId);
    if (!item) throw new Error("Order item not found");

    // Validate order is open or draft
    const order = await ctx.db.get(item.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open" && order.status !== "draft") {
      throw new Error("Cannot modify items in a closed order");
    }

    await ctx.db.patch(args.orderItemId, { notes: args.notes });
    return null;
  },
});

// Remove item from order (decreases quantity or removes entirely)
export const removeItem = mutation({
  args: {
    orderItemId: v.id("orderItems"),
    quantityToRemove: v.optional(v.number()),
    voidReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    // Get order item
    const item = await ctx.db.get(args.orderItemId);
    if (!item) throw new Error("Order item not found");
    if (item.isVoided) throw new Error("Item is already voided");

    // Validate order is open or draft
    const order = await ctx.db.get(item.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open" && order.status !== "draft") {
      throw new Error("Cannot modify items in a closed order");
    }

    if (item.isSentToKitchen) {
      // Sent items must be voided with a reason (not deleted)
      if (!args.voidReason?.trim()) {
        throw new Error("Void reason required for kitchen-sent items");
      }
      await ctx.db.patch(args.orderItemId, {
        isVoided: true,
        voidedBy: user._id,
        voidedAt: Date.now(),
        voidReason: args.voidReason.trim(),
      });
    } else {
      // Unsent items can be deleted or reduced
      const quantityToRemove = args.quantityToRemove ?? item.quantity;

      if (quantityToRemove >= item.quantity) {
        await ctx.db.delete(args.orderItemId);
      } else {
        await ctx.db.patch(args.orderItemId, {
          quantity: item.quantity - quantityToRemove,
        });
      }
    }

    // Recalculate order totals
    await recalculateOrderTotals(ctx, item.orderId);

    return null;
  },
});

// Helper function to recalculate order totals
async function recalculateOrderTotals(ctx: { db: any }, orderId: Id<"orders">): Promise<void> {
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

  // Get product info for VAT status and modifier adjustments
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

      // For now, no SC/PWD discounts in basic calculation
      // Those are handled separately in the discounts module
      return calculateItemTotals(effectivePrice, item.quantity, isVatable, 0, vatRate);
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

// Update customer name (for takeout orders)
export const updateCustomerName = mutation({
  args: {
    orderId: v.id("orders"),
    customerName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open" && order.status !== "draft") {
      throw new Error("Cannot modify a closed order");
    }

    await ctx.db.patch(args.orderId, { customerName: args.customerName });
    return null;
  },
});

// Update guest count (pax) for a dine-in order
export const updatePax = mutation({
  args: {
    orderId: v.id("orders"),
    pax: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot modify a closed order");
    }
    if (order.orderType !== "dine_in") {
      throw new Error("PAX is only applicable to dine-in orders");
    }
    if (args.pax < 1) {
      throw new Error("PAX must be at least 1");
    }

    await ctx.db.patch(args.orderId, { pax: args.pax });
    return null;
  },
});

// Update takeout order status (advance workflow)
export const updateTakeoutStatus = mutation({
  args: {
    orderId: v.id("orders"),
    newStatus: v.union(
      v.literal("pending"),
      v.literal("preparing"),
      v.literal("ready_for_pickup"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.orderType !== "takeout") throw new Error("Not a takeout order");

    // Validate status transitions
    const currentStatus = order.takeoutStatus;

    // Handle undefined/initial state
    if (!currentStatus) {
      if (args.newStatus !== "pending") {
        throw new Error("New takeout orders must start with 'pending' status");
      }
    } else {
      const validTransitions: Record<string, string[]> = {
        pending: ["preparing", "cancelled"],
        preparing: ["ready_for_pickup", "cancelled"],
        ready_for_pickup: ["completed"],
        completed: [],
        cancelled: [],
      };

      const allowedNext = validTransitions[currentStatus] ?? [];
      if (!allowedNext.includes(args.newStatus)) {
        throw new Error(`Cannot transition from ${currentStatus} to ${args.newStatus}`);
      }
    }

    await ctx.db.patch(args.orderId, { takeoutStatus: args.newStatus });
    return null;
  },
});

// Get today's takeout orders for a store
export const getTakeoutOrders = query({
  args: {
    storeId: v.id("stores"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.optional(v.string()),
      customerName: v.optional(v.string()),
      status: v.union(
        v.literal("draft"),
        v.literal("open"),
        v.literal("paid"),
        v.literal("voided"),
      ),
      takeoutStatus: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("preparing"),
          v.literal("ready_for_pickup"),
          v.literal("completed"),
          v.literal("cancelled"),
        ),
      ),
      netSales: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const { startOfDay: phtStartOfDay } = getPHTDayBoundaries();
    const startOfDay = args.startDate ?? phtStartOfDay;
    const endOfDay = args.endDate;

    const indexQuery = ctx.db.query("orders").withIndex("by_store_createdAt", (q) => {
      const q2 = q.eq("storeId", args.storeId).gte("createdAt", startOfDay);
      return endOfDay !== undefined ? q2.lte("createdAt", endOfDay) : q2;
    });

    const orders = await indexQuery
      .filter((q) =>
        q.and(q.eq(q.field("orderType"), "takeout"), q.neq(q.field("status"), "draft")),
      )
      .order("desc")
      .collect();

    const results = await Promise.all(
      orders.map(async (order) => {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .collect();

        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);

        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          status: order.status,
          takeoutStatus: order.takeoutStatus,
          netSales: order.netSales,
          itemCount,
          createdAt: order.createdAt,
        };
      }),
    );

    return results;
  },
});

// Get dashboard summary for POS home page
export const getDashboardSummary = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.object({
    totalOrdersToday: v.number(),
    activeDineIn: v.number(),
    activeTakeout: v.number(),
    todayRevenue: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const { startOfDay, endOfDay } = getPHTDayBoundaries();

    // Get all today's orders (PHT day)
    const todaysOrders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay),
      )
      .filter((q) => q.lt(q.field("createdAt"), endOfDay))
      .collect();

    const nonDraftOrders = todaysOrders.filter((o) => o.status !== "draft");
    const totalOrdersToday = nonDraftOrders.length;
    const activeDineIn = todaysOrders.filter(
      (o) => o.orderType === "dine_in" && o.status === "open",
    ).length;
    const activeTakeout = todaysOrders.filter(
      (o) => o.orderType === "takeout" && o.status === "open",
    ).length;
    const todayRevenue = todaysOrders
      .filter((o) => o.status === "paid")
      .reduce((sum, o) => sum + o.netSales, 0);

    return { totalOrdersToday, activeDineIn, activeTakeout, todayRevenue };
  },
});

// List active (open) orders for a store - used by POS table view
export const listActive = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.optional(v.string()),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableId: v.optional(v.id("tables")),
      tableName: v.optional(v.string()),
      pax: v.optional(v.number()),
      customerName: v.optional(v.string()),
      takeoutStatus: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("preparing"),
          v.literal("ready_for_pickup"),
          v.literal("completed"),
          v.literal("cancelled"),
        ),
      ),
      subtotal: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get open orders for this store
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q) => q.eq("storeId", args.storeId).eq("status", "open"))
      .collect();

    // Get additional info for each order
    const results = await Promise.all(
      orders.map(async (order) => {
        // Get table name
        let tableName: string | undefined;
        if (order.tableId) {
          const table = await ctx.db.get(order.tableId);
          tableName = table?.name;
        }

        // Get item count
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .collect();

        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);

        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          tableId: order.tableId,
          tableName,
          pax: order.pax,
          customerName: order.customerName,
          takeoutStatus: order.takeoutStatus,
          subtotal: order.netSales,
          itemCount,
          createdAt: order.createdAt,
        };
      }),
    );

    return results;
  },
});

// Get today's open orders for a store (for POS dashboard)
export const getTodaysOpenOrders = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.optional(v.string()),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableName: v.optional(v.string()),
      customerName: v.optional(v.string()),
      takeoutStatus: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("preparing"),
          v.literal("ready_for_pickup"),
          v.literal("completed"),
          v.literal("cancelled"),
        ),
      ),
      netSales: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get start of today (PHT)
    const { startOfDay } = getPHTDayBoundaries();

    // Get today's open orders
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q) => q.eq("storeId", args.storeId).eq("status", "open"))
      .filter((q) => q.gte(q.field("createdAt"), startOfDay))
      .collect();

    // Get additional info
    const results = await Promise.all(
      orders.map(async (order) => {
        let tableName: string | undefined;
        if (order.tableId) {
          const table = await ctx.db.get(order.tableId);
          tableName = table?.name;
        }

        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .collect();

        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);

        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          tableName,
          customerName: order.customerName,
          takeoutStatus: order.takeoutStatus,
          netSales: order.netSales,
          itemCount,
          createdAt: order.createdAt,
        };
      }),
    );

    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Send unsent items to kitchen (marks them as sent)
export const sendToKitchen = mutation({
  args: {
    orderId: v.id("orders"),
  },
  returns: v.object({
    sentItemIds: v.array(v.id("orderItems")),
  }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") throw new Error("Order is not open");

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    const unsentItems = items.filter((i) => !i.isVoided && !i.isSentToKitchen);
    if (unsentItems.length === 0) throw new Error("No new items to send");

    const sentItemIds: Id<"orderItems">[] = [];
    for (const item of unsentItems) {
      await ctx.db.patch(item._id, { isSentToKitchen: true });
      sentItemIds.push(item._id);
    }

    return { sentItemIds };
  },
});

// Create order and send items to kitchen in one step (first-time table order)
export const createAndSendToKitchen = mutation({
  args: {
    storeId: v.id("stores"),
    tableId: v.id("tables"),
    pax: v.number(),
    items: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
        notes: v.optional(v.string()),
        customPrice: v.optional(v.number()),
        modifiers: v.optional(
          v.array(
            v.object({
              modifierGroupName: v.string(),
              modifierOptionName: v.string(),
              priceAdjustment: v.number(),
            }),
          ),
        ),
      }),
    ),
  },
  returns: v.object({
    orderId: v.id("orders"),
    orderNumber: v.string(),
    sentItemIds: v.array(v.id("orderItems")),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    if (args.items.length === 0) throw new Error("No items to send");

    // Check table exists and get next tab number
    const table = await ctx.db.get(args.tableId);
    if (!table) throw new Error("Table not found");

    // Get existing open orders for this table to determine tab number
    const existingOpenOrders = await ctx.db
      .query("orders")
      .withIndex("by_tableId_status", (q) => q.eq("tableId", args.tableId).eq("status", "open"))
      .collect();

    // Find the highest tab number among open orders
    const maxTabNumber = existingOpenOrders.reduce(
      (max, order) => Math.max(max, order.tabNumber ?? 1),
      0,
    );
    const tabNumber = maxTabNumber + 1;
    const tabName = `Tab ${tabNumber}`;
    const shouldMarkTableOccupied = existingOpenOrders.length === 0;

    // Generate order number
    const orderNumber = await getNextOrderNumber(ctx, args.storeId, "dine_in");

    // Create order
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      storeId: args.storeId,
      orderNumber,
      orderType: "dine_in",
      orderChannel: "walk_in_dine_in",
      takeoutStatus: undefined,
      tableId: args.tableId,
      customerName: undefined,
      status: "open",
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      paymentMethod: undefined,
      cashReceived: undefined,
      changeGiven: undefined,
      createdBy: user._id,
      createdAt: now,
      paidAt: undefined,
      paidBy: undefined,
      pax: args.pax,
      tabNumber,
      tabName,
    });

    // Mark table as occupied only if this is the first tab
    if (shouldMarkTableOccupied) {
      await ctx.db.patch(args.tableId, {
        status: "occupied",
        currentOrderId: orderId,
      });
    }

    // Insert items and mark as sent
    const sentItemIds: Id<"orderItems">[] = [];
    for (const item of args.items) {
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error(`Product not found`);
      if (!product.isActive) throw new Error(`Product not available: ${product.name}`);

      // Resolve price: open-price products use customPrice
      let itemPrice: number;
      if (product.isOpenPrice) {
        if (item.customPrice === undefined) {
          throw new Error("Custom price is required for open-price products");
        }
        if (product.minPrice === undefined || product.maxPrice === undefined) {
          throw new Error("Open-price product is missing min/max price configuration");
        }
        if (item.customPrice < product.minPrice || item.customPrice > product.maxPrice) {
          throw new Error(`Price must be between ${product.minPrice} and ${product.maxPrice}`);
        }
        itemPrice = item.customPrice;
      } else {
        itemPrice = product.price;
      }

      const itemId = await ctx.db.insert("orderItems", {
        orderId,
        productId: item.productId,
        productName: product.name,
        productPrice: itemPrice,
        quantity: item.quantity,
        notes: item.notes,
        isVoided: false,
        isSentToKitchen: true,
        voidedBy: undefined,
        voidedAt: undefined,
        voidReason: undefined,
      });

      // Insert modifier snapshots
      if (item.modifiers) {
        for (const mod of item.modifiers) {
          await ctx.db.insert("orderItemModifiers", {
            orderItemId: itemId,
            modifierGroupName: mod.modifierGroupName,
            modifierOptionName: mod.modifierOptionName,
            priceAdjustment: mod.priceAdjustment,
          });
        }
      }

      sentItemIds.push(itemId);
    }

    // Recalculate order totals
    await recalculateOrderTotals(ctx, orderId);

    return { orderId, orderNumber, sentItemIds };
  },
});

// Get all open orders for a table (multi-tab support)
export const getOpenOrdersForTable = query({
  args: {
    tableId: v.id("tables"),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.optional(v.string()),
      tabNumber: v.number(),
      tabName: v.string(),
      itemCount: v.number(),
      netSales: v.number(),
      pax: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    // Get all open orders for this table using the new index
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_tableId_status", (q) => q.eq("tableId", args.tableId).eq("status", "open"))
      .collect();

    // Get item counts and format response
    const results = await Promise.all(
      orders.map(async (order) => {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .collect();

        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);

        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          tabNumber: order.tabNumber ?? 1,
          tabName: order.tabName ?? `Tab ${order.tabNumber ?? 1}`,
          itemCount,
          netSales: order.netSales,
          pax: order.pax,
          createdAt: order.createdAt,
        };
      }),
    );

    // Sort by tabNumber
    return results.sort((a, b) => a.tabNumber - b.tabNumber);
  },
});

// Update tab name for an order
export const updateTabName = mutation({
  args: {
    orderId: v.id("orders"),
    tabName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot modify a closed order");
    }
    if (order.orderType !== "dine_in") {
      throw new Error("Tab names are only for dine-in orders");
    }

    await ctx.db.patch(args.orderId, {
      tabName: args.tabName.trim() || `Tab ${order.tabNumber ?? 1}`,
    });
    return null;
  },
});

// Transfer a running bill from one table to another
export const transferTable = mutation({
  args: {
    orderId: v.id("orders"),
    newTableId: v.id("tables"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") throw new Error("Order is not open");
    if (!order.tableId) throw new Error("Order is not a dine-in order");

    const sourceTableId = order.tableId;

    // Check new table exists
    const newTable = await ctx.db.get(args.newTableId);
    if (!newTable) throw new Error("Table not found");

    // Get open orders at destination table to determine new tab number
    const destOpenOrders = await ctx.db
      .query("orders")
      .withIndex("by_tableId_status", (q) => q.eq("tableId", args.newTableId).eq("status", "open"))
      .collect();

    const maxDestTabNumber = destOpenOrders.reduce((max, o) => Math.max(max, o.tabNumber ?? 1), 0);
    const newTabNumber = maxDestTabNumber + 1;
    const newTabName = `Tab ${newTabNumber}`;
    const shouldMarkDestOccupied = destOpenOrders.length === 0;

    // Check if source table has other open orders
    const sourceOpenOrders = await ctx.db
      .query("orders")
      .withIndex("by_tableId_status", (q) => q.eq("tableId", sourceTableId).eq("status", "open"))
      .collect();

    const remainingSourceOrders = sourceOpenOrders.filter((o) => o._id !== args.orderId);
    const shouldReleaseSource = remainingSourceOrders.length === 0;

    // Release source table only if no other open orders remain
    if (shouldReleaseSource) {
      await ctx.db.patch(sourceTableId, {
        status: "available",
        currentOrderId: undefined,
      });
    }

    // Mark destination table as occupied if this is the first order there
    if (shouldMarkDestOccupied) {
      await ctx.db.patch(args.newTableId, {
        status: "occupied",
        currentOrderId: args.orderId,
      });
    }

    // Update order with new table and new tab number
    await ctx.db.patch(args.orderId, {
      tableId: args.newTableId,
      tabNumber: newTabNumber,
      tabName: newTabName,
    });

    return null;
  },
});
