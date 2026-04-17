import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import {
  getBusinessDayBoundaries,
  getBusinessDayBoundariesForDate,
  getReportBoundariesForDate,
  type StoreSchedule,
} from "./lib/businessDay";
import { getPHTDayBoundaries, getPHTHour } from "./lib/dateUtils";
import { requirePermission } from "./lib/permissions";
import { cleanupExpiredDraftOrders } from "./orders";

// Helper: Calculate payment method totals for a set of paid orders
// Queries orderPayments table first; falls back to legacy order.paymentMethod
async function calculatePaymentTotals(
  ctx: { db: any },
  paidOrders: Array<{ _id: Id<"orders">; netSales: number; paymentMethod?: string }>,
): Promise<{ cashTotal: number; cardEwalletTotal: number }> {
  let cashTotal = 0;
  let cardEwalletTotal = 0;

  for (const order of paidOrders) {
    const paymentRows = await ctx.db
      .query("orderPayments")
      .withIndex("by_order", (q: any) => q.eq("orderId", order._id))
      .collect();

    if (paymentRows.length > 0) {
      // Split payment: sum by method from orderPayments
      for (const p of paymentRows) {
        if (p.paymentMethod === "cash") {
          cashTotal += p.amount;
        } else if (p.paymentMethod === "card_ewallet") {
          cardEwalletTotal += p.amount;
        }
      }
    } else {
      // Legacy single-payment: use order.paymentMethod
      if (order.paymentMethod === "cash") {
        cashTotal += order.netSales;
      } else if (order.paymentMethod === "card_ewallet") {
        cardEwalletTotal += order.netSales;
      }
    }
  }

  return { cashTotal, cardEwalletTotal };
}

// Generate or get daily report for a store
export const generateDailyReport = mutation({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(), // YYYY-MM-DD format
    startTime: v.optional(v.string()), // "HH:mm" in PHT, e.g. "06:00"
    endTime: v.optional(v.string()), // "HH:mm" in PHT, e.g. "22:00"
  },
  returns: v.id("dailyReports"),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    const store = await ctx.db.get(args.storeId);
    const schedule = store?.schedule;

    // Check for existing report
    const existingReport = await ctx.db
      .query("dailyReports")
      .withIndex("by_store_date", (q) =>
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate),
      )
      .first();

    if (existingReport) {
      // Return existing report, but regenerate the data
      const reportData = await aggregateDailyData(
        ctx,
        args.storeId,
        args.reportDate,
        schedule,
        args.startTime,
        args.endTime,
      );

      await ctx.db.patch(existingReport._id, {
        ...reportData,
        startTime: args.startTime,
        endTime: args.endTime,
        generatedAt: Date.now(),
        generatedBy: currentUser._id,
      });

      // Regenerate product sales breakdown
      await generateProductSalesBreakdown(
        ctx,
        args.storeId,
        args.reportDate,
        schedule,
        args.startTime,
        args.endTime,
      );

      // Regenerate payment transactions breakdown
      await generatePaymentTransactionsBreakdown(
        ctx,
        args.storeId,
        args.reportDate,
        schedule,
        args.startTime,
        args.endTime,
      );

      // Clean up expired draft orders
      await cleanupExpiredDraftOrders(ctx, args.storeId);

      return existingReport._id;
    }

    // Aggregate data
    const reportData = await aggregateDailyData(
      ctx,
      args.storeId,
      args.reportDate,
      schedule,
      args.startTime,
      args.endTime,
    );

    // Create report
    const reportId = await ctx.db.insert("dailyReports", {
      storeId: args.storeId,
      reportDate: args.reportDate,
      startTime: args.startTime,
      endTime: args.endTime,
      ...reportData,
      generatedAt: Date.now(),
      generatedBy: currentUser._id,
      isPrinted: false,
      printedAt: undefined,
    });

    // Also generate product sales breakdown
    await generateProductSalesBreakdown(
      ctx,
      args.storeId,
      args.reportDate,
      schedule,
      args.startTime,
      args.endTime,
    );

    // Also generate payment transactions breakdown
    await generatePaymentTransactionsBreakdown(
      ctx,
      args.storeId,
      args.reportDate,
      schedule,
      args.startTime,
      args.endTime,
    );

    // Clean up expired draft orders (created before today's PHT boundary)
    await cleanupExpiredDraftOrders(ctx, args.storeId);

    return reportId;
  },
});

// Helper: Aggregate daily data from orders
async function aggregateDailyData(
  ctx: { db: any },
  storeId: Id<"stores">,
  reportDate: string,
  schedule: StoreSchedule | undefined,
  startTime?: string,
  endTime?: string,
): Promise<{
  grossSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  nonVatSales: number;
  netSales: number;
  seniorDiscounts: number;
  pwdDiscounts: number;
  promoDiscounts: number;
  manualDiscounts: number;
  totalDiscounts: number;
  voidCount: number;
  voidAmount: number;
  cashTotal: number;
  cardEwalletTotal: number;
  transactionCount: number;
  averageTicket: number;
}> {
  // Parse date range (schedule-aware boundaries, with optional time range override)
  const { start: startOfDay, end: endOfDay } = getReportBoundariesForDate(
    schedule,
    reportDate,
    startTime,
    endTime,
  );

  // Get all orders for the day
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q.eq("storeId", storeId).gte("createdAt", startOfDay).lt("createdAt", endOfDay),
    )
    .collect();

  // Separate paid and voided orders
  const paidOrders = orders.filter((o: any) => o.status === "paid");
  const voidedOrders = orders.filter((o: any) => o.status === "voided");

  // Calculate totals from paid orders
  let grossSales = 0;
  let vatableSales = 0;
  let vatAmount = 0;
  let vatExemptSales = 0;
  let nonVatSales = 0;
  let netSales = 0;
  for (const order of paidOrders) {
    grossSales += order.grossSales;
    vatableSales += order.vatableSales;
    vatAmount += order.vatAmount;
    vatExemptSales += order.vatExemptSales;
    nonVatSales += order.nonVatSales;
    netSales += order.netSales;
  }

  // Calculate payment method totals (handles split payments via orderPayments table)
  const { cashTotal, cardEwalletTotal } = await calculatePaymentTotals(ctx, paidOrders);

  // Calculate void amount from voided orders
  let voidAmount = 0;
  let voidCount = voidedOrders.length;

  for (const order of voidedOrders) {
    // Check if this was a refund void (has replacement order)
    const voids = await ctx.db
      .query("orderVoids")
      .withIndex("by_order", (q: any) => q.eq("orderId", order._id))
      .collect();
    const refundVoid = voids.find((v: any) => v.voidType === "refund");

    if (refundVoid) {
      // For refund voids, use the recorded refund amount (the difference only)
      voidAmount += refundVoid.amount;
    } else {
      // For regular voids, use the full order netSales
      voidAmount += order.netSales;
    }
  }

  // Also get item-level voids from paid orders
  const orderVoids = await ctx.db.query("orderVoids").collect();
  const dayVoids = orderVoids.filter((v: any) => {
    return v.createdAt >= startOfDay && v.createdAt < endOfDay;
  });

  for (const v of dayVoids) {
    if (v.voidType === "item") {
      voidAmount += v.amount;
      voidCount++;
    }
  }

  // Calculate discount breakdowns
  let seniorDiscounts = 0;
  let pwdDiscounts = 0;
  let promoDiscounts = 0;
  let manualDiscounts = 0;

  // Get discounts from paid orders
  for (const order of paidOrders) {
    const discounts = await ctx.db
      .query("orderDiscounts")
      .withIndex("by_order", (q: any) => q.eq("orderId", order._id))
      .collect();

    for (const discount of discounts) {
      switch (discount.discountType) {
        case "senior_citizen":
          seniorDiscounts += discount.discountAmount;
          break;
        case "pwd":
          pwdDiscounts += discount.discountAmount;
          break;
        case "promo":
          promoDiscounts += discount.discountAmount;
          break;
        case "manual":
          manualDiscounts += discount.discountAmount;
          break;
      }
    }
  }

  const totalDiscounts = seniorDiscounts + pwdDiscounts + promoDiscounts + manualDiscounts;

  // Calculate average ticket
  const transactionCount = paidOrders.length;
  const averageTicket = transactionCount > 0 ? netSales / transactionCount : 0;

  return {
    grossSales: roundToTwo(grossSales),
    vatableSales: roundToTwo(vatableSales),
    vatAmount: roundToTwo(vatAmount),
    vatExemptSales: roundToTwo(vatExemptSales),
    nonVatSales: roundToTwo(nonVatSales),
    netSales: roundToTwo(netSales),
    seniorDiscounts: roundToTwo(seniorDiscounts),
    pwdDiscounts: roundToTwo(pwdDiscounts),
    promoDiscounts: roundToTwo(promoDiscounts),
    manualDiscounts: roundToTwo(manualDiscounts),
    totalDiscounts: roundToTwo(totalDiscounts),
    voidCount,
    voidAmount: roundToTwo(voidAmount),
    cashTotal: roundToTwo(cashTotal),
    cardEwalletTotal: roundToTwo(cardEwalletTotal),
    transactionCount,
    averageTicket: roundToTwo(averageTicket),
  };
}

// Helper: Round to two decimal places
function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}

// Helper: Generate product sales breakdown for the day
async function generateProductSalesBreakdown(
  ctx: { db: any },
  storeId: Id<"stores">,
  reportDate: string,
  schedule: StoreSchedule | undefined,
  startTime?: string,
  endTime?: string,
): Promise<void> {
  // Parse date range (schedule-aware boundaries, with optional time range)
  const { start: startOfDay, end: endOfDay } = getReportBoundariesForDate(
    schedule,
    reportDate,
    startTime,
    endTime,
  );

  // Delete existing product sales for this date
  const existingProductSales = await ctx.db
    .query("dailyProductSales")
    .withIndex("by_store_date", (q: any) => q.eq("storeId", storeId).eq("reportDate", reportDate))
    .collect();

  for (const ps of existingProductSales) {
    await ctx.db.delete(ps._id);
  }

  // Get all orders for the day
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q.eq("storeId", storeId).gte("createdAt", startOfDay).lt("createdAt", endOfDay),
    )
    .collect();

  const paidOrders = orders.filter((o: any) => o.status === "paid");

  // Aggregate product sales
  const productSalesMap = new Map<
    string,
    {
      productId: Id<"products">;
      productName: string;
      categoryId: Id<"categories">;
      categoryName: string;
      parentCategoryName: string;
      quantitySold: number;
      grossAmount: number;
      voidedQuantity: number;
      voidedAmount: number;
    }
  >();

  // Process each order's items
  for (const order of paidOrders) {
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q: any) => q.eq("orderId", order._id))
      .collect();

    for (const item of items) {
      const key = item.productId;
      const existing = productSalesMap.get(key);

      // Include modifier price adjustments to match order grossSales calculation
      const modifiers = await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", item._id))
        .collect();
      const modifierTotal = modifiers.reduce((sum: number, m: any) => sum + m.priceAdjustment, 0);
      const effectivePrice = item.productPrice + modifierTotal;
      const lineTotal = effectivePrice * item.quantity;

      if (item.isVoided) {
        // Track voided items
        if (existing) {
          existing.voidedQuantity += item.quantity;
          existing.voidedAmount += lineTotal;
        } else {
          // Get product and category info
          const product = await ctx.db.get(item.productId);
          const category = product ? await ctx.db.get(product.categoryId) : null;
          let parentCategoryName = "";
          if (category?.parentId) {
            const parentCategory = await ctx.db.get(category.parentId);
            parentCategoryName = parentCategory?.name ?? "";
          }

          productSalesMap.set(key, {
            productId: item.productId,
            productName: item.productName,
            categoryId: product?.categoryId,
            categoryName: category?.name ?? "Unknown",
            parentCategoryName,
            quantitySold: 0,
            grossAmount: 0,
            voidedQuantity: item.quantity,
            voidedAmount: lineTotal,
          });
        }
      } else {
        // Track sold items
        if (existing) {
          existing.quantitySold += item.quantity;
          existing.grossAmount += lineTotal;
        } else {
          // Get product and category info
          const product = await ctx.db.get(item.productId);
          const category = product ? await ctx.db.get(product.categoryId) : null;
          let parentCategoryName = "";
          if (category?.parentId) {
            const parentCategory = await ctx.db.get(category.parentId);
            parentCategoryName = parentCategory?.name ?? "";
          }

          productSalesMap.set(key, {
            productId: item.productId,
            productName: item.productName,
            categoryId: product?.categoryId,
            categoryName: category?.name ?? "Unknown",
            parentCategoryName,
            quantitySold: item.quantity,
            grossAmount: lineTotal,
            voidedQuantity: 0,
            voidedAmount: 0,
          });
        }
      }
    }
  }

  // Insert product sales records
  const productSalesEntries = Array.from(productSalesMap.values());
  for (const data of productSalesEntries) {
    // Only insert if we have a valid categoryId
    if (data.categoryId) {
      await ctx.db.insert("dailyProductSales", {
        storeId,
        reportDate,
        ...data,
      });
    }
  }
}

// Helper: Generate payment transactions breakdown for non-cash orders
async function generatePaymentTransactionsBreakdown(
  ctx: { db: any },
  storeId: Id<"stores">,
  reportDate: string,
  schedule: StoreSchedule | undefined,
  startTime?: string,
  endTime?: string,
): Promise<void> {
  // Delete existing payment transactions for this date
  const existingTransactions = await ctx.db
    .query("dailyPaymentTransactions")
    .withIndex("by_store_date", (q: any) => q.eq("storeId", storeId).eq("reportDate", reportDate))
    .collect();

  for (const tx of existingTransactions) {
    await ctx.db.delete(tx._id);
  }

  // Parse date range (schedule-aware boundaries, with optional time range)
  const { start: startOfDay, end: endOfDay } = getReportBoundariesForDate(
    schedule,
    reportDate,
    startTime,
    endTime,
  );

  // Get all orders for the day
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q.eq("storeId", storeId).gte("createdAt", startOfDay).lt("createdAt", endOfDay),
    )
    .collect();

  // Get all paid orders
  const paidOrders = orders.filter((o: any) => o.status === "paid");

  // Insert one row per non-cash payment (handles split payments)
  for (const order of paidOrders) {
    const paymentRows = await ctx.db
      .query("orderPayments")
      .withIndex("by_order", (q: any) => q.eq("orderId", order._id))
      .collect();

    if (paymentRows.length > 0) {
      // New split-payment orders: insert a row per card/e-wallet payment
      for (const p of paymentRows) {
        if (p.paymentMethod === "card_ewallet") {
          await ctx.db.insert("dailyPaymentTransactions", {
            storeId,
            reportDate,
            orderId: order._id,
            orderNumber: order.orderNumber ?? "",
            paymentType: p.cardPaymentType ?? "Unknown",
            referenceNumber: p.cardReferenceNumber ?? "",
            amount: p.amount,
            paidAt: order.paidAt ?? order._creationTime,
          });
        }
      }
    } else if (order.paymentMethod === "card_ewallet") {
      // Legacy single-payment card orders
      await ctx.db.insert("dailyPaymentTransactions", {
        storeId,
        reportDate,
        orderId: order._id,
        orderNumber: order.orderNumber ?? "",
        paymentType: order.cardPaymentType ?? "Unknown",
        referenceNumber: order.cardReferenceNumber ?? "",
        amount: order.netSales,
        paidAt: order.paidAt ?? order._creationTime,
      });
    }
  }
}

// Get daily report
export const getDailyReport = query({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("dailyReports"),
      reportDate: v.string(),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      grossSales: v.number(),
      vatableSales: v.number(),
      vatAmount: v.number(),
      vatExemptSales: v.number(),
      nonVatSales: v.number(),
      netSales: v.number(),
      seniorDiscounts: v.number(),
      pwdDiscounts: v.number(),
      promoDiscounts: v.number(),
      manualDiscounts: v.number(),
      totalDiscounts: v.number(),
      voidCount: v.number(),
      voidAmount: v.number(),
      cashTotal: v.number(),
      cardEwalletTotal: v.number(),
      transactionCount: v.number(),
      averageTicket: v.number(),
      generatedAt: v.number(),
      generatedByName: v.string(),
      isPrinted: v.boolean(),
      printedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Get report
    const report = await ctx.db
      .query("dailyReports")
      .withIndex("by_store_date", (q) =>
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate),
      )
      .first();

    if (!report) return null;

    // Get generator name
    const generator = await ctx.db.get(report.generatedBy);

    return {
      _id: report._id,
      reportDate: report.reportDate,
      startTime: report.startTime,
      endTime: report.endTime,
      grossSales: report.grossSales,
      vatableSales: report.vatableSales,
      vatAmount: report.vatAmount,
      vatExemptSales: report.vatExemptSales,
      nonVatSales: report.nonVatSales,
      netSales: report.netSales,
      seniorDiscounts: report.seniorDiscounts,
      pwdDiscounts: report.pwdDiscounts,
      promoDiscounts: report.promoDiscounts,
      manualDiscounts: report.manualDiscounts,
      totalDiscounts: report.totalDiscounts,
      voidCount: report.voidCount,
      voidAmount: report.voidAmount,
      cashTotal: report.cashTotal,
      cardEwalletTotal: report.cardEwalletTotal,
      transactionCount: report.transactionCount,
      averageTicket: report.averageTicket,
      generatedAt: report.generatedAt,
      generatedByName: generator?.name ?? "Unknown",
      isPrinted: report.isPrinted,
      printedAt: report.printedAt,
    };
  },
});

// Get product sales for a day
export const getDailyProductSales = query({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
    categoryId: v.optional(v.id("categories")),
  },
  returns: v.array(
    v.object({
      productId: v.id("products"),
      productName: v.string(),
      categoryId: v.id("categories"),
      categoryName: v.string(),
      parentCategoryName: v.string(),
      quantitySold: v.number(),
      grossAmount: v.number(),
      voidedQuantity: v.number(),
      voidedAmount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Get product sales
    let productSales: Doc<"dailyProductSales">[];
    if (args.categoryId !== undefined) {
      const categoryId = args.categoryId;
      productSales = await ctx.db
        .query("dailyProductSales")
        .withIndex("by_store_date_category", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("reportDate", args.reportDate)
            .eq("categoryId", categoryId),
        )
        .collect();
    } else {
      productSales = await ctx.db
        .query("dailyProductSales")
        .withIndex("by_store_date", (q) =>
          q.eq("storeId", args.storeId).eq("reportDate", args.reportDate),
        )
        .collect();
    }

    return productSales.map((ps) => ({
      productId: ps.productId,
      productName: ps.productName,
      categoryId: ps.categoryId,
      categoryName: ps.categoryName,
      parentCategoryName: ps.parentCategoryName,
      quantitySold: ps.quantitySold,
      grossAmount: ps.grossAmount,
      voidedQuantity: ps.voidedQuantity,
      voidedAmount: ps.voidedAmount,
    }));
  },
});

// Get payment transactions for a day (non-cash only, grouped by payment type)
export const getDailyPaymentTransactions = query({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
  },
  returns: v.array(
    v.object({
      paymentType: v.string(),
      transactions: v.array(
        v.object({
          orderId: v.id("orders"),
          orderNumber: v.string(),
          referenceNumber: v.string(),
          amount: v.number(),
          paidAt: v.number(),
        }),
      ),
      subtotal: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    const transactions = await ctx.db
      .query("dailyPaymentTransactions")
      .withIndex("by_store_date", (q) =>
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate),
      )
      .collect();

    // Group by paymentType
    const groupMap = new Map<
      string,
      {
        paymentType: string;
        transactions: {
          orderId: Id<"orders">;
          orderNumber: string;
          referenceNumber: string;
          amount: number;
          paidAt: number;
        }[];
        subtotal: number;
      }
    >();

    for (const tx of transactions) {
      const existing = groupMap.get(tx.paymentType);
      if (existing) {
        existing.transactions.push({
          orderId: tx.orderId,
          orderNumber: tx.orderNumber,
          referenceNumber: tx.referenceNumber,
          amount: tx.amount,
          paidAt: tx.paidAt,
        });
        existing.subtotal += tx.amount;
      } else {
        groupMap.set(tx.paymentType, {
          paymentType: tx.paymentType,
          transactions: [
            {
              orderId: tx.orderId,
              orderNumber: tx.orderNumber,
              referenceNumber: tx.referenceNumber,
              amount: tx.amount,
              paidAt: tx.paidAt,
            },
          ],
          subtotal: tx.amount,
        });
      }
    }

    // Sort transactions within each group by paidAt
    const results = Array.from(groupMap.values());
    for (const group of results) {
      group.transactions.sort((a, b) => a.paidAt - b.paidAt);
      group.subtotal = roundToTwo(group.subtotal);
    }

    // Sort groups alphabetically by paymentType
    results.sort((a, b) => a.paymentType.localeCompare(b.paymentType));

    return results;
  },
});

// Mark report as printed
export const markReportPrinted = mutation({
  args: {
    reportId: v.id("dailyReports"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Verify permission
    await requirePermission(ctx, currentUser._id, "reports.print_eod");

    // Update report
    await ctx.db.patch(args.reportId, {
      isPrinted: true,
      printedAt: Date.now(),
    });

    return null;
  },
});

// Get date range report (summary across multiple days)
export const getDateRangeReport = query({
  args: {
    storeId: v.id("stores"),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({
    startDate: v.string(),
    endDate: v.string(),
    totalGrossSales: v.number(),
    totalVatableSales: v.number(),
    totalVatAmount: v.number(),
    totalVatExemptSales: v.number(),
    totalNonVatSales: v.number(),
    totalDiscounts: v.number(),
    totalNetSales: v.number(),
    totalVoidAmount: v.number(),
    totalTransactionCount: v.number(),
    totalVoidCount: v.number(),
    totalCashSales: v.number(),
    totalCardSales: v.number(),
    averageTicket: v.number(),
    dailyBreakdown: v.array(
      v.object({
        reportDate: v.string(),
        netSales: v.number(),
        transactionCount: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Verify permission for date range (all_dates)
    await requirePermission(ctx, currentUser._id, "reports.all_dates");

    // Get all reports in date range
    const allReports = await ctx.db
      .query("dailyReports")
      .withIndex("by_store_date", (q) => q.eq("storeId", args.storeId))
      .collect();

    const reports = allReports.filter(
      (r) => r.reportDate >= args.startDate && r.reportDate <= args.endDate,
    );

    // Aggregate totals
    let totalGrossSales = 0;
    let totalVatableSales = 0;
    let totalVatAmount = 0;
    let totalVatExemptSales = 0;
    let totalNonVatSales = 0;
    let totalDiscounts = 0;
    let totalNetSales = 0;
    let totalVoidAmount = 0;
    let totalTransactionCount = 0;
    let totalVoidCount = 0;
    let totalCashSales = 0;
    let totalCardSales = 0;

    const dailyBreakdown = [];

    for (const report of reports) {
      totalGrossSales += report.grossSales;
      totalVatableSales += report.vatableSales;
      totalVatAmount += report.vatAmount;
      totalVatExemptSales += report.vatExemptSales;
      totalNonVatSales += report.nonVatSales;
      totalDiscounts += report.totalDiscounts;
      totalNetSales += report.netSales;
      totalVoidAmount += report.voidAmount;
      totalTransactionCount += report.transactionCount;
      totalVoidCount += report.voidCount;
      totalCashSales += report.cashTotal;
      totalCardSales += report.cardEwalletTotal;

      dailyBreakdown.push({
        reportDate: report.reportDate,
        netSales: report.netSales,
        transactionCount: report.transactionCount,
      });
    }

    // Sort daily breakdown by date
    dailyBreakdown.sort((a, b) => a.reportDate.localeCompare(b.reportDate));

    const averageTicket = totalTransactionCount > 0 ? totalNetSales / totalTransactionCount : 0;

    return {
      startDate: args.startDate,
      endDate: args.endDate,
      totalGrossSales: roundToTwo(totalGrossSales),
      totalVatableSales: roundToTwo(totalVatableSales),
      totalVatAmount: roundToTwo(totalVatAmount),
      totalVatExemptSales: roundToTwo(totalVatExemptSales),
      totalNonVatSales: roundToTwo(totalNonVatSales),
      totalDiscounts: roundToTwo(totalDiscounts),
      totalNetSales: roundToTwo(totalNetSales),
      totalVoidAmount: roundToTwo(totalVoidAmount),
      totalTransactionCount,
      totalVoidCount,
      totalCashSales: roundToTwo(totalCashSales),
      totalCardSales: roundToTwo(totalCardSales),
      averageTicket: roundToTwo(averageTicket),
      dailyBreakdown,
    };
  },
});

// Get branch summary (for multi-store overview)
export const getBranchSummary = query({
  args: {
    parentStoreId: v.optional(v.id("stores")),
    reportDate: v.string(),
  },
  returns: v.array(
    v.object({
      storeId: v.id("stores"),
      storeName: v.string(),
      netSales: v.number(),
      transactionCount: v.number(),
      voidAmount: v.number(),
      averageTicket: v.number(),
      hasReport: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Verify permission
    await requirePermission(ctx, currentUser._id, "reports.branch_summary");

    // Get stores (either branches of parent or all stores)
    let stores: Doc<"stores">[];
    if (args.parentStoreId) {
      stores = await ctx.db
        .query("stores")
        .withIndex("by_parent", (q) => q.eq("parentId", args.parentStoreId))
        .collect();
    } else {
      stores = await ctx.db
        .query("stores")
        .withIndex("by_isActive", (q) => q.eq("isActive", true))
        .collect();
    }

    // Get report for each store
    const results = await Promise.all(
      stores.map(async (store) => {
        const report = await ctx.db
          .query("dailyReports")
          .withIndex("by_store_date", (q) =>
            q.eq("storeId", store._id).eq("reportDate", args.reportDate),
          )
          .first();

        return {
          storeId: store._id,
          storeName: store.name,
          netSales: report?.netSales ?? 0,
          transactionCount: report?.transactionCount ?? 0,
          voidAmount: report?.voidAmount ?? 0,
          averageTicket: report?.averageTicket ?? 0,
          hasReport: !!report,
        };
      }),
    );

    // Sort by net sales descending
    results.sort((a, b) => b.netSales - a.netSales);

    return results;
  },
});

// Get hourly sales breakdown for a day
export const getHourlySales = query({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      hour: v.number(),
      transactionCount: v.number(),
      netSales: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    const store = await ctx.db.get(args.storeId);

    // Parse date range (PHT boundaries, with optional time range)
    const { start: startOfDay, end: endOfDay } = getReportBoundariesForDate(
      store?.schedule,
      args.reportDate,
      args.startTime,
      args.endTime,
    );

    // Get all paid orders for the day
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay).lt("createdAt", endOfDay),
      )
      .collect();

    const paidOrders = orders.filter((o) => o.status === "paid");

    // Aggregate by hour
    const hourlyData = new Map<number, { transactionCount: number; netSales: number }>();

    // Initialize all hours
    for (let h = 0; h < 24; h++) {
      hourlyData.set(h, { transactionCount: 0, netSales: 0 });
    }

    // Aggregate orders by PHT hour
    for (const order of paidOrders) {
      const hour = getPHTHour(order.createdAt);
      const data = hourlyData.get(hour)!;
      data.transactionCount++;
      data.netSales += order.netSales;
    }

    // Convert to array
    const results = Array.from(hourlyData.entries()).map(([hour, data]) => ({
      hour,
      transactionCount: data.transactionCount,
      netSales: roundToTwo(data.netSales),
    }));

    return results;
  },
});

// Get top selling products
export const getTopSellingProducts = query({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      productId: v.id("products"),
      productName: v.string(),
      categoryName: v.string(),
      quantitySold: v.number(),
      grossAmount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Get product sales
    const productSales = await ctx.db
      .query("dailyProductSales")
      .withIndex("by_store_date", (q) =>
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate),
      )
      .collect();

    // Sort by quantity sold (descending)
    productSales.sort((a, b) => b.quantitySold - a.quantitySold);

    // Apply limit
    const limited = args.limit ? productSales.slice(0, args.limit) : productSales;

    return limited.map((ps) => ({
      productId: ps.productId,
      productName: ps.productName,
      categoryName: ps.categoryName,
      quantitySold: ps.quantitySold,
      grossAmount: ps.grossAmount,
    }));
  },
});

// Get category sales summary
export const getCategorySales = query({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
  },
  returns: v.array(
    v.object({
      categoryId: v.id("categories"),
      categoryName: v.string(),
      parentCategoryName: v.string(),
      productCount: v.number(),
      totalQuantitySold: v.number(),
      totalGrossAmount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Get product sales
    const productSales = await ctx.db
      .query("dailyProductSales")
      .withIndex("by_store_date", (q) =>
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate),
      )
      .collect();

    // Aggregate by category
    const categoryMap = new Map<
      string,
      {
        categoryId: Id<"categories">;
        categoryName: string;
        parentCategoryName: string;
        productCount: number;
        totalQuantitySold: number;
        totalGrossAmount: number;
      }
    >();

    for (const ps of productSales) {
      const key = ps.categoryId;
      const existing = categoryMap.get(key);

      if (existing) {
        existing.productCount++;
        existing.totalQuantitySold += ps.quantitySold;
        existing.totalGrossAmount += ps.grossAmount;
      } else {
        categoryMap.set(key, {
          categoryId: ps.categoryId,
          categoryName: ps.categoryName,
          parentCategoryName: ps.parentCategoryName,
          productCount: 1,
          totalQuantitySold: ps.quantitySold,
          totalGrossAmount: ps.grossAmount,
        });
      }
    }

    // Convert to array and sort by gross amount
    const results = Array.from(categoryMap.values());
    results.sort((a, b) => b.totalGrossAmount - a.totalGrossAmount);

    return results.map((r) => ({
      ...r,
      totalGrossAmount: roundToTwo(r.totalGrossAmount),
    }));
  },
});

// Live dashboard summary - computes directly from orders (no pre-generated report needed)
export const getDashboardSummary = query({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(), // YYYY-MM-DD format
  },
  returns: v.object({
    grossSales: v.number(),
    vatAmount: v.number(),
    netSales: v.number(),
    cashTotal: v.number(),
    cardEwalletTotal: v.number(),
    totalDiscounts: v.number(),
    transactionCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    const store = await ctx.db.get(args.storeId);
    const { startOfDay, endOfDay } = getBusinessDayBoundariesForDate(
      store?.schedule,
      args.reportDate,
    );

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay).lt("createdAt", endOfDay),
      )
      .collect();

    const paidOrders = orders.filter((o) => o.status === "paid");

    let grossSales = 0;
    let vatAmount = 0;
    let netSales = 0;

    for (const order of paidOrders) {
      grossSales += order.grossSales;
      vatAmount += order.vatAmount;
      netSales += order.netSales;
    }

    // Calculate payment method totals (handles split payments via orderPayments table)
    const { cashTotal, cardEwalletTotal } = await calculatePaymentTotals(ctx, paidOrders);

    // Calculate discounts
    let totalDiscounts = 0;
    for (const order of paidOrders) {
      totalDiscounts += order.discountAmount;
    }

    const transactionCount = paidOrders.length;

    return {
      grossSales: roundToTwo(grossSales),
      vatAmount: roundToTwo(vatAmount),
      netSales: roundToTwo(netSales),
      cashTotal: roundToTwo(cashTotal),
      cardEwalletTotal: roundToTwo(cardEwalletTotal),
      totalDiscounts: roundToTwo(totalDiscounts),
      transactionCount,
    };
  },
});

// Live top selling products - computes directly from order items
export const getTopSellingProductsLive = query({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      productId: v.id("products"),
      productName: v.string(),
      quantitySold: v.number(),
      grossAmount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    const store = await ctx.db.get(args.storeId);
    const { startOfDay, endOfDay } = getBusinessDayBoundariesForDate(
      store?.schedule,
      args.reportDate,
    );

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay).lt("createdAt", endOfDay),
      )
      .collect();

    const paidOrders = orders.filter((o) => o.status === "paid");

    const productMap = new Map<
      string,
      { productId: Id<"products">; productName: string; quantitySold: number; grossAmount: number }
    >();

    for (const order of paidOrders) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .collect();

      for (const item of items) {
        if (item.isVoided) continue;
        const existing = productMap.get(item.productId);
        if (existing) {
          existing.quantitySold += item.quantity;
          existing.grossAmount += item.productPrice * item.quantity;
        } else {
          productMap.set(item.productId, {
            productId: item.productId,
            productName: item.productName,
            quantitySold: item.quantity,
            grossAmount: item.productPrice * item.quantity,
          });
        }
      }
    }

    const results = Array.from(productMap.values());
    results.sort((a, b) => b.quantitySold - a.quantitySold);

    const limited = args.limit ? results.slice(0, args.limit) : results;
    return limited.map((r) => ({
      ...r,
      grossAmount: roundToTwo(r.grossAmount),
    }));
  },
});

// Returns the current business-day date (YYYY-MM-DD PHT) for a store, honoring
// the store's schedule. Stays subscribed so clients re-render when the business
// day rolls over (e.g. at the configured close time).
export const getCurrentBusinessDate = query({
  args: { storeId: v.id("stores") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }
    const store = await ctx.db.get(args.storeId);
    const { businessDate } = getBusinessDayBoundaries(store?.schedule);
    return businessDate;
  },
});
