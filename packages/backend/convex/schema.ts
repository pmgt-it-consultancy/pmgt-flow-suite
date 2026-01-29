import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Convex Auth tables (authAccounts, authRateLimits, authRefreshTokens, authSessions, authVerificationCodes, authVerifiers)
  ...authTables,

  // Extended users table with custom fields for our POS system
  users: defineTable({
    // Convex Auth required fields
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),

    // Custom POS system fields
    roleId: v.optional(v.id("roles")),
    storeId: v.optional(v.id("stores")),
    pin: v.optional(v.string()), // Manager PIN (bcrypt hashed)
    isActive: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_store", ["storeId"]),

  // Keep notes temporarily for migration
  notes: defineTable({
    userId: v.string(),
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
  }),

  // ===== ROLES =====
  roles: defineTable({
    name: v.string(),
    permissions: v.array(v.string()),
    scopeLevel: v.union(v.literal("system"), v.literal("parent"), v.literal("branch")),
    isSystem: v.boolean(),
  }),

  // ===== STORES =====
  stores: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("stores")),
    logo: v.optional(v.id("_storage")),
    address1: v.string(),
    address2: v.optional(v.string()),
    tin: v.string(),
    min: v.string(),
    vatRate: v.number(),
    printerMac: v.optional(v.string()),
    kitchenPrinterMac: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_parent", ["parentId"])
    .index("by_isActive", ["isActive"]),

  // ===== PRODUCTS =====
  categories: defineTable({
    storeId: v.id("stores"),
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    sortOrder: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_store", ["storeId"])
    .index("by_parent", ["parentId"])
    .index("by_store_parent", ["storeId", "parentId"])
    .index("by_isActive_sortOrder", ["isActive", "sortOrder"]),

  products: defineTable({
    storeId: v.id("stores"),
    name: v.string(),
    categoryId: v.id("categories"),
    price: v.number(),
    isVatable: v.boolean(),
    isActive: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_store", ["storeId"])
    .index("by_category", ["categoryId"])
    .index("by_store_active", ["storeId", "isActive"]),

  // ===== TABLES =====
  tables: defineTable({
    storeId: v.id("stores"),
    name: v.string(),
    capacity: v.optional(v.number()),
    status: v.union(v.literal("available"), v.literal("occupied")),
    currentOrderId: v.optional(v.id("orders")),
    sortOrder: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_store", ["storeId"])
    .index("by_status", ["status"])
    .index("by_store_status", ["storeId", "status"]),

  // ===== ORDERS =====
  orders: defineTable({
    storeId: v.id("stores"),
    orderNumber: v.string(),
    orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
    orderChannel: v.optional(
      v.union(
        v.literal("walk_in_dine_in"),
        v.literal("walk_in_takeout"),
        v.literal("grab"),
        v.literal("foodpanda"),
        v.literal("custom_delivery"),
      ),
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
    tableId: v.optional(v.id("tables")),
    customerName: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("paid"), v.literal("voided")),
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
    createdBy: v.id("users"),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
    paidBy: v.optional(v.id("users")),
  })
    .index("by_store", ["storeId"])
    .index("by_status", ["status"])
    .index("by_store_status", ["storeId", "status"])
    .index("by_createdAt", ["createdAt"])
    .index("by_store_createdAt", ["storeId", "createdAt"])
    .index("by_tableId", ["tableId"]),

  orderItems: defineTable({
    orderId: v.id("orders"),
    productId: v.id("products"),
    productName: v.string(),
    productPrice: v.number(),
    quantity: v.number(),
    notes: v.optional(v.string()),
    isVoided: v.boolean(),
    isSentToKitchen: v.optional(v.boolean()),
    voidedBy: v.optional(v.id("users")),
    voidedAt: v.optional(v.number()),
    voidReason: v.optional(v.string()),
  }).index("by_order", ["orderId"]),

  orderDiscounts: defineTable({
    orderId: v.id("orders"),
    orderItemId: v.optional(v.id("orderItems")),
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
    vatExemptAmount: v.number(),
    approvedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_order", ["orderId"])
    .index("by_orderItem", ["orderItemId"])
    .index("by_type_createdAt", ["discountType", "createdAt"]),

  orderVoids: defineTable({
    orderId: v.id("orders"),
    voidType: v.union(v.literal("full_order"), v.literal("item")),
    orderItemId: v.optional(v.id("orderItems")),
    reason: v.string(),
    approvedBy: v.id("users"),
    requestedBy: v.id("users"),
    amount: v.number(),
    createdAt: v.number(),
  })
    .index("by_order", ["orderId"])
    .index("by_createdAt", ["createdAt"]),

  // ===== AUDIT =====
  auditLogs: defineTable({
    storeId: v.id("stores"),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    details: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_store", ["storeId"])
    .index("by_action", ["action"])
    .index("by_createdAt", ["createdAt"])
    .index("by_entity", ["entityType", "entityId"]),

  // ===== REPORTS =====
  dailyReports: defineTable({
    storeId: v.id("stores"),
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
    generatedBy: v.id("users"),
    isPrinted: v.boolean(),
    printedAt: v.optional(v.number()),
  }).index("by_store_date", ["storeId", "reportDate"]),

  dailyProductSales: defineTable({
    storeId: v.id("stores"),
    reportDate: v.string(),
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
    .index("by_store_date", ["storeId", "reportDate"])
    .index("by_store_date_category", ["storeId", "reportDate", "categoryId"]),

  // ===== SETTINGS =====
  settings: defineTable({
    storeId: v.optional(v.id("stores")),
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  }).index("by_store_key", ["storeId", "key"]),
});
