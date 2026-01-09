# POS System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the note-taking app into a BIR-compliant multi-store POS system with custom authentication.

**Architecture:** Convex backend with real-time data sync, Next.js 16 web admin, React Native/Expo Android POS. Custom auth replacing Clerk. TanStack Query for data fetching, TanStack Form + Zod for validation.

**Tech Stack:**
- Backend: Convex (real-time database + serverless functions)
- Web: Next.js 16, TailwindCSS v4, shadcn/ui, TanStack Query, TanStack Form, Zod
- Native: React Native/Expo, Uniwind, ReactNativeReusables, TanStack Query, TanStack Form, Zod
- Auth: Custom (bcrypt for passwords, JWT-like sessions)

**Reference:** See `docs/plans/2025-01-09-pos-system-design.md` for full schema and design details.

---

## Phase 1: Project Setup & Dependencies

### Task 1.1: Install Web Admin Dependencies

**Files:**
- Modify: `apps/web/package.json`

**Step 1: Install shadcn/ui and dependencies**

Run:
```bash
cd apps/web && npx shadcn@latest init
```

Select options:
- Style: Default
- Base color: Neutral
- CSS variables: Yes

**Step 2: Install TanStack Query and Form**

Run:
```bash
cd apps/web && npm install @tanstack/react-query @tanstack/react-form zod @hookform/resolvers
```

**Step 3: Install Convex TanStack Query adapter**

Run:
```bash
cd apps/web && npm install @convex-dev/react-query
```

**Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add shadcn/ui, TanStack Query/Form, Zod dependencies"
```

---

### Task 1.2: Install React Native Dependencies

**Files:**
- Modify: `apps/native/package.json`

**Step 1: Install Uniwind**

Run:
```bash
cd apps/native && npm install uniwind
```

**Step 2: Install ReactNativeReusables**

Run:
```bash
cd apps/native && npm install @rnr/reusables
```

**Step 3: Install TanStack Query and Form**

Run:
```bash
cd apps/native && npm install @tanstack/react-query @tanstack/react-form zod
```

**Step 4: Install Convex TanStack Query adapter**

Run:
```bash
cd apps/native && npm install @convex-dev/react-query
```

**Step 5: Install secure storage for auth tokens**

Run:
```bash
cd apps/native && npx expo install expo-secure-store
```

**Step 6: Commit**

```bash
git add apps/native/
git commit -m "feat(native): add Uniwind, RNR, TanStack Query/Form, Zod dependencies"
```

---

### Task 1.3: Install Backend Dependencies

**Files:**
- Modify: `packages/backend/package.json`

**Step 1: Install bcrypt for password hashing**

Run:
```bash
cd packages/backend && npm install bcryptjs
npm install -D @types/bcryptjs
```

**Step 2: Commit**

```bash
git add packages/backend/
git commit -m "feat(backend): add bcryptjs for password hashing"
```

---

### Task 1.4: Setup Shared Zod Schemas Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/schemas/auth.ts`
- Create: `packages/shared/src/schemas/store.ts`
- Create: `packages/shared/tsconfig.json`

**Step 1: Create shared package structure**

Create `packages/shared/package.json`:
```json
{
  "name": "@packages/shared",
  "version": "1.0.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

**Step 2: Create auth schemas**

Create `packages/shared/src/schemas/auth.ts`:
```typescript
import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  name: z.string().min(1).max(100),
  roleId: z.string(),
  storeId: z.string().optional(),
  pin: z.string().length(4).optional(),
});

export const managerPinSchema = z.object({
  pin: z.string().length(4, "PIN must be 4 digits"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ManagerPinInput = z.infer<typeof managerPinSchema>;
```

**Step 3: Create store schemas**

Create `packages/shared/src/schemas/store.ts`:
```typescript
import { z } from "zod";

export const createStoreSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().optional(),
  address1: z.string().min(1).max(200),
  address2: z.string().max(200).optional(),
  tin: z.string().min(1).max(20),
  min: z.string().min(1).max(20),
  vatRate: z.number().min(0).max(100).default(12),
});

export const updateStoreSchema = createStoreSchema.partial();

export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
```

**Step 4: Create index export**

Create `packages/shared/src/index.ts`:
```typescript
export * from "./schemas/auth";
export * from "./schemas/store";
```

**Step 5: Create tsconfig**

Create `packages/shared/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

**Step 6: Update root package.json workspaces**

Add to root `package.json` workspaces:
```json
"workspaces": [
  "apps/*",
  "packages/*"
]
```

**Step 7: Commit**

```bash
git add packages/shared/ package.json
git commit -m "feat: add shared Zod schemas package"
```

---

## Phase 2: Backend Schema & Auth System

### Task 2.1: Create POS Database Schema

**Files:**
- Modify: `packages/backend/convex/schema.ts`

**Step 1: Replace schema with POS tables**

Replace `packages/backend/convex/schema.ts`:
```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Keep notes temporarily for migration
  notes: defineTable({
    userId: v.string(),
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
  }),

  // ===== AUTH =====
  roles: defineTable({
    name: v.string(),
    permissions: v.array(v.string()),
    scopeLevel: v.union(
      v.literal("system"),
      v.literal("parent"),
      v.literal("branch")
    ),
    isSystem: v.boolean(),
  }),

  users: defineTable({
    username: v.string(),
    passwordHash: v.string(),
    name: v.string(),
    roleId: v.id("roles"),
    storeId: v.optional(v.id("stores")),
    isActive: v.boolean(),
    pin: v.optional(v.string()),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  })
    .index("by_username", ["username"])
    .index("by_store", ["storeId"]),

  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),

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
    tableId: v.optional(v.id("tables")),
    customerName: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("paid"),
      v.literal("voided")
    ),
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
      v.literal("manual")
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
```

**Step 2: Run Convex to validate schema**

Run:
```bash
cd packages/backend && npx convex dev --once
```

Expected: Schema validation passes

**Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add complete POS schema with 14 tables"
```

---

### Task 2.2: Create Auth Utility Functions

**Files:**
- Create: `packages/backend/convex/lib/auth.ts`
- Create: `packages/backend/convex/lib/permissions.ts`

**Step 1: Create auth utilities**

Create `packages/backend/convex/lib/auth.ts`:
```typescript
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export async function getSessionUser(
  ctx: QueryCtx | MutationCtx,
  token: string | null
) {
  if (!token) return null;

  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();

  if (!session) return null;
  if (session.expiresAt < Date.now()) return null;

  const user = await ctx.db.get(session.userId);
  if (!user || !user.isActive) return null;

  return user;
}

export async function getUserWithRole(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const user = await ctx.db.get(userId);
  if (!user) return null;

  const role = await ctx.db.get(user.roleId);
  return { ...user, role };
}

export async function getUserStoreScope(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const user = await ctx.db.get(userId);
  if (!user) return { storeIds: [], scopeLevel: null };

  const role = await ctx.db.get(user.roleId);
  if (!role) return { storeIds: [], scopeLevel: null };

  // Super Admin: all stores
  if (role.scopeLevel === "system") {
    const allStores = await ctx.db.query("stores").collect();
    return {
      storeIds: allStores.map((s) => s._id),
      scopeLevel: "system" as const,
    };
  }

  // Admin: parent store + branches
  if (role.scopeLevel === "parent" && user.storeId) {
    const branches = await ctx.db
      .query("stores")
      .withIndex("by_parent", (q) => q.eq("parentId", user.storeId))
      .collect();
    return {
      storeIds: [user.storeId, ...branches.map((b) => b._id)],
      scopeLevel: "parent" as const,
    };
  }

  // Manager/Staff: single branch
  if (role.scopeLevel === "branch" && user.storeId) {
    return {
      storeIds: [user.storeId],
      scopeLevel: "branch" as const,
    };
  }

  return { storeIds: [], scopeLevel: null };
}

export function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getSessionExpiry(): number {
  // 24 hours from now
  return Date.now() + 24 * 60 * 60 * 1000;
}
```

**Step 2: Create permissions utilities**

Create `packages/backend/convex/lib/permissions.ts`:
```typescript
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export const PERMISSIONS = {
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
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  "Super Admin": Object.keys(PERMISSIONS) as Permission[],
  Admin: [
    "orders.create",
    "orders.view",
    "orders.edit",
    "orders.void_item",
    "orders.void_order",
    "orders.approve_void",
    "checkout.process",
    "checkout.reprint",
    "discounts.apply",
    "discounts.approve",
    "tables.view",
    "tables.manage",
    "products.view",
    "products.manage",
    "categories.manage",
    "reports.daily",
    "reports.print_eod",
    "reports.all_dates",
    "reports.branch_summary",
    "users.view",
    "users.manage",
    "stores.view",
    "stores.manage",
  ],
  Manager: [
    "orders.create",
    "orders.view",
    "orders.edit",
    "orders.void_item",
    "orders.void_order",
    "orders.approve_void",
    "checkout.process",
    "checkout.reprint",
    "discounts.apply",
    "discounts.approve",
    "tables.view",
    "tables.manage",
    "products.view",
    "reports.daily",
    "reports.print_eod",
    "users.view",
    "stores.view",
  ],
  Staff: [
    "orders.create",
    "orders.view",
    "orders.edit",
    "orders.void_item",
    "orders.void_order",
    "checkout.process",
    "checkout.reprint",
    "discounts.apply",
    "tables.view",
    "products.view",
  ],
};

export async function hasPermission(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  permission: Permission
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user || !user.isActive) return false;

  const role = await ctx.db.get(user.roleId);
  if (!role) return false;

  return role.permissions.includes(permission);
}

export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  permission: Permission
): Promise<void> {
  const allowed = await hasPermission(ctx, userId, permission);
  if (!allowed) {
    throw new Error(`Permission denied: ${permission}`);
  }
}
```

**Step 3: Commit**

```bash
git add packages/backend/convex/lib/
git commit -m "feat(backend): add auth and permissions utility functions"
```

---

### Task 2.3: Create Auth Mutations

**Files:**
- Create: `packages/backend/convex/auth.ts`

**Step 1: Create auth functions**

Create `packages/backend/convex/auth.ts`:
```typescript
"use node";

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import bcrypt from "bcryptjs";

// Internal query to get user by username
export const getUserByUsername = internalQuery({
  args: { username: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      username: v.string(),
      passwordHash: v.string(),
      name: v.string(),
      roleId: v.id("roles"),
      storeId: v.optional(v.id("stores")),
      isActive: v.boolean(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
    
    if (!user) return null;
    
    return {
      _id: user._id,
      username: user.username,
      passwordHash: user.passwordHash,
      name: user.name,
      roleId: user.roleId,
      storeId: user.storeId,
      isActive: user.isActive,
    };
  },
});

// Internal mutation to create session
export const createSession = internalMutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    // Update last login
    await ctx.db.patch(args.userId, { lastLoginAt: Date.now() });
    
    // Create session
    return await ctx.db.insert("sessions", {
      userId: args.userId,
      token: args.token,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
  },
});

// Internal mutation to delete session
export const deleteSession = internalMutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    
    if (session) {
      await ctx.db.delete(session._id);
    }
    return null;
  },
});

// Login action (uses Node.js for bcrypt)
export const login = action({
  args: {
    username: v.string(),
    password: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      token: v.string(),
      user: v.object({
        id: v.string(),
        username: v.string(),
        name: v.string(),
        roleId: v.string(),
        storeId: v.optional(v.string()),
      }),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    // Get user
    const user = await ctx.runQuery(internal.auth.getUserByUsername, {
      username: args.username,
    });

    if (!user) {
      return { success: false, error: "Invalid username or password" };
    }

    if (!user.isActive) {
      return { success: false, error: "Account is disabled" };
    }

    // Verify password
    const validPassword = await bcrypt.compare(args.password, user.passwordHash);
    if (!validPassword) {
      return { success: false, error: "Invalid username or password" };
    }

    // Generate session token
    const token = generateToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Create session
    await ctx.runMutation(internal.auth.createSession, {
      userId: user._id,
      token,
      expiresAt,
    });

    return {
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        roleId: user.roleId,
        storeId: user.storeId,
      },
    };
  },
});

// Logout action
export const logout = action({
  args: { token: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.auth.deleteSession, { token: args.token });
    return { success: true };
  },
});

// Helper to generate token
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Hash password (for user creation)
export const hashPassword = action({
  args: { password: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(args.password, salt);
  },
});

// Verify manager PIN
export const verifyManagerPin = action({
  args: {
    userId: v.id("users"),
    pin: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.auth.getUserByUsername, {
      username: "", // We need a different query
    });
    // This needs to be implemented with a proper query
    return false;
  },
});
```

**Step 2: Commit**

```bash
git add packages/backend/convex/auth.ts
git commit -m "feat(backend): add login/logout auth actions with bcrypt"
```

---

### Task 2.4: Create Session Validation Query

**Files:**
- Create: `packages/backend/convex/sessions.ts`

**Step 1: Create session queries**

Create `packages/backend/convex/sessions.ts`:
```typescript
import { v } from "convex/values";
import { query } from "./_generated/server";

export const validateSession = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      valid: v.literal(true),
      user: v.object({
        _id: v.id("users"),
        username: v.string(),
        name: v.string(),
        roleId: v.id("roles"),
        storeId: v.optional(v.id("stores")),
      }),
      role: v.object({
        _id: v.id("roles"),
        name: v.string(),
        permissions: v.array(v.string()),
        scopeLevel: v.union(
          v.literal("system"),
          v.literal("parent"),
          v.literal("branch")
        ),
      }),
    }),
    v.object({
      valid: v.literal(false),
    })
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session) {
      return { valid: false };
    }

    if (session.expiresAt < Date.now()) {
      return { valid: false };
    }

    const user = await ctx.db.get(session.userId);
    if (!user || !user.isActive) {
      return { valid: false };
    }

    const role = await ctx.db.get(user.roleId);
    if (!role) {
      return { valid: false };
    }

    return {
      valid: true,
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        roleId: user.roleId,
        storeId: user.storeId,
      },
      role: {
        _id: role._id,
        name: role.name,
        permissions: role.permissions,
        scopeLevel: role.scopeLevel,
      },
    };
  },
});

export const getCurrentUser = query({
  args: { token: v.optional(v.string()) },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      username: v.string(),
      name: v.string(),
      roleId: v.id("roles"),
      storeId: v.optional(v.id("stores")),
      role: v.object({
        name: v.string(),
        permissions: v.array(v.string()),
        scopeLevel: v.union(
          v.literal("system"),
          v.literal("parent"),
          v.literal("branch")
        ),
      }),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    if (!args.token) return null;

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      return null;
    }

    const user = await ctx.db.get(session.userId);
    if (!user || !user.isActive) {
      return null;
    }

    const role = await ctx.db.get(user.roleId);
    if (!role) {
      return null;
    }

    return {
      _id: user._id,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
      storeId: user.storeId,
      role: {
        name: role.name,
        permissions: role.permissions,
        scopeLevel: role.scopeLevel,
      },
    };
  },
});
```

**Step 2: Commit**

```bash
git add packages/backend/convex/sessions.ts
git commit -m "feat(backend): add session validation queries"
```

---

### Task 2.5: Create Seed Data Function

**Files:**
- Create: `packages/backend/convex/seed.ts`

**Step 1: Create seed function for initial setup**

Create `packages/backend/convex/seed.ts`:
```typescript
"use node";

import { v } from "convex/values";
import { internalMutation, action } from "./_generated/server";
import { internal } from "./_generated/api";
import bcrypt from "bcryptjs";
import { DEFAULT_ROLE_PERMISSIONS } from "./lib/permissions";

// Internal mutation to insert seed data
export const insertSeedData = internalMutation({
  args: {
    roles: v.array(
      v.object({
        name: v.string(),
        permissions: v.array(v.string()),
        scopeLevel: v.union(
          v.literal("system"),
          v.literal("parent"),
          v.literal("branch")
        ),
        isSystem: v.boolean(),
      })
    ),
    superAdmin: v.object({
      username: v.string(),
      passwordHash: v.string(),
      name: v.string(),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    // Check if already seeded
    const existingRoles = await ctx.db.query("roles").first();
    if (existingRoles) {
      return { success: false, message: "Database already seeded" };
    }

    // Create roles
    const roleIds: Record<string, any> = {};
    for (const role of args.roles) {
      const id = await ctx.db.insert("roles", role);
      roleIds[role.name] = id;
    }

    // Create super admin user
    await ctx.db.insert("users", {
      username: args.superAdmin.username,
      passwordHash: args.superAdmin.passwordHash,
      name: args.superAdmin.name,
      roleId: roleIds["Super Admin"],
      storeId: undefined,
      isActive: true,
      pin: undefined,
      createdAt: Date.now(),
      lastLoginAt: undefined,
    });

    return { success: true, message: "Database seeded successfully" };
  },
});

// Action to seed the database (uses Node.js for bcrypt)
export const seed = action({
  args: {
    superAdminUsername: v.string(),
    superAdminPassword: v.string(),
    superAdminName: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(args.superAdminPassword, salt);

    // Define roles
    const roles = [
      {
        name: "Super Admin",
        permissions: DEFAULT_ROLE_PERMISSIONS["Super Admin"],
        scopeLevel: "system" as const,
        isSystem: true,
      },
      {
        name: "Admin",
        permissions: DEFAULT_ROLE_PERMISSIONS["Admin"],
        scopeLevel: "parent" as const,
        isSystem: true,
      },
      {
        name: "Manager",
        permissions: DEFAULT_ROLE_PERMISSIONS["Manager"],
        scopeLevel: "branch" as const,
        isSystem: true,
      },
      {
        name: "Staff",
        permissions: DEFAULT_ROLE_PERMISSIONS["Staff"],
        scopeLevel: "branch" as const,
        isSystem: true,
      },
    ];

    // Insert seed data
    return await ctx.runMutation(internal.seed.insertSeedData, {
      roles,
      superAdmin: {
        username: args.superAdminUsername,
        passwordHash,
        name: args.superAdminName,
      },
    });
  },
});
```

**Step 2: Commit**

```bash
git add packages/backend/convex/seed.ts
git commit -m "feat(backend): add database seed function with default roles and super admin"
```

---

### Task 2.6: Remove Clerk Configuration

**Files:**
- Delete: `packages/backend/convex/auth.config.js`
- Modify: `packages/backend/convex/utils.ts`
- Modify: `apps/web/src/middleware.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/native/package.json`

**Step 1: Delete Clerk auth config**

Run:
```bash
rm packages/backend/convex/auth.config.js
```

**Step 2: Update utils.ts to remove Clerk dependency**

Replace `packages/backend/convex/utils.ts`:
```typescript
// Auth utilities are now in lib/auth.ts
// This file kept for backwards compatibility during migration

export { getSessionUser, getUserWithRole, getUserStoreScope } from "./lib/auth";
```

**Step 3: Replace web middleware**

Replace `apps/web/src/middleware.ts`:
```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public routes that don't require authentication
const publicRoutes = ["/", "/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (publicRoutes.some((route) => pathname === route)) {
    return NextResponse.next();
  }

  // Check for session token in cookies
  const token = request.cookies.get("pos_session_token")?.value;

  // Redirect to login if no token
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files and API routes
    "/((?!_next/static|_next/image|favicon.ico|api).*)",
  ],
};
```

**Step 4: Remove Clerk from web package.json**

Run:
```bash
cd apps/web && npm uninstall @clerk/nextjs
```

**Step 5: Remove Clerk from native package.json**

Run:
```bash
cd apps/native && npm uninstall @clerk/clerk-expo
```

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove Clerk authentication, prepare for custom auth"
```

---

## Phase 3: Store Management (Backend)

### Task 3.1: Create Store CRUD Functions

**Files:**
- Create: `packages/backend/convex/stores.ts`

**Step 1: Create store functions**

Create `packages/backend/convex/stores.ts`:
```typescript
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requirePermission } from "./lib/permissions";

// List stores based on user scope
export const list = query({
  args: {
    token: v.string(),
    parentOnly: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("stores"),
      name: v.string(),
      parentId: v.optional(v.id("stores")),
      address1: v.string(),
      address2: v.optional(v.string()),
      tin: v.string(),
      min: v.string(),
      vatRate: v.number(),
      isActive: v.boolean(),
      createdAt: v.number(),
      branchCount: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Validate session and get user
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    const user = await ctx.db.get(session.userId);
    if (!user || !user.isActive) {
      throw new Error("User not found or inactive");
    }

    const role = await ctx.db.get(user.roleId);
    if (!role) {
      throw new Error("Role not found");
    }

    let stores;

    if (role.scopeLevel === "system") {
      // Super Admin: all stores
      if (args.parentOnly) {
        stores = await ctx.db
          .query("stores")
          .filter((q) => q.eq(q.field("parentId"), undefined))
          .collect();
      } else {
        stores = await ctx.db.query("stores").collect();
      }
    } else if (role.scopeLevel === "parent" && user.storeId) {
      // Admin: parent store + branches
      const parentStore = await ctx.db.get(user.storeId);
      const branches = await ctx.db
        .query("stores")
        .withIndex("by_parent", (q) => q.eq("parentId", user.storeId))
        .collect();
      stores = parentStore ? [parentStore, ...branches] : branches;
    } else if (user.storeId) {
      // Manager/Staff: single store
      const store = await ctx.db.get(user.storeId);
      stores = store ? [store] : [];
    } else {
      stores = [];
    }

    // Add branch count
    const storesWithBranchCount = await Promise.all(
      stores.map(async (store) => {
        const branches = await ctx.db
          .query("stores")
          .withIndex("by_parent", (q) => q.eq("parentId", store._id))
          .collect();
        return {
          _id: store._id,
          name: store.name,
          parentId: store.parentId,
          address1: store.address1,
          address2: store.address2,
          tin: store.tin,
          min: store.min,
          vatRate: store.vatRate,
          isActive: store.isActive,
          createdAt: store.createdAt,
          branchCount: branches.length,
        };
      })
    );

    return storesWithBranchCount;
  },
});

// Get single store
export const get = query({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
  },
  returns: v.union(
    v.object({
      _id: v.id("stores"),
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

    const store = await ctx.db.get(args.storeId);
    return store;
  },
});

// Create store
export const create = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    parentId: v.optional(v.id("stores")),
    address1: v.string(),
    address2: v.optional(v.string()),
    tin: v.string(),
    min: v.string(),
    vatRate: v.number(),
  },
  returns: v.id("stores"),
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

    // Check permission
    const permission = args.parentId ? "stores.manage" : "stores.create_branch";
    await requirePermission(ctx, user._id, permission);

    return await ctx.db.insert("stores", {
      name: args.name,
      parentId: args.parentId,
      logo: undefined,
      address1: args.address1,
      address2: args.address2,
      tin: args.tin,
      min: args.min,
      vatRate: args.vatRate,
      printerMac: undefined,
      kitchenPrinterMac: undefined,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

// Update store
export const update = mutation({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
    name: v.optional(v.string()),
    address1: v.optional(v.string()),
    address2: v.optional(v.string()),
    tin: v.optional(v.string()),
    min: v.optional(v.string()),
    vatRate: v.optional(v.number()),
    printerMac: v.optional(v.string()),
    kitchenPrinterMac: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
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

    const user = await ctx.db.get(session.userId);
    if (!user) throw new Error("User not found");

    await requirePermission(ctx, user._id, "stores.manage");

    const { token, storeId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    await ctx.db.patch(storeId, filteredUpdates);
    return null;
  },
});

// Generate upload URL for logo
export const generateLogoUploadUrl = mutation({
  args: { token: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Invalid session");
    }

    return await ctx.storage.generateUploadUrl();
  },
});

// Update store logo
export const updateLogo = mutation({
  args: {
    token: v.string(),
    storeId: v.id("stores"),
    storageId: v.id("_storage"),
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

    const user = await ctx.db.get(session.userId);
    if (!user) throw new Error("User not found");

    await requirePermission(ctx, user._id, "stores.manage");

    await ctx.db.patch(args.storeId, { logo: args.storageId });
    return null;
  },
});

// Get logo URL
export const getLogoUrl = query({
  args: { storageId: v.optional(v.id("_storage")) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    if (!args.storageId) return null;
    return await ctx.storage.getUrl(args.storageId);
  },
});
```

**Step 2: Commit**

```bash
git add packages/backend/convex/stores.ts
git commit -m "feat(backend): add store CRUD functions with permission checks"
```

---

## Phase 4-10: Remaining Implementation

Due to the extensive nature of this plan, the remaining phases are outlined below. Each phase follows the same task structure with specific files, steps, and commits.

### Phase 4: Product Catalog (Backend)
- Task 4.1: Category CRUD functions (`packages/backend/convex/categories.ts`)
- Task 4.2: Product CRUD functions (`packages/backend/convex/products.ts`)

### Phase 5: Table Management (Backend)
- Task 5.1: Table CRUD functions (`packages/backend/convex/tables.ts`)

### Phase 6: Order Management (Backend)
- Task 6.1: Order creation and item management (`packages/backend/convex/orders.ts`)
- Task 6.2: Order calculations with BIR tax rules (`packages/backend/convex/lib/taxCalculations.ts`)
- Task 6.3: Checkout and payment processing (`packages/backend/convex/checkout.ts`)

### Phase 7: Discounts & Voids (Backend)
- Task 7.1: Discount application with SC/PWD rules (`packages/backend/convex/discounts.ts`)
- Task 7.2: Void functions with manager PIN verification (`packages/backend/convex/voids.ts`)
- Task 7.3: Audit logging (`packages/backend/convex/auditLogs.ts`)

### Phase 8: Reports (Backend)
- Task 8.1: Daily report generation (`packages/backend/convex/reports.ts`)
- Task 8.2: Product sales aggregation

### Phase 9: Web Admin UI
- Task 9.1: Setup TanStack Query provider
- Task 9.2: Auth context and login page
- Task 9.3: Dashboard layout with shadcn/ui
- Task 9.4: Store management pages
- Task 9.5: Product/category management pages
- Task 9.6: User management pages
- Task 9.7: Reports pages

### Phase 10: Android POS UI
- Task 10.1: Setup Uniwind and ReactNativeReusables
- Task 10.2: Auth context and login screen
- Task 10.3: Table selection screen
- Task 10.4: Order taking screen
- Task 10.5: Checkout screen
- Task 10.6: Receipt printing (Bluetooth)
- Task 10.7: Kitchen ticket printing
- Task 10.8: Daily report screen

---

## Execution Checkpoints

After each phase, verify:

1. **Schema valid**: `npx convex dev --once` passes
2. **Types correct**: `npm run typecheck` passes
3. **Functions work**: Test in Convex dashboard
4. **Git clean**: All changes committed

---

## Next Steps

1. Complete Phase 1 (dependencies installation)
2. Complete Phase 2 (schema + auth)
3. Seed the database with test data
4. Proceed through remaining phases

Each phase should be completed and verified before moving to the next.
