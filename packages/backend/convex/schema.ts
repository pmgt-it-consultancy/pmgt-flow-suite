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

    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_store", ["storeId"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

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
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_name", ["name"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_clientId", ["clientId"]),

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
    contactNumber: v.optional(v.string()),
    telephone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    socials: v.optional(v.array(v.object({ platform: v.string(), url: v.string() }))),
    footer: v.optional(v.string()),
    schedule: v.optional(
      v.object({
        monday: v.object({ open: v.string(), close: v.string() }),
        tuesday: v.object({ open: v.string(), close: v.string() }),
        wednesday: v.object({ open: v.string(), close: v.string() }),
        thursday: v.object({ open: v.string(), close: v.string() }),
        friday: v.object({ open: v.string(), close: v.string() }),
        saturday: v.object({ open: v.string(), close: v.string() }),
        sunday: v.object({ open: v.string(), close: v.string() }),
      }),
    ),
    isActive: v.boolean(),
    createdAt: v.number(),
    // Monotonic counter for assigning device codes (A, B, ..., Z, AA, AB, ...).
    // Never decremented; codes are never reused — preserves audit trail.
    deviceCodeCounter: v.optional(v.number()),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_parent", ["parentId"])
    .index("by_isActive", ["isActive"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_clientId", ["clientId"]),

  // ===== PRODUCTS =====
  categories: defineTable({
    storeId: v.id("stores"),
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    sortOrder: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_store", ["storeId"])
    .index("by_parent", ["parentId"])
    .index("by_store_parent", ["storeId", "parentId"])
    .index("by_isActive_sortOrder", ["isActive", "sortOrder"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  products: defineTable({
    storeId: v.id("stores"),
    name: v.string(),
    categoryId: v.id("categories"),
    price: v.number(),
    isVatable: v.boolean(),
    isActive: v.boolean(),
    isOpenPrice: v.optional(v.boolean()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Sync infrastructure
    clientId: v.optional(v.string()),
  })
    .index("by_store", ["storeId"])
    .index("by_category", ["categoryId"])
    .index("by_store_active", ["storeId", "isActive"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  // ===== MODIFIERS =====
  modifierGroups: defineTable({
    storeId: v.id("stores"),
    name: v.string(),
    selectionType: v.union(v.literal("single"), v.literal("multi")),
    minSelections: v.number(), // 0 = optional, 1+ = required
    maxSelections: v.optional(v.number()), // null/undefined = unlimited
    sortOrder: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_store", ["storeId"])
    .index("by_store_active", ["storeId", "isActive"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  modifierOptions: defineTable({
    modifierGroupId: v.id("modifierGroups"),
    // Denormalized from modifierGroup for sync filtering
    storeId: v.optional(v.id("stores")),
    name: v.string(),
    priceAdjustment: v.number(), // can be 0
    isDefault: v.boolean(),
    isAvailable: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_group", ["modifierGroupId"])
    .index("by_group_available", ["modifierGroupId", "isAvailable"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  // Join table: assigns modifier groups to products or categories
  modifierGroupAssignments: defineTable({
    storeId: v.id("stores"),
    modifierGroupId: v.id("modifierGroups"),
    // Exactly one of these should be set
    productId: v.optional(v.id("products")),
    categoryId: v.optional(v.id("categories")),
    sortOrder: v.number(), // display order of this group on the product/category
    // Optional overrides (if not set, use group defaults)
    minSelectionsOverride: v.optional(v.number()),
    maxSelectionsOverride: v.optional(v.number()),
    createdAt: v.number(),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_product", ["productId"])
    .index("by_category", ["categoryId"])
    .index("by_modifierGroup", ["modifierGroupId"])
    .index("by_store", ["storeId"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

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
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_store", ["storeId"])
    .index("by_status", ["status"])
    .index("by_store_status", ["storeId", "status"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  // ===== ORDERS =====
  orders: defineTable({
    storeId: v.id("stores"),
    orderNumber: v.optional(v.string()),
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
    draftLabel: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("voided")),
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
    orderCategory: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
    tableMarker: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
    paidBy: v.optional(v.id("users")),
    pax: v.optional(v.number()),
    // Multi-tab support: multiple orders per table
    tabNumber: v.optional(v.number()), // Auto-assigned: 1, 2, 3... per table
    tabName: v.optional(v.string()), // Default "Tab 1", editable to guest name
    requestId: v.optional(v.string()), // Idempotency key to prevent duplicate orders
    refundedFromOrderId: v.optional(v.id("orders")),
    // NEW: denormalized for fast listActive (Task 15-18 maintenance + Task 17 backfill)
    tableName: v.optional(v.string()),
    itemCount: v.optional(v.number()),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
    originDeviceId: v.optional(v.string()), // Tracks which tablet created the order; used for "origin tablet wins" conflict rule
  })
    .index("by_store", ["storeId"])
    .index("by_status", ["status"])
    .index("by_store_status", ["storeId", "status"])
    .index("by_createdAt", ["createdAt"])
    .index("by_store_createdAt", ["storeId", "createdAt"])
    .index("by_tableId", ["tableId"])
    .index("by_tableId_status", ["tableId", "status"])
    .index("by_requestId", ["requestId"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  orderItems: defineTable({
    orderId: v.id("orders"),
    // Denormalized from order for sync filtering
    storeId: v.optional(v.id("stores")),
    productId: v.id("products"),
    productName: v.string(),
    productPrice: v.number(),
    quantity: v.number(),
    notes: v.optional(v.string()),
    serviceType: v.optional(v.union(v.literal("dine_in"), v.literal("takeout"))),
    isVoided: v.boolean(),
    isSentToKitchen: v.optional(v.boolean()),
    voidedBy: v.optional(v.id("users")),
    voidedAt: v.optional(v.number()),
    voidReason: v.optional(v.string()),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_order", ["orderId"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  orderItemModifiers: defineTable({
    orderItemId: v.id("orderItems"),
    // Denormalized from orderItem for sync filtering
    storeId: v.optional(v.id("stores")),
    modifierGroupName: v.string(), // snapshot
    modifierOptionName: v.string(), // snapshot
    priceAdjustment: v.number(), // snapshot at order time
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_orderItem", ["orderItemId"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  orderDiscounts: defineTable({
    orderId: v.id("orders"),
    // Denormalized from order for sync filtering
    storeId: v.optional(v.id("stores")),
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
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_order", ["orderId"])
    .index("by_orderItem", ["orderItemId"])
    .index("by_type_createdAt", ["discountType", "createdAt"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  orderVoids: defineTable({
    orderId: v.id("orders"),
    // Denormalized from order for sync filtering
    storeId: v.optional(v.id("stores")),
    voidType: v.union(v.literal("full_order"), v.literal("item"), v.literal("refund")),
    orderItemId: v.optional(v.id("orderItems")),
    reason: v.string(),
    approvedBy: v.id("users"),
    requestedBy: v.id("users"),
    amount: v.number(),
    createdAt: v.number(),
    refundMethod: v.optional(v.union(v.literal("cash"), v.literal("card_ewallet"))),
    replacementOrderId: v.optional(v.id("orders")),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_order", ["orderId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  // ===== AUDIT =====
  auditLogs: defineTable({
    storeId: v.id("stores"),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    details: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
    // Sync infrastructure (push-only, no pull)
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_store", ["storeId"])
    .index("by_action", ["action"])
    .index("by_createdAt", ["createdAt"])
    .index("by_entity", ["entityType", "entityId"])
    .index("by_clientId", ["clientId"]),

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
    startTime: v.optional(v.string()), // "HH:mm" in PHT, e.g. "06:00"
    endTime: v.optional(v.string()), // "HH:mm" in PHT, e.g. "22:00"
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

  dailyPaymentTransactions: defineTable({
    storeId: v.id("stores"),
    reportDate: v.string(),
    orderId: v.id("orders"),
    orderNumber: v.string(),
    paymentType: v.string(),
    referenceNumber: v.string(),
    amount: v.number(),
    paidAt: v.number(),
  }).index("by_store_date", ["storeId", "reportDate"]),

  // ===== SETTINGS =====
  settings: defineTable({
    storeId: v.optional(v.id("stores")),
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
    // Sync infrastructure
    clientId: v.optional(v.string()),
  })
    .index("by_store_key", ["storeId", "key"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  // ===== APP CONFIG =====
  appConfig: defineTable({
    key: v.string(),
    value: v.string(),
    storeId: v.optional(v.id("stores")),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_key", ["key"])
    .index("by_store_key", ["storeId", "key"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  // ===== ORDER PAYMENTS =====
  orderPayments: defineTable({
    orderId: v.id("orders"),
    storeId: v.id("stores"),
    paymentMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
    amount: v.number(),
    cashReceived: v.optional(v.number()),
    changeGiven: v.optional(v.number()),
    cardPaymentType: v.optional(v.string()),
    cardReferenceNumber: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.id("users"),
    // Sync infrastructure
    updatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_order", ["orderId"])
    .index("by_store", ["storeId"])
    .index("by_store_and_method", ["storeId", "paymentMethod"])
    .index("by_store_updatedAt", ["storeId", "updatedAt"])
    .index("by_clientId", ["clientId"]),

  // ===== SYNC INFRASTRUCTURE =====

  // Idempotency cache for /sync/push retries.
  // Cleaned daily by syncMaintenance.cleanupSyncedMutations cron (TTL 7 days).
  syncedMutations: defineTable({
    clientMutationId: v.string(),
    storeId: v.id("stores"),
    response: v.string(), // JSON-stringified push response
    createdAt: v.number(),
  })
    .index("by_clientMutationId", ["clientMutationId"])
    .index("by_createdAt", ["createdAt"]),

  // Devices registered to a store. deviceCode is assigned monotonically
  // from stores.deviceCodeCounter (Excel-style: A, B, ..., Z, AA, AB, ...).
  // Codes are never reused, even after a device retires.
  syncDevices: defineTable({
    deviceId: v.string(), // UUID generated on first install (stored in tablet's SecureStore)
    storeId: v.id("stores"),
    deviceCode: v.string(), // "A", "B", ..., "Z", "AA", "AB", ...
    registeredAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_storeId_deviceCode", ["storeId", "deviceCode"])
    .index("by_deviceId", ["deviceId"]),
});
