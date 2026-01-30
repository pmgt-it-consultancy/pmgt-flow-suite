import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

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
  "modifiers.manage": "Add/edit/disable modifier groups and options",

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
    "modifiers.manage",
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
  permission: Permission,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user || !user.isActive) return false;
  if (!user.roleId) return false;

  const role = await ctx.db.get(user.roleId);
  if (!role) return false;

  return role.permissions.includes(permission);
}

export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  permission: Permission,
): Promise<void> {
  const allowed = await hasPermission(ctx, userId, permission);
  if (!allowed) {
    throw new Error(`Permission denied: ${permission}`);
  }
}
