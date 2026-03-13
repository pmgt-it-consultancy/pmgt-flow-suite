# Bulk Void Stale Orders — Design Spec

## Problem

Active orders accumulate on the admin orders page when they are never paid or voided. Orders 38+ days old clutter the dashboard and misrepresent current operations. The only way to clear them today is voiding one-by-one with manager PIN each time.

## Solution

Add a multi-select bulk void feature to the existing admin orders page (`app/(admin)/orders/`). Staff can review, select, and void multiple open orders in a single action with one manager PIN verification.

## User Flow

1. Staff navigates to the orders page (filtered to "open" status)
2. Clicks a "Select" toggle button in the page header
3. Page enters selection mode — checkboxes appear on each open order row
4. "Select All" checkbox available at the top
5. Staff reviews and checks the orders they want to void
6. Sticky footer bar appears: `"X orders selected"` + `"Void Selected"` button
7. Clicks "Void Selected" — confirmation dialog shows selected orders (number, type, age, amount)
8. Confirms — Manager PIN modal appears (single PIN for entire batch)
9. All selected orders are voided with reason `"Stale order - abandoned"`
10. Success toast: `"X orders voided successfully"`

## Backend

### New Action: `voids.bulkVoidOrders`

- **Args:** `orderIds: Id<"orders">[]`, `managerId`, `managerPin`
- **Returns:** `{ success: true, voidedCount: number, skippedCount: number }` or `{ success: false, error: string }`
- **Max batch size:** 50 orders. Frontend enforces this limit.
- **Flow:**
  1. Authenticate user via `getUserId(ctx)`
  2. Fetch manager and verify PIN with `bcrypt.compare()` — once for the batch
  3. Loop through `orderIds` sequentially (follows existing bulk pattern from `products.ts`)
  4. For each order, call existing `internal.helpers.voidsHelpers.voidOrderInternal` mutation
  5. Void reason: `"Bulk void - abandoned order"`
  6. **Skip-and-continue on failure:** If an individual order fails (already voided, already paid, not found), skip it and increment `skippedCount`. Do not abort the batch.
  7. Return `{ success: true, voidedCount, skippedCount }`

### What the existing `voidOrderInternal` already handles (per order)

- Sets `order.status = "voided"`
- Sets `takeoutStatus = "cancelled"` for takeout orders
- Releases dine-in table (sets table to "available", clears `currentOrderId`). Note: for stale orders, the table may have been reassigned — `voidOrderInternal` should be verified to guard against this.
- Creates `orderVoids` record with `voidType: "full_order"`
- Creates audit log entry with action `"void_order"`

### No schema changes

No new tables, statuses, or indexes. Orders transition to `voided` — same as existing single void.

## Web Frontend Changes

### Orders page (`app/(admin)/orders/page.tsx`)

- Add "Select" toggle button in the header area (only visible when status filter is "open")
- When toggled on:
  - Checkboxes appear on each order row
  - "Select All" checkbox in the table header
  - Sticky footer bar with selection count and "Void Selected" button
- When toggled off: returns to normal view, clears selection

### New components (colocated in `_components/` and `_hooks/`)

- Selection state managed via `useState` (set of selected order IDs)
- `BulkVoidFooter` — sticky footer bar with count and "Void Selected" button (disabled when 0 selected)
- `BulkVoidConfirmDialog` — confirmation dialog listing selected orders before proceeding
- Reuse existing Manager PIN modal pattern from the codebase
- Loading state with disabled interaction while bulk void is processing
- Success toast showing voided count (and skipped count if any)

## Edge Cases

- **Already voided/paid orders:** Skip and continue. An order's status may change between selection and execution (e.g., cashier pays it on the native app). The action catches the error and increments `skippedCount`.
- **Empty selection:** "Void Selected" button is disabled when 0 orders are selected.
- **Stale table references:** For old dine-in orders, the table's `currentOrderId` may point to a newer order. The table release logic in `voidOrderInternal` should check that `table.currentOrderId` matches the order being voided before releasing.

## Constraints

- Manager PIN required — maintains existing authorization model
- Each order gets individual audit log entry — full traceability
- Sequential processing — follows existing codebase patterns (no Promise.all for mutations)
- Void reason is fixed to "Bulk void - abandoned order"
- Max batch size: 50 orders per action call
- Only open orders are selectable (selection mode only available when filtered to "open" status)
