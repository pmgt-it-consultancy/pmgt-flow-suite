import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requirePermission } from "./lib/permissions";
import { getAuthenticatedUser } from "./lib/auth";

// Generate or get daily report for a store
export const generateDailyReport = mutation({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(), // YYYY-MM-DD format
  },
  returns: v.id("dailyReports"),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Check for existing report
    const existingReport = await ctx.db
      .query("dailyReports")
      .withIndex("by_store_date", (q) =>
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate)
      )
      .first();

    if (existingReport) {
      // Return existing report, but regenerate the data
      const reportData = await aggregateDailyData(ctx, args.storeId, args.reportDate);

      await ctx.db.patch(existingReport._id, {
        ...reportData,
        generatedAt: Date.now(),
        generatedBy: currentUser._id,
      });

      return existingReport._id;
    }

    // Aggregate data
    const reportData = await aggregateDailyData(ctx, args.storeId, args.reportDate);

    // Create report
    const reportId = await ctx.db.insert("dailyReports", {
      storeId: args.storeId,
      reportDate: args.reportDate,
      ...reportData,
      generatedAt: Date.now(),
      generatedBy: currentUser._id,
      isPrinted: false,
      printedAt: undefined,
    });

    // Also generate product sales breakdown
    await generateProductSalesBreakdown(ctx, args.storeId, args.reportDate);

    return reportId;
  },
});

// Helper: Aggregate daily data from orders
async function aggregateDailyData(
  ctx: { db: any },
  storeId: Id<"stores">,
  reportDate: string
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
  // Parse date range
  const startOfDay = new Date(reportDate).setHours(0, 0, 0, 0);
  const endOfDay = new Date(reportDate).setHours(23, 59, 59, 999);

  // Get all orders for the day
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q
        .eq("storeId", storeId)
        .gte("createdAt", startOfDay)
        .lte("createdAt", endOfDay)
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
  let cashTotal = 0;
  let cardEwalletTotal = 0;

  for (const order of paidOrders) {
    grossSales += order.grossSales;
    vatableSales += order.vatableSales;
    vatAmount += order.vatAmount;
    vatExemptSales += order.vatExemptSales;
    nonVatSales += order.nonVatSales;
    netSales += order.netSales;

    if (order.paymentMethod === "cash") {
      cashTotal += order.netSales;
    } else if (order.paymentMethod === "card_ewallet") {
      cardEwalletTotal += order.netSales;
    }
  }

  // Calculate void amount from voided orders
  let voidAmount = 0;
  let voidCount = voidedOrders.length;

  for (const order of voidedOrders) {
    voidAmount += order.netSales;
  }

  // Also get item-level voids from paid orders
  const orderVoids = await ctx.db.query("orderVoids").collect();
  const dayVoids = orderVoids.filter((v: any) => {
    return v.createdAt >= startOfDay && v.createdAt <= endOfDay;
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
  reportDate: string
): Promise<void> {
  // Parse date range
  const startOfDay = new Date(reportDate).setHours(0, 0, 0, 0);
  const endOfDay = new Date(reportDate).setHours(23, 59, 59, 999);

  // Delete existing product sales for this date
  const existingProductSales = await ctx.db
    .query("dailyProductSales")
    .withIndex("by_store_date", (q: any) =>
      q.eq("storeId", storeId).eq("reportDate", reportDate)
    )
    .collect();

  for (const ps of existingProductSales) {
    await ctx.db.delete(ps._id);
  }

  // Get all orders for the day
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q
        .eq("storeId", storeId)
        .gte("createdAt", startOfDay)
        .lte("createdAt", endOfDay)
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

      if (item.isVoided) {
        // Track voided items
        if (existing) {
          existing.voidedQuantity += item.quantity;
          existing.voidedAmount += item.productPrice * item.quantity;
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
            voidedAmount: item.productPrice * item.quantity,
          });
        }
      } else {
        // Track sold items
        if (existing) {
          existing.quantitySold += item.quantity;
          existing.grossAmount += item.productPrice * item.quantity;
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
            grossAmount: item.productPrice * item.quantity,
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
    v.null()
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
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate)
      )
      .first();

    if (!report) return null;

    // Get generator name
    const generator = await ctx.db.get(report.generatedBy);

    return {
      _id: report._id,
      reportDate: report.reportDate,
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
    })
  ),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Get product sales
    let productSales;
    if (args.categoryId !== undefined) {
      const categoryId = args.categoryId;
      productSales = await ctx.db
        .query("dailyProductSales")
        .withIndex("by_store_date_category", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("reportDate", args.reportDate)
            .eq("categoryId", categoryId)
        )
        .collect();
    } else {
      productSales = await ctx.db
        .query("dailyProductSales")
        .withIndex("by_store_date", (q) =>
          q.eq("storeId", args.storeId).eq("reportDate", args.reportDate)
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
      })
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
      (r) => r.reportDate >= args.startDate && r.reportDate <= args.endDate
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
    })
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
    let stores;
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
            q.eq("storeId", store._id).eq("reportDate", args.reportDate)
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
      })
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
  },
  returns: v.array(
    v.object({
      hour: v.number(),
      transactionCount: v.number(),
      netSales: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Verify authentication using Convex Auth
    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Parse date range
    const startOfDay = new Date(args.reportDate).setHours(0, 0, 0, 0);
    const endOfDay = new Date(args.reportDate).setHours(23, 59, 59, 999);

    // Get all paid orders for the day
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .gte("createdAt", startOfDay)
          .lte("createdAt", endOfDay)
      )
      .collect();

    const paidOrders = orders.filter((o) => o.status === "paid");

    // Aggregate by hour
    const hourlyData = new Map<number, { transactionCount: number; netSales: number }>();

    // Initialize all hours
    for (let h = 0; h < 24; h++) {
      hourlyData.set(h, { transactionCount: 0, netSales: 0 });
    }

    // Aggregate orders
    for (const order of paidOrders) {
      const orderDate = new Date(order.createdAt);
      const hour = orderDate.getHours();
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
    })
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
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate)
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
    })
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
        q.eq("storeId", args.storeId).eq("reportDate", args.reportDate)
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
