import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { requirePermission } from "./lib/permissions";
import { requireAuth } from "./lib/auth";

// List tables for a store
export const list = query({
  args: {
    storeId: v.id("stores"),
    status: v.optional(
      v.union(v.literal("available"), v.literal("occupied"))
    ),
    includeInactive: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("tables"),
      storeId: v.id("stores"),
      name: v.string(),
      capacity: v.optional(v.number()),
      status: v.union(v.literal("available"), v.literal("occupied")),
      currentOrderId: v.optional(v.id("orders")),
      sortOrder: v.number(),
      isActive: v.boolean(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get tables for the store
    let tables: Doc<"tables">[];

    if (args.status) {
      const status = args.status;
      tables = await ctx.db
        .query("tables")
        .withIndex("by_store_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", status)
        )
        .collect();
    } else {
      tables = await ctx.db
        .query("tables")
        .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
        .collect();
    }

    // Filter by active status if needed
    if (!args.includeInactive) {
      tables = tables.filter((t) => t.isActive);
    }

    // Sort by sortOrder
    tables.sort((a, b) => a.sortOrder - b.sortOrder);

    return tables.map((table) => ({
      _id: table._id,
      storeId: table.storeId,
      name: table.name,
      capacity: table.capacity,
      status: table.status,
      currentOrderId: table.currentOrderId,
      sortOrder: table.sortOrder,
      isActive: table.isActive,
      createdAt: table.createdAt,
    }));
  },
});

// Get single table
export const get = query({
  args: {
    tableId: v.id("tables"),
  },
  returns: v.union(
    v.object({
      _id: v.id("tables"),
      storeId: v.id("stores"),
      name: v.string(),
      capacity: v.optional(v.number()),
      status: v.union(v.literal("available"), v.literal("occupied")),
      currentOrderId: v.optional(v.id("orders")),
      sortOrder: v.number(),
      isActive: v.boolean(),
      createdAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    const table = await ctx.db.get(args.tableId);
    return table;
  },
});

// Create table
export const create = mutation({
  args: {
    storeId: v.id("stores"),
    name: v.string(),
    capacity: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.id("tables"),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    // Check permission
    await requirePermission(ctx, user._id, "tables.manage");

    // Determine sort order
    let sortOrder = args.sortOrder;
    if (sortOrder === undefined) {
      const existingTables = await ctx.db
        .query("tables")
        .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
        .collect();

      sortOrder =
        existingTables.length > 0
          ? Math.max(...existingTables.map((t) => t.sortOrder)) + 1
          : 0;
    }

    return await ctx.db.insert("tables", {
      storeId: args.storeId,
      name: args.name,
      capacity: args.capacity,
      status: "available",
      currentOrderId: undefined,
      sortOrder,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

// Update table
export const update = mutation({
  args: {
    tableId: v.id("tables"),
    name: v.optional(v.string()),
    capacity: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    await requirePermission(ctx, user._id, "tables.manage");

    // Cannot deactivate a table that has an active order
    if (args.isActive === false) {
      const table = await ctx.db.get(args.tableId);
      if (table && table.currentOrderId) {
        throw new Error("Cannot deactivate a table with an active order");
      }
    }

    const { tableId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    await ctx.db.patch(tableId, filteredUpdates);
    return null;
  },
});

// Update table status (used when orders are opened/closed)
export const updateStatus = mutation({
  args: {
    tableId: v.id("tables"),
    status: v.union(v.literal("available"), v.literal("occupied")),
    currentOrderId: v.optional(v.id("orders")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    const table = await ctx.db.get(args.tableId);
    if (!table) throw new Error("Table not found");

    await ctx.db.patch(args.tableId, {
      status: args.status,
      currentOrderId:
        args.status === "available" ? undefined : args.currentOrderId,
    });
    return null;
  },
});

// Reorder tables
export const reorder = mutation({
  args: {
    tableIds: v.array(v.id("tables")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Require authenticated user
    const user = await requireAuth(ctx);

    await requirePermission(ctx, user._id, "tables.manage");

    // Update sortOrder for each table
    for (let i = 0; i < args.tableIds.length; i++) {
      await ctx.db.patch(args.tableIds[i], { sortOrder: i });
    }

    return null;
  },
});

// Get available tables for a store (POS use)
export const getAvailable = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("tables"),
      name: v.string(),
      capacity: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get available and active tables
    const tables = await ctx.db
      .query("tables")
      .withIndex("by_store_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "available")
      )
      .collect();

    return tables
      .filter((t) => t.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        _id: t._id,
        name: t.name,
        capacity: t.capacity,
      }));
  },
});

// Get table with current order details (for POS view)
export const getWithOrder = query({
  args: {
    tableId: v.id("tables"),
  },
  returns: v.union(
    v.object({
      _id: v.id("tables"),
      name: v.string(),
      capacity: v.optional(v.number()),
      status: v.union(v.literal("available"), v.literal("occupied")),
      order: v.optional(
        v.object({
          _id: v.id("orders"),
          orderNumber: v.string(),
          orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
          itemCount: v.number(),
          netSales: v.number(),
          createdAt: v.number(),
        })
      ),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    const table = await ctx.db.get(args.tableId);
    if (!table) return null;

    let order:
      | {
          _id: Doc<"orders">["_id"];
          orderNumber: string;
          orderType: "dine_in" | "takeout";
          itemCount: number;
          netSales: number;
          createdAt: number;
        }
      | undefined;

    if (table.currentOrderId) {
      const orderDoc = await ctx.db.get(table.currentOrderId);
      if (orderDoc) {
        // Get item count
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", orderDoc._id))
          .collect();

        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);

        order = {
          _id: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          orderType: orderDoc.orderType,
          itemCount,
          netSales: orderDoc.netSales,
          createdAt: orderDoc.createdAt,
        };
      }
    }

    return {
      _id: table._id,
      name: table.name,
      capacity: table.capacity,
      status: table.status,
      order,
    };
  },
});

// Get all tables with order summaries (for POS floor view)
export const listWithOrders = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("tables"),
      name: v.string(),
      capacity: v.optional(v.number()),
      status: v.union(v.literal("available"), v.literal("occupied")),
      sortOrder: v.number(),
      order: v.optional(
        v.object({
          _id: v.id("orders"),
          orderNumber: v.string(),
          itemCount: v.number(),
          netSales: v.number(),
          createdAt: v.number(),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    // Require authenticated user
    await requireAuth(ctx);

    // Get active tables for the store
    const tables = await ctx.db
      .query("tables")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .collect();

    const activeTables = tables
      .filter((t) => t.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Get order details for each table
    const results = await Promise.all(
      activeTables.map(async (table) => {
        let order:
          | {
              _id: Doc<"orders">["_id"];
              orderNumber: string;
              itemCount: number;
              netSales: number;
              createdAt: number;
            }
          | undefined;

        if (table.currentOrderId) {
          const orderDoc = await ctx.db.get(table.currentOrderId);
          if (orderDoc) {
            // Get item count
            const items = await ctx.db
              .query("orderItems")
              .withIndex("by_order", (q) => q.eq("orderId", orderDoc._id))
              .collect();

            const activeItems = items.filter((i) => !i.isVoided);
            const itemCount = activeItems.reduce(
              (sum, i) => sum + i.quantity,
              0
            );

            order = {
              _id: orderDoc._id,
              orderNumber: orderDoc.orderNumber,
              itemCount,
              netSales: orderDoc.netSales,
              createdAt: orderDoc.createdAt,
            };
          }
        }

        return {
          _id: table._id,
          name: table.name,
          capacity: table.capacity,
          status: table.status,
          sortOrder: table.sortOrder,
          order,
        };
      })
    );

    return results;
  },
});
