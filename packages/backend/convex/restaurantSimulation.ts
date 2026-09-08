import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireStagingLab } from "./lib/stagingLab";
import { aggregateOrderTotals, calculateItemTotals } from "./lib/taxCalculations";

const key = (storeId: Id<"stores">, kind: string, index: number) =>
  `sim-restaurant-v1:${storeId}:${kind}:${index}`;
const label = (index: number) => String(index + 1).padStart(3, "0");

export const countPage = internalQuery({
  args: {
    storeId: v.id("stores"),
    table: v.union(
      v.literal("categories"),
      v.literal("products"),
      v.literal("modifierGroups"),
      v.literal("modifierOptions"),
      v.literal("modifierGroupAssignments"),
      v.literal("tables"),
      v.literal("orders"),
      v.literal("orderItems"),
      v.literal("orderItemModifiers"),
      v.literal("orderPayments"),
    ),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    count: v.number(),
    isDone: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { storeId, table, cursor }) => {
    requireStagingLab();
    const prefix = `sim-restaurant-v1:${storeId}:`;
    const page = await ctx.db
      .query(table)
      .withIndex("by_clientId", (q) => q.gte("clientId", prefix).lt("clientId", `${prefix}\uffff`))
      .paginate({ cursor, numItems: 1000 });
    return {
      count: page.page.length,
      isDone: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const seedCatalog = internalMutation({
  args: { storeId: v.id("stores") },
  returns: v.object({
    categories: v.number(),
    groups: v.number(),
    options: v.number(),
    products: v.number(),
    tables: v.number(),
  }),
  handler: async (ctx, { storeId }) => {
    requireStagingLab();
    const store = await ctx.db.get(storeId);
    if (!store?.isActive) throw new Error("Select an active staging store");
    const now = Date.now();
    const counts = { categories: 0, groups: 0, options: 0, products: 0, tables: 0 };
    const categories: Id<"categories">[] = [];
    for (let i = 0; i < 20; i++) {
      const categoryKey = key(storeId, "category", i);
      const existingCategory = await ctx.db
        .query("categories")
        .withIndex("by_clientId", (q) => q.eq("clientId", categoryKey))
        .unique();
      const categoryId =
        existingCategory?._id ??
        (await ctx.db.insert("categories", {
          storeId,
          name: `SIM Menu ${label(i)}`,
          sortOrder: 1000 + i,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          clientId: categoryKey,
        }));
      if (!existingCategory) counts.categories++;
      categories.push(categoryId);
      const groupKey = key(storeId, "group", i);
      const existingGroup = await ctx.db
        .query("modifierGroups")
        .withIndex("by_clientId", (q) => q.eq("clientId", groupKey))
        .unique();
      const groupId =
        existingGroup?._id ??
        (await ctx.db.insert("modifierGroups", {
          storeId,
          name: `SIM Preparation ${label(i)}`,
          selectionType: "single",
          minSelections: 1,
          maxSelections: 1,
          sortOrder: i,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          clientId: groupKey,
        }));
      if (!existingGroup) counts.groups++;
      for (const [j, option] of [
        { name: "Regular", price: 0 },
        { name: "Large", price: 20 },
        { name: "Less sauce", price: 0 },
        { name: "Extra sauce", price: 10 },
      ].entries()) {
        const clientId = key(storeId, "option", i * 4 + j);
        if (
          await ctx.db
            .query("modifierOptions")
            .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
            .unique()
        )
          continue;
        await ctx.db.insert("modifierOptions", {
          storeId,
          modifierGroupId: groupId,
          name: option.name,
          priceAdjustment: option.price,
          isDefault: j === 0,
          isAvailable: true,
          sortOrder: j,
          createdAt: now,
          updatedAt: now,
          clientId,
        });
        counts.options++;
      }
      const assignmentKey = key(storeId, "assignment", i);
      if (
        !(await ctx.db
          .query("modifierGroupAssignments")
          .withIndex("by_clientId", (q) => q.eq("clientId", assignmentKey))
          .unique())
      ) {
        await ctx.db.insert("modifierGroupAssignments", {
          storeId,
          modifierGroupId: groupId,
          categoryId,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
          clientId: assignmentKey,
        });
      }
    }
    const names = [
      "Chicken Rice",
      "Beef Bowl",
      "Pork BBQ",
      "Fish Fillet",
      "Vegetable Plate",
      "Noodle Bowl",
      "Milk Tea",
      "Fruit Shake",
      "Soup",
      "Dessert",
    ];
    for (let i = 0; i < 500; i++) {
      const clientId = key(storeId, "product", i);
      if (
        await ctx.db
          .query("products")
          .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
          .unique()
      )
        continue;
      await ctx.db.insert("products", {
        storeId,
        categoryId: categories[i % 20],
        name: `SIM ${names[i % names.length]} ${label(i)}`,
        price: 112 + (i % 20) * 28,
        isVatable: i % 5 !== 0,
        isActive: true,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
        clientId,
      });
      counts.products++;
    }
    for (let i = 0; i < 80; i++) {
      const clientId = key(storeId, "table", i);
      if (
        await ctx.db
          .query("tables")
          .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
          .unique()
      )
        continue;
      await ctx.db.insert("tables", {
        storeId,
        name: `SIM Table ${label(i)}`,
        capacity: 4 + (i % 3) * 2,
        status: "available",
        sortOrder: 1000 + i,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        clientId,
      });
      counts.tables++;
    }
    return counts;
  },
});

export const seedOrders = internalMutation({
  args: {
    storeId: v.id("stores"),
    actorId: v.id("users"),
    kind: v.union(v.literal("history"), v.literal("active"), v.literal("traffic")),
    start: v.number(),
    count: v.number(),
    epoch: v.number(),
    runId: v.optional(v.string()),
  },
  returns: v.object({ inserted: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    requireStagingLab();
    const { storeId, actorId, kind, start, count, epoch } = args;
    const limit = kind === "history" ? 10_000 : kind === "active" ? 50 : 120;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(count) ||
      start < 0 ||
      count < 1 ||
      count > 50 ||
      start + count > limit ||
      !Number.isFinite(epoch) ||
      epoch <= 0
    ) {
      throw new Error("Invalid simulation batch range");
    }
    if (kind === "traffic" && !/^[a-zA-Z0-9-]{1,40}$/.test(args.runId ?? ""))
      throw new Error("Traffic requires a short alphanumeric runId");
    const store = await ctx.db.get(storeId);
    const actor = await ctx.db.get(actorId);
    if (!store?.isActive || !actor?.isActive || (actor.storeId && actor.storeId !== storeId))
      throw new Error("Select an active staging store and an operator with matching store scope");
    const now = Date.now();
    const products = new Map<number, Doc<"products">>();
    let inserted = 0;
    let skipped = 0;
    for (let i = start; i < start + count; i++) {
      const orderKey = key(storeId, kind === "traffic" ? `traffic-${args.runId}` : kind, i);
      if (
        await ctx.db
          .query("orders")
          .withIndex("by_requestId", (q) => q.eq("requestId", orderKey))
          .unique()
      ) {
        skipped++;
        continue;
      }
      const lines = [];
      for (let j = 0; j < 4; j++) {
        const index = (i * 4 + j) % 500;
        let product = products.get(index);
        if (!product) {
          product =
            (await ctx.db
              .query("products")
              .withIndex("by_clientId", (q) => q.eq("clientId", key(storeId, "product", index)))
              .unique()) ?? undefined;
          if (!product) throw new Error("Seed the simulation catalog first");
          products.set(index, product);
        }
        lines.push({
          product,
          quantity: 1 + (j % 2),
          groupName: `SIM Preparation ${label(index % 20)}`,
        });
      }
      const paid = kind === "history";
      const day = 86_400_000;
      const phtMidnight = Math.floor((epoch + 8 * 3_600_000) / day) * day - 8 * 3_600_000;
      const createdAt = paid
        ? phtMidnight - (1 + (i % 90)) * day + 9 * 3_600_000 + (Math.floor(i / 90) % 60) * 60_000
        : epoch + (kind === "traffic" ? 0 : i * 1000);
      const desiredTable = (kind === "active" && i < 25) || (paid && i % 2 === 0);
      const candidateTable = desiredTable
        ? await ctx.db
            .query("tables")
            .withIndex("by_clientId", (q) => q.eq("clientId", key(storeId, "table", i % 80)))
            .unique()
        : null;
      // Never steal a table occupied through the operator's own testing.
      const table =
        candidateTable && (paid || candidateTable.status === "available") ? candidateTable : null;
      const totals = aggregateOrderTotals(
        lines.map(({ product, quantity }) =>
          calculateItemTotals(product.price + 20, quantity, product.isVatable, 0, store.vatRate),
        ),
      );
      const orderId = await ctx.db.insert("orders", {
        storeId,
        orderNumber: `SIM-${paid ? "H" : kind === "active" ? "A" : `R-${args.runId}`}-${String(i + 1).padStart(5, "0")}`,
        orderType: table ? "dine_in" : "takeout",
        orderCategory: table ? "dine_in" : "takeout",
        orderChannel: table ? "walk_in_dine_in" : "walk_in_takeout",
        takeoutStatus: table ? undefined : paid ? "completed" : "preparing",
        tableId: table?._id,
        tableName: table?.name,
        status: paid ? "paid" : "open",
        customerName: "SIMULATED TEST ORDER",
        ...totals,
        itemCount: 6,
        pax: 4,
        createdBy: actorId,
        createdAt,
        paidAt: paid ? createdAt + 180_000 : undefined,
        paidBy: paid ? actorId : undefined,
        paymentMethod: paid ? "cash" : undefined,
        cashReceived: paid ? totals.netSales : undefined,
        changeGiven: paid ? 0 : undefined,
        requestId: orderKey,
        clientId: orderKey,
        updatedAt: now,
      });
      for (const [j, line] of lines.entries()) {
        const itemId = await ctx.db.insert("orderItems", {
          storeId,
          orderId,
          productId: line.product._id,
          productName: line.product.name,
          productPrice: line.product.price,
          quantity: line.quantity,
          notes: "SIMULATION — no real sale",
          serviceType: table ? "dine_in" : "takeout",
          isVoided: false,
          isSentToKitchen: true,
          clientId: `${orderKey}:item:${j}`,
          updatedAt: now,
        });
        await ctx.db.insert("orderItemModifiers", {
          storeId,
          orderItemId: itemId,
          modifierGroupName: line.groupName,
          modifierOptionName: "Large",
          priceAdjustment: 20,
          clientId: `${orderKey}:modifier:${j}`,
          updatedAt: now,
        });
      }
      if (paid) {
        await ctx.db.insert("orderPayments", {
          storeId,
          orderId,
          paymentMethod: "cash",
          amount: totals.netSales,
          cashReceived: totals.netSales,
          changeGiven: 0,
          createdAt: createdAt + 180_000,
          createdBy: actorId,
          clientId: `${orderKey}:payment`,
          updatedAt: now,
        });
      } else if (table) {
        await ctx.db.patch(table._id, {
          status: "occupied",
          currentOrderId: orderId,
          updatedAt: now,
        });
      }
      inserted++;
    }
    return { inserted, skipped };
  },
});
