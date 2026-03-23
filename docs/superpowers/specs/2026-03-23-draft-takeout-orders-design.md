# Draft Takeout Orders

## Problem

In the takeout queue, when a customer steps aside (e.g., still deciding) and lets the next person go first, the current order-in-progress is lost. The takeout flow stores items in React state only — navigating away discards everything. Staff must re-enter the entire order when the customer returns.

## Solution

Add a `"draft"` status to the order lifecycle. Draft orders are real orders persisted in the backend, but not yet submitted for payment. Items are saved to the database immediately as they're added, so "parking" an order is free — the data is already there.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Save behavior | Auto-save on "New Order" | Staff think "serve next customer," not "save data." No extra taps. |
| Draft placement in UI | Dedicated section at top of TakeoutListScreen | Amber/dashed styling, always visible so staff don't forget parked customers. |
| Storage | Backend (Convex DB) | Visible across devices/staff. Survives app crashes. |
| Draft expiry | End-of-day auto-cleanup + manual discard | Customers won't return after hours; staff can clean up anytime. |
| Customer naming | Auto-generated "Customer #N" label, editable | Always identifiable. No friction to park. Increments per day. |
| Technical approach | Add `"draft"` to existing order `status` field | Reuses order infrastructure (items, modifiers, totals). Minimal schema change. |

## Schema Changes

### `orders` table

- `status` field: add `"draft"` to union → `"draft" | "open" | "paid" | "voided"`
- `orderNumber` field: change to `v.optional(v.string())` — drafts have no order number until submitted
- New field: `draftLabel: v.optional(v.string())` — auto-generated customer label (e.g., "Customer #1")

No new tables. The existing `by_store_status` index covers `getDraftOrders` queries (`.eq("storeId", storeId).eq("status", "draft")`).

## Order Lifecycle (Updated)

```
draft → open → paid
  ↓              ↓
discarded      voided
```

- `draft`: Order created, items being added. Not visible in reports/history. No order number assigned yet.
- `open`: Draft submitted for payment. Order number generated. Takeout status flow begins (pending → preparing → ready → completed).
- `paid` / `voided`: Unchanged from current behavior.
- `discarded`: Draft and its items are hard-deleted from the database (not a status — the records are removed).

## Backend Functions

### New

| Function | Type | Description |
|----------|------|-------------|
| `createDraftOrder(storeId)` | mutation | Creates order with `status: "draft"`, auto-generates `draftLabel` (monotonic counter per day — gaps allowed if drafts are discarded), returns orderId |
| `submitDraft(orderId)` | mutation | Transitions `draft → open`, assigns order number, sets `takeoutStatus: "pending"`, sets `orderChannel: "walk_in_takeout"`. Throws if draft has zero items. |
| `discardDraft(orderId)` | mutation | Deletes draft order, all its items, and associated `orderItemModifiers`. Only works on `status: "draft"` |
| `getDraftOrders(storeId)` | query | Returns all draft orders for the store with item counts and totals |
| `cleanupExpiredDrafts(storeId)` | mutation | Deletes all drafts created before today. Called at end-of-day or on demand. |

### Modified

| Function | Change |
|----------|--------|
| `addItem` | Allow on `status: "draft"` orders (currently only `"open"`) |
| `removeItem` | Allow on `status: "draft"` orders |
| `updateItemQuantity` | Allow on `status: "draft"` orders |
| `updateItemNotes` | Allow on `status: "draft"` orders |
| `updateCustomerName` | Allow on `status: "draft"` orders (currently only `"open"`) |
| `getTakeoutOrders` | Exclude `status: "draft"` from results |
| `getOrderHistory` | Exclude `status: "draft"` via `.filter()`. Return type validator stays as-is (no `"draft"` in union). |
| `list` / `listActive` | Add unconditional `.filter(q => q.neq(q.field("status"), "draft"))`. Return type validator stays as-is. |
| `getTodaysOpenOrders` | Safe by default — queries `by_store_status` with `status: "open"`, so drafts are excluded. Confirm during implementation. |
| `getDashboardSummary` | Exclude `status: "draft"` from `totalOrdersToday` count |
| Report queries | Exclude `status: "draft"` from all report aggregations |

## Native App Changes

### TakeoutListScreen

- Add drafts section at top with amber/dashed styling
- Query `getDraftOrders(storeId)` for draft cards
- Each draft card shows: label, item count, subtotal, "Resume" button, discard action
- "New Order" button calls `createDraftOrder` then navigates to TakeoutOrderScreen

### TakeoutOrderScreen

- Remove local `draftItems` state and `isDraftMode` logic
- Always work against the backend (orderId is always available — created as draft upfront)
- `customerName` updates save to the order's `customerName` field
- "Proceed to Payment" calls `submitDraft(orderId)` then navigates to CheckoutScreen
- Back button simply navigates back — draft is already persisted

### Key Simplification

The current two-phase model (local draft → backend order at checkout) is replaced by a single-phase model where the order always lives in the backend. This eliminates:
- `draftItems` local state array
- `isDraftMode` branching
- The checkout-time loop that creates the order then adds items one-by-one
- Risk of partial failures during the create-then-add-items sequence

## End-of-Day Cleanup

`cleanupExpiredDrafts` can be called:
- When generating the daily report (existing end-of-day flow)
- Manually by staff via a "Clear old drafts" action
- Deletes all draft orders with `createdAt` before start of current day
