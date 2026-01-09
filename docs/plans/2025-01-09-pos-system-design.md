# POS System Design

## Overview

A multi-format Point of Sale system for restaurants supporting both dine-in (table service) and takeout operations. The system replaces Clerk authentication with a custom role-based auth system and transforms the existing note-taking app into a full POS solution.

## Platform Architecture

| Component | Web Admin | Android POS |
|-----------|-----------|-------------|
| **Purpose** | Back-office management | Frontline operations |
| **Users** | Super Admin, Admin | Manager, Staff |
| **Key Features** | Store/branch management, Product/category management, User management, Full reporting, Role configuration | Table management, Order taking, Checkout/payment, Receipt printing, Kitchen ticket printing, Daily sales report |

### Tech Stack
- **Web**: Next.js 16 + Tailwind CSS
- **Android**: React Native/Expo
- **Backend**: Convex (shared real-time database)
- **Auth**: Custom username/password (replacing Clerk)
- **Printing**: Bluetooth thermal printer (Android only)

## Key Design Decisions

1. **BIR-compliant** - Philippine tax rules: VAT computation, SC/PWD discounts with VAT exemption
2. **Multi-store** - Parent stores with branches, scoped admin access
3. **Dynamic roles** - 4 defaults (Super Admin, Admin, Manager, Staff), customizable permissions
4. **Prices in cents** - Integer storage to avoid floating point issues (₱150.00 = 15000)
5. **Audit logging** - Full accountability for voids, reprints, discounts
6. **Online-only** - Simpler architecture, requires stable internet connection
7. **Two-level categories** - Category → Subcategory hierarchy

---

## Authentication System

### Users Table
```typescript
users: defineTable({
  username: v.string(),
  passwordHash: v.string(),        // bcrypt hashed
  name: v.string(),
  roleId: v.id("roles"),
  storeId: v.optional(v.id("stores")),  // Scoping: null=all, parent=branches, branch=single
  isActive: v.boolean(),
  pin: v.optional(v.string()),     // Manager PIN for approvals (hashed)
  createdAt: v.number(),
  lastLoginAt: v.optional(v.number()),
})
.index("by_username", ["username"])
.index("by_store", ["storeId"])
```

### Sessions Table
```typescript
sessions: defineTable({
  userId: v.id("users"),
  token: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
})
.index("by_token", ["token"])
.index("by_user", ["userId"])
```

### Roles Table
```typescript
roles: defineTable({
  name: v.string(),
  permissions: v.array(v.string()),
  scopeLevel: v.union(
    v.literal("system"),    // Super Admin - all stores
    v.literal("parent"),    // Admin - parent + branches
    v.literal("branch")     // Manager/Staff - single branch
  ),
  isSystem: v.boolean(),    // Prevents deletion of default roles
})
```

### Default Roles

| Role | Scope Level | Description |
|------|-------------|-------------|
| Super Admin | system | Full system access, all stores |
| Admin | parent | Parent store + all branches |
| Manager | branch | Single branch, can approve voids/discounts |
| Staff | branch | Single branch, basic POS operations |

---

## Store Management

### Stores Table
```typescript
stores: defineTable({
  name: v.string(),
  parentId: v.optional(v.id("stores")),  // null = parent, set = branch
  logo: v.optional(v.id("_storage")),    // Inherits from parent if not set
  address1: v.string(),
  address2: v.optional(v.string()),
  tin: v.string(),                       // Tax ID (BIR)
  min: v.string(),                       // Machine ID (BIR)
  vatRate: v.number(),                   // Default: 12
  printerMac: v.optional(v.string()),
  kitchenPrinterMac: v.optional(v.string()),
  isActive: v.boolean(),
  createdAt: v.number(),
})
.index("by_parent", ["parentId"])
.index("by_isActive", ["isActive"])
```

### Store Hierarchy Example
```
ABC Restaurant (parentId: null)          ← Parent Store
├── ABC - SM Mall Branch (parentId: abc_id)
├── ABC - Ayala Branch (parentId: abc_id)
└── ABC - BGC Branch (parentId: abc_id)
```

### Logo Inheritance
- Branches inherit parent logo by default
- Can optionally upload their own to override

---

## Product Catalog

### Categories Table (Two-Level Hierarchy)
```typescript
categories: defineTable({
  storeId: v.id("stores"),
  name: v.string(),
  parentId: v.optional(v.id("categories")),  // null = category, set = subcategory
  sortOrder: v.number(),
  isActive: v.boolean(),
  createdAt: v.number(),
})
.index("by_store", ["storeId"])
.index("by_parent", ["parentId"])
.index("by_isActive_sortOrder", ["isActive", "sortOrder"])
```

### Products Table
```typescript
products: defineTable({
  storeId: v.id("stores"),
  name: v.string(),
  categoryId: v.id("categories"),   // Must be subcategory (leaf level)
  price: v.number(),                // In cents
  isVatable: v.boolean(),
  isActive: v.boolean(),
  sortOrder: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
.index("by_store", ["storeId"])
.index("by_category", ["categoryId"])
.index("by_isActive_sortOrder", ["isActive", "sortOrder"])
```

---

## Table Management

### Tables Table
```typescript
tables: defineTable({
  storeId: v.id("stores"),
  name: v.string(),                  // "Table 1", "Bar 1", "Patio A"
  capacity: v.optional(v.number()),
  status: v.union(v.literal("available"), v.literal("occupied")),
  currentOrderId: v.optional(v.id("orders")),
  sortOrder: v.number(),
  isActive: v.boolean(),
  createdAt: v.number(),
})
.index("by_store", ["storeId"])
.index("by_status", ["status"])
.index("by_sortOrder", ["sortOrder"])
```

---

## Orders (BIR-Compliant)

### Orders Table
```typescript
orders: defineTable({
  storeId: v.id("stores"),
  orderNumber: v.string(),           // Daily sequential: "001", "002"
  orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
  tableId: v.optional(v.id("tables")),
  customerName: v.optional(v.string()),
  status: v.union(v.literal("open"), v.literal("paid"), v.literal("voided")),
  
  // BIR-compliant tax breakdown (all in cents)
  grossSales: v.number(),
  vatableSales: v.number(),
  vatAmount: v.number(),
  vatExemptSales: v.number(),
  nonVatSales: v.number(),
  discountAmount: v.number(),
  netSales: v.number(),
  
  // Payment
  paymentMethod: v.optional(v.union(v.literal("cash"), v.literal("card_ewallet"))),
  cashReceived: v.optional(v.number()),
  changeGiven: v.optional(v.number()),
  
  // Audit
  createdBy: v.id("users"),
  createdAt: v.number(),
  paidAt: v.optional(v.number()),
  paidBy: v.optional(v.id("users")),
})
.index("by_store", ["storeId"])
.index("by_status", ["status"])
.index("by_createdAt", ["createdAt"])
.index("by_tableId", ["tableId"])
```

### Order Items Table
```typescript
orderItems: defineTable({
  orderId: v.id("orders"),
  productId: v.id("products"),
  productName: v.string(),           // Snapshot at time of order
  productPrice: v.number(),          // Snapshot at time of order
  quantity: v.number(),
  notes: v.optional(v.string()),     // "less ice", "no onions"
  isVoided: v.boolean(),
  voidedBy: v.optional(v.id("users")),
  voidedAt: v.optional(v.number()),
  voidReason: v.optional(v.string()),
})
.index("by_order", ["orderId"])
```

---

## Discounts (BIR-Compliant SC/PWD)

### Order Discounts Table
```typescript
orderDiscounts: defineTable({
  orderId: v.id("orders"),
  orderItemId: v.optional(v.id("orderItems")),  // null = order-level, set = item-level
  discountType: v.union(
    v.literal("senior_citizen"),
    v.literal("pwd"),
    v.literal("promo"),
    v.literal("manual")
  ),
  customerName: v.string(),
  customerId: v.string(),            // SC/PWD ID number
  quantityApplied: v.number(),
  discountAmount: v.number(),        // In cents
  vatExemptAmount: v.number(),       // VAT removed (for SC/PWD)
  approvedBy: v.id("users"),         // Manager who approved
  createdAt: v.number(),
})
.index("by_order", ["orderId"])
.index("by_orderItem", ["orderItemId"])
.index("by_type_createdAt", ["discountType", "createdAt"])
```

### SC/PWD Discount Computation (Philippine BIR Rules)
```typescript
// VAT-inclusive pricing: remove VAT first, then apply 20% discount
// SC/PWD sales are VAT-EXEMPT, not just discounted

const vatExclusive = price / 1.12;           // Remove 12% VAT
const scPwdPrice = vatExclusive * 0.80;      // Apply 20% discount
const discountAmount = vatExclusive * 0.20;  // Discount portion
const vatExemptSales = vatExclusive;         // Full amount is VAT-exempt
```

### Mixed Group Example
4 diners, 2 are Senior Citizens:
- 2x Chicken Sandwich @ ₱250 each
  - 1x SC discount → ₱178.57
  - 1x regular → ₱250.00

---

## Voids & Audit Logging

### Order Voids Table
```typescript
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
.index("by_createdAt", ["createdAt"])
```

### Audit Logs Table
```typescript
auditLogs: defineTable({
  storeId: v.id("stores"),
  action: v.string(),
  entityType: v.string(),
  entityId: v.string(),
  details: v.string(),               // JSON stringified
  userId: v.id("users"),
  createdAt: v.number(),
})
.index("by_store", ["storeId"])
.index("by_action", ["action"])
.index("by_createdAt", ["createdAt"])
.index("by_entity", ["entityType", "entityId"])
```

### Tracked Actions
- `receipt_reprint` - order ID, reprint count
- `void_order` - order ID, reason, amount
- `void_item` - item ID, reason, amount
- `discount_applied` - discount type, customer ID
- `user_login` / `user_logout`
- `settings_changed` - before/after values

---

## Daily Reports

### Daily Reports Table
```typescript
dailyReports: defineTable({
  storeId: v.id("stores"),
  reportDate: v.string(),            // "2025-01-09"
  
  // Sales breakdown
  grossSales: v.number(),
  vatableSales: v.number(),
  vatAmount: v.number(),
  vatExemptSales: v.number(),
  nonVatSales: v.number(),
  netSales: v.number(),
  
  // Discounts breakdown
  seniorDiscounts: v.number(),
  pwdDiscounts: v.number(),
  promoDiscounts: v.number(),
  manualDiscounts: v.number(),
  totalDiscounts: v.number(),
  
  // Voids
  voidCount: v.number(),
  voidAmount: v.number(),
  
  // Payment breakdown
  cashTotal: v.number(),
  cardEwalletTotal: v.number(),
  
  // Metrics
  transactionCount: v.number(),
  averageTicket: v.number(),
  
  // Metadata
  generatedAt: v.number(),
  generatedBy: v.id("users"),
  isPrinted: v.boolean(),
  printedAt: v.optional(v.number()),
})
.index("by_store_date", ["storeId", "reportDate"])
```

### Daily Product Sales Table
```typescript
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
.index("by_store_date_category", ["storeId", "reportDate", "categoryId"])
```

### Report Display
- **Printed EOD**: Compact summary (no product breakdown to save paper)
- **Screen View**: Full product breakdown grouped by category (Web Admin + Android POS)

---

## Settings

### Settings Table
```typescript
settings: defineTable({
  storeId: v.optional(v.id("stores")),  // null = system-wide
  key: v.string(),
  value: v.string(),                     // JSON stringified
  updatedAt: v.number(),
  updatedBy: v.id("users"),
})
.index("by_store_key", ["storeId", "key"])
```

---

## Permissions

### Permission Keys
```typescript
const PERMISSIONS = {
  // Orders
  "orders.create": "Create new orders",
  "orders.view": "View orders",
  "orders.edit": "Edit open orders",
  "orders.void_item": "Void individual items",
  "orders.void_order": "Void entire order",
  "orders.approve_void": "Approve void requests",
  
  // Checkout
  "checkout.process": "Process payments",
  "checkout.reprint": "Reprint receipts",
  
  // Discounts
  "discounts.apply": "Apply any discount",
  "discounts.approve": "Approve discount requests",
  
  // Tables
  "tables.view": "View table status",
  "tables.manage": "Add/edit/disable tables",
  
  // Products
  "products.view": "View products",
  "products.manage": "Add/edit/disable products",
  "categories.manage": "Add/edit/disable categories",
  
  // Reports
  "reports.daily": "View daily sales report",
  "reports.print_eod": "Print end-of-day report",
  "reports.all_dates": "View reports for any date",
  "reports.branch_summary": "View all branches summary",
  
  // Users
  "users.view": "View users in scope",
  "users.manage": "Add/edit/disable users in scope",
  
  // Stores
  "stores.view": "View store settings",
  "stores.manage": "Edit store settings",
  "stores.create_branch": "Create new branches",
  
  // System
  "system.settings": "Manage system-wide settings",
  "system.roles": "Manage roles and permissions",
};
```

### Default Role Permissions

| Permission | Staff | Manager | Admin | Super Admin |
|------------|:-----:|:-------:|:-----:|:-----------:|
| orders.create | ✓ | ✓ | ✓ | ✓ |
| orders.view | ✓ | ✓ | ✓ | ✓ |
| orders.edit | ✓ | ✓ | ✓ | ✓ |
| orders.void_item | ✓* | ✓ | ✓ | ✓ |
| orders.void_order | ✓* | ✓ | ✓ | ✓ |
| orders.approve_void | | ✓ | ✓ | ✓ |
| checkout.process | ✓ | ✓ | ✓ | ✓ |
| checkout.reprint | ✓ | ✓ | ✓ | ✓ |
| discounts.apply | ✓* | ✓ | ✓ | ✓ |
| discounts.approve | | ✓ | ✓ | ✓ |
| tables.view | ✓ | ✓ | ✓ | ✓ |
| tables.manage | | ✓ | ✓ | ✓ |
| products.view | ✓ | ✓ | ✓ | ✓ |
| products.manage | | | ✓ | ✓ |
| categories.manage | | | ✓ | ✓ |
| reports.daily | | ✓ | ✓ | ✓ |
| reports.print_eod | | ✓ | ✓ | ✓ |
| reports.all_dates | | | ✓ | ✓ |
| reports.branch_summary | | | ✓ | ✓ |
| users.view | | ✓ | ✓ | ✓ |
| users.manage | | | ✓ | ✓ |
| stores.view | | ✓ | ✓ | ✓ |
| stores.manage | | | ✓ | ✓ |
| stores.create_branch | | | | ✓ |
| system.settings | | | | ✓ |
| system.roles | | | | ✓ |

*✓\* = can request, needs Manager+ approval*

---

## Receipt Formats

### Customer Receipt
```
================================
       [STORE LOGO]
       [STORE NAME]
    [Store Address Line 1]
    [Store Address Line 2]
   TIN: XXX-XXX-XXX-XXX
   MIN: XXXXXXXXXXXXXX
================================
Official Receipt
--------------------------------
Date: 01/09/2025  Time: 14:32
Receipt #: 0045
Cashier: Juan
Table: 5 / Dine-in
--------------------------------
Qty  Item               Amount
--------------------------------
  2  Americano       ₱   240.00
  1  Latte           ₱   150.00
  1  Chicken Sandwich₱   250.00
     - no onions
--------------------------------
Subtotal:            ₱   640.00

SC Discount (20%):   ₱   114.29
  Name: Maria Santos
  ID: 12345678

VAT-Exempt Sales:    ₱   571.43
VATable Sales:       ₱     0.00
VAT (12%):           ₱     0.00
--------------------------------
TOTAL:               ₱   525.71
CASH:                ₱   600.00
CHANGE:              ₱    74.29
================================
This serves as your
OFFICIAL RECEIPT
================================
```

### Reprint Header
```
================================
        *** REPRINT ***
     Original: 01/09/2025
     Reprinted: 01/09/2025
================================
```

### Kitchen Ticket
```
================================
     ** KITCHEN ORDER **
--------------------------------
Order: #0045  Table: 5
Time: 14:32
--------------------------------
  2x Americano
  1x Latte
  1x Chicken Sandwich
     >>> no onions <<<
--------------------------------
```

### EOD Report (Printed - Compact)
```
================================
       [STORE NAME]
     DAILY SALES REPORT
      January 9, 2025
================================
Gross Sales:         ₱ 15,000.00
Less: Discounts      ₱  1,200.00
  Senior Citizen     ₱    800.00
  PWD                ₱    400.00
Net Sales:           ₱ 13,800.00
--------------------------------
VATable Sales:       ₱ 10,000.00
VAT (12%):           ₱  1,200.00
VAT-Exempt Sales:    ₱  3,800.00
Non-VAT Sales:       ₱      0.00
--------------------------------
Voids: 2             ₱    350.00
--------------------------------
Cash:                ₱ 10,000.00
Card/E-wallet:       ₱  3,800.00
--------------------------------
Transactions: 45
Average Ticket:      ₱    306.67
================================
       Items: 51 (see app)
================================
```

---

## Data Flow Diagram

```
┌─────────────────┐     ┌─────────────────┐
│   Web Admin     │     │   Android POS   │
│  (Next.js 16)   │     │  (React Native) │
│                 │     │                 │
│ • Store mgmt    │     │ • Take orders   │
│ • Products      │     │ • Checkout      │
│ • Users         │     │ • Print receipt │
│ • Full reports  │     │ • Daily report  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │   Convex    │
              │  (Backend)  │
              │             │
              │ • Auth      │
              │ • Database  │
              │ • Real-time │
              │ • Files     │
              └─────────────┘
                     │
              ┌──────▼──────┐
              │  Bluetooth  │
              │   Printer   │
              │ (Android)   │
              └─────────────┘
```

---

## Implementation Notes

### Removing Clerk
1. Remove `@clerk/nextjs` and `@clerk/clerk-expo` packages
2. Remove Clerk middleware from `apps/web/src/middleware.ts`
3. Remove `auth.config.js` Clerk configuration
4. Implement custom auth functions in Convex
5. Update `ConvexClientProvider` to use custom auth

### Migration Path
1. Create new schema tables (keep `notes` table temporarily)
2. Implement auth system first
3. Build core POS features
4. Remove notes functionality when POS is stable

### BIR Compliance References
- [BIR RR 7-2010](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/55830) - Senior Citizen discounts
- [BIR RR 5-2017](https://ncda.gov.ph/disability-laws/implementing-rules-and-regulations-irr/revenue-regulations-no-5-2017-rules-and-regulations-implementing-republic-act-no-10754/) - PWD discounts
- SC/PWD sales are VAT-EXEMPT (not just discounted)
- Must track and report VAT-exempt sales separately
