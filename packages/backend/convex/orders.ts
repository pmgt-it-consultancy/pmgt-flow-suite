import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  calculateItemTotals,
  aggregateOrderTotals,
  ItemCalculation,
} from "./lib/taxCalculations";

// Generate next order number for today
async function getNextOrderNumber(
  ctx: { db: any },
  storeId: Id<"stores">
): Promise<string> {
  // Get today's date in YYYY-MM-DD format
  const today = new Date();
  const dateString = today.toISOString().split("T")[0];
  const startOfDay = new Date(dateString).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

  // Count today's orders for this store
  const todaysOrders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q.eq("storeId", storeId).gte("createdAt", startOfDay)
    )
    .filter((q: any) => q.lt(q.field("createdAt"), endOfDay))
    .collect();

  const nextNumber = todaysOrders.length + 1;
  return nextNumber.toString().padStart(3, "0");
}

// Create a new order
export const create = mutation({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
    orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
    tableId: v.optional(v.id("tables")),
    customerName: v.optional(v.string()),
  },
  returns: v.id("orders"),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    const user = await ctx.db.get(session.userId);
    if (!user) throw new Error("User not found");

    // Validate dine-in orders have a table
    if (args.orderType === "dine_in" && !args.tableId) {
      throw new Error("Dine-in orders require a table");
    }

    // Check table availability if dine-in
    if (args.tableId) {
      const table = await ctx.db.get(args.tableId);
      if (!table) throw new Error("Table not found");
      if (table.status === "occupied") {
        throw new Error("Table is already occupied");
      }
    }

    // Generate order number
    const orderNumber = await getNextOrderNumber(ctx, args.storeId);

    // Create order with zero totals
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      storeId: args.storeId,
      orderNumber,
      orderType: args.orderType,
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
    });

    // Update table status if dine-in
    if (args.tableId) {
      await ctx.db.patch(args.tableId, {
        status: "occupied",
        currentOrderId: orderId,
      });
    }

    return orderId;
  },
});

// Get single order with items
export const get = query({
  args: {
    token: v.string(),
    orderId: v.id("orders"),
  },
  returns: v.union(
    v.object({
      _id: v.id("orders"),
      storeId: v.id("stores"),
      orderNumber: v.string(),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableId: v.optional(v.id("tables")),
      tableName: v.optional(v.string()),
      customerName: v.optional(v.string()),
      status: v.union(v.literal("open"), v.literal("paid"), v.literal("voided")),
      grossSales: v.number(),
      vatableSales: v.number(),
      vatAmount: v.number(),
      vatExemptSales: v.number(),
      nonVatSales: v.number(),
      discountAmount: v.number(),
      netSales: v.number(),
      paymentMethod: v.optional(
        v.union(v.literal("cash"), v.literal("card_ewallet"))
      ),
      cashReceived: v.optional(v.number()),
      changeGiven: v.optional(v.number()),
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
          lineTotal: v.number(),
        })
      ),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

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

    const itemsWithTotals = items.map((item) => ({
      _id: item._id,
      productId: item.productId,
      productName: item.productName,
      productPrice: item.productPrice,
      quantity: item.quantity,
      notes: item.notes,
      isVoided: item.isVoided,
      lineTotal: item.isVoided ? 0 : item.productPrice * item.quantity,
    }));

    return {
      _id: order._id,
      storeId: order.storeId,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableId: order.tableId,
      tableName,
      customerName: order.customerName,
      status: order.status,
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
      createdBy: order.createdBy,
      createdByName,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      paidBy: order.paidBy,
      items: itemsWithTotals,
    };
  },
});

// List orders for a store
export const list = query({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
    status: v.optional(
      v.union(v.literal("open"), v.literal("paid"), v.literal("voided"))
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.string(),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableName: v.optional(v.string()),
      customerName: v.optional(v.string()),
      status: v.union(v.literal("open"), v.literal("paid"), v.literal("voided")),
      netSales: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    // Get orders
    let orders: Doc<"orders">[];

    if (args.status) {
      const status = args.status;
      orders = await ctx.db
        .query("orders")
        .withIndex("by_store_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", status)
        )
        .order("desc")
        .take(args.limit ?? 100);
    } else {
      orders = await ctx.db
        .query("orders")
        .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
        .order("desc")
        .take(args.limit ?? 100);
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
          customerName: order.customerName,
          status: order.status,
          netSales: order.netSales,
          itemCount,
          createdAt: order.createdAt,
        };
      })
    );

    return results;
  },
});

// Get open order for a table
export const getOpenByTable = query({
  args: {
    token: v.string(),
    tableId: v.id("tables"),
  },
  returns: v.union(v.id("orders"), v.null()),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

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
    token: v.string(),
    orderId: v.id("orders"),
    productId: v.id("products"),
    quantity: v.number(),
    notes: v.optional(v.string()),
  },
  returns: v.id("orderItems"),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    // Validate order is open
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot add items to a closed order");
    }

    // Get product
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Product not found");
    if (!product.isActive) throw new Error("Product is not available");

    // Create order item with product snapshot
    const itemId = await ctx.db.insert("orderItems", {
      orderId: args.orderId,
      productId: args.productId,
      productName: product.name,
      productPrice: product.price,
      quantity: args.quantity,
      notes: args.notes,
      isVoided: false,
      voidedBy: undefined,
      voidedAt: undefined,
      voidReason: undefined,
    });

    // Recalculate order totals
    await recalculateOrderTotals(ctx, args.orderId);

    return itemId;
  },
});

// Update item quantity
export const updateItemQuantity = mutation({
  args: {
    token: v.string(),
    orderItemId: v.id("orderItems"),
    quantity: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    // Get order item
    const item = await ctx.db.get(args.orderItemId);
    if (!item) throw new Error("Order item not found");
    if (item.isVoided) throw new Error("Cannot modify voided item");

    // Validate order is open
    const order = await ctx.db.get(item.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot modify items in a closed order");
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
    token: v.string(),
    orderItemId: v.id("orderItems"),
    notes: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    // Get order item
    const item = await ctx.db.get(args.orderItemId);
    if (!item) throw new Error("Order item not found");

    // Validate order is open
    const order = await ctx.db.get(item.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot modify items in a closed order");
    }

    await ctx.db.patch(args.orderItemId, { notes: args.notes });
    return null;
  },
});

// Remove item from order (decreases quantity or removes entirely)
export const removeItem = mutation({
  args: {
    token: v.string(),
    orderItemId: v.id("orderItems"),
    quantityToRemove: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    // Get order item
    const item = await ctx.db.get(args.orderItemId);
    if (!item) throw new Error("Order item not found");
    if (item.isVoided) throw new Error("Item is already voided");

    // Validate order is open
    const order = await ctx.db.get(item.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot modify items in a closed order");
    }

    const quantityToRemove = args.quantityToRemove ?? item.quantity;

    if (quantityToRemove >= item.quantity) {
      // Remove entirely (delete from database since order is still open)
      await ctx.db.delete(args.orderItemId);
    } else {
      // Reduce quantity
      await ctx.db.patch(args.orderItemId, {
        quantity: item.quantity - quantityToRemove,
      });
    }

    // Recalculate order totals
    await recalculateOrderTotals(ctx, item.orderId);

    return null;
  },
});

// Helper function to recalculate order totals
async function recalculateOrderTotals(
  ctx: { db: any },
  orderId: Id<"orders">
): Promise<void> {
  // Get all active (non-voided) items
  const items = await ctx.db
    .query("orderItems")
    .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
    .collect();

  const activeItems: Doc<"orderItems">[] = items.filter(
    (i: Doc<"orderItems">) => !i.isVoided
  );

  // Get product info for VAT status
  const itemCalculations: ItemCalculation[] = await Promise.all(
    activeItems.map(async (item: Doc<"orderItems">) => {
      const product = await ctx.db.get(item.productId);
      const isVatable = product?.isVatable ?? true;

      // For now, no SC/PWD discounts in basic calculation
      // Those are handled separately in the discounts module
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

// Update customer name (for takeout orders)
export const updateCustomerName = mutation({
  args: {
    token: v.string(),
    orderId: v.id("orders"),
    customerName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot modify a closed order");
    }

    await ctx.db.patch(args.orderId, { customerName: args.customerName });
    return null;
  },
});

// List active (open) orders for a store - used by POS table view
export const listActive = query({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.string(),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableId: v.optional(v.id("tables")),
      tableName: v.optional(v.string()),
      customerName: v.optional(v.string()),
      subtotal: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    // Get open orders for this store
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "open")
      )
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
          customerName: order.customerName,
          subtotal: order.netSales,
          itemCount,
          createdAt: order.createdAt,
        };
      })
    );

    return results;
  },
});

// Get today's open orders for a store (for POS dashboard)
export const getTodaysOpenOrders = query({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.string(),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableName: v.optional(v.string()),
      customerName: v.optional(v.string()),
      netSales: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    // Get start of today
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    ).getTime();

    // Get today's open orders
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "open")
      )
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
          netSales: order.netSales,
          itemCount,
          createdAt: order.createdAt,
        };
      })
    );

    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});
