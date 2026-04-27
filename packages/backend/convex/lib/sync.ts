/**
 * Helpers shared by /sync/registerDevice, /sync/pull, /sync/push and the
 * existing domain mutations that now write updatedAt + clientId.
 */

/**
 * Encodes a 0-indexed integer as an Excel-style alphabetic device code.
 *
 *   0 → "A"   25 → "Z"   26 → "AA"   51 → "AZ"   52 → "BA"
 *   701 → "ZZ"   702 → "AAA"
 *
 * Used to assign new device codes from a store's monotonic
 * deviceCodeCounter; never decremented, never reused.
 */
export function deviceCodeFromIndex(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`deviceCodeFromIndex: invalid index ${n}`);
  }
  let code = "";
  let cursor = n;
  while (cursor >= 0) {
    code = String.fromCharCode(65 + (cursor % 26)) + code;
    cursor = Math.floor(cursor / 26) - 1;
  }
  return code;
}

/**
 * Generates a fresh clientId UUID. Used by mutations called from the admin
 * web (which doesn't push via /sync/push and therefore doesn't supply its
 * own UUID).
 */
export function newClientId(): string {
  return crypto.randomUUID();
}

/**
 * The complete set of synced tables. Keep aligned with the WatermelonDB
 * schema in apps/native/src/db/schema.ts. When adding a new sync table,
 * add it here AND to that schema.
 */
export const SYNCED_TABLES = [
  "users",
  "roles",
  "stores",
  "categories",
  "products",
  "modifierGroups",
  "modifierOptions",
  "modifierGroupAssignments",
  "tables",
  "orders",
  "orderItems",
  "orderItemModifiers",
  "orderDiscounts",
  "orderVoids",
  "orderPayments",
  "auditLogs",
  "settings",
  "appConfig",
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * Tables the tablet may push writes for (anything else from a /sync/push
 * payload is rejected). Catalog tables — products, categories, etc. —
 * are admin-only.
 */
export const TABLET_WRITABLE_TABLES = new Set<SyncedTable>([
  "orders",
  "orderItems",
  "orderItemModifiers",
  "orderDiscounts",
  "orderVoids",
  "orderPayments",
  "auditLogs",
]);
