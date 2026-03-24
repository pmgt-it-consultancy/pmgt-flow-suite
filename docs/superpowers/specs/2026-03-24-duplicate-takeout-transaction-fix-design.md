# Fix: Duplicate Takeout Transaction Prevention

**Date:** 2026-03-24
**Status:** Approved
**Issue:** Takeout payment completions sometimes lag and create duplicate transactions (observed intermittently, ~few times per week on slow devices/networks)

## Problem

Two takeout orders are created at the same time with identical items and amounts — one marked "Paid", the other stuck as "Open". Example: T-059 (Open) and T-060 (Paid), both Mar 24 12:42 PM, 28 items, ₱2,980.00.

### Root Causes

1. **Missing `isSending` guard on "Proceed to Payment" button** — `TakeoutOrderScreen` line 548 uses `disabled={!hasItems}` but never checks `isSending`, allowing double-tap to fire `submitDraft` twice.
2. **No loading state on "New Order" button** — `TakeoutListScreen.handleNewOrder` has zero loading guard, so double-tap creates two separate draft orders.
3. **No backend idempotency** — `createDraftOrder` and payment mutations lack deduplication, so concurrent calls succeed independently.

## Design

Three-layer defense: frontend guards (prevent most cases), backend idempotency (catch edge cases), schema enhancement (support deduplication lookups).

### Layer 1: Frontend Double-Tap Prevention

#### TakeoutOrderScreen — "Proceed to Payment" button
- **File:** `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx`
- **Change:** Line 548: `disabled={!hasItems}` → `disabled={!hasItems || isSending}`
- **Also:** Update button background color to reflect disabled state when `isSending` is true

#### TakeoutListScreen — "New Order" button
- **File:** `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`
- **Change:** Add `isCreating` state. Set true before `createDraftMutation`, false in `finally`. Add `disabled={isCreating}` to the New Order button.

#### TakeoutListScreen — Draft action buttons
- **File:** Same as above, plus any card components
- **Change:** Add loading states to Resume and Discard buttons to prevent double-tap during async operations

### Layer 2: Backend Idempotency Guards

#### `submitDraft` — Idempotent return on already-submitted orders
- **File:** `packages/backend/convex/orders.ts`, `submitDraft` mutation
- **Change:** Before the `status !== "draft"` throw, check if the order is already `"open"` with an `orderNumber` assigned. If so, return `{ orderNumber: order.orderNumber }` instead of throwing. This makes the mutation idempotent — retries return the same result.

```typescript
// Before:
if (order.status !== "draft") throw new Error("Only draft orders can be submitted");

// After:
if (order.status !== "draft") {
  if (order.status === "open" && order.orderNumber) {
    return { orderNumber: order.orderNumber }; // Already submitted — idempotent return
  }
  throw new Error("Only draft orders can be submitted");
}
```

#### `createDraftOrder` — Request ID deduplication
- **File:** `packages/backend/convex/orders.ts`, `createDraftOrder` mutation
- **Change:** Add `requestId: v.string()` argument. Before inserting, query for an existing order with the same `requestId`. If found, return the existing order's `_id` instead of creating a duplicate.
- **Frontend change:** Generate a `crypto.randomUUID()` (or `uuid.v4()` on React Native) when the user taps "New Order" and pass it to the mutation.

```typescript
// Add to createDraftOrder args:
requestId: v.string(),

// Add before insert:
const existing = await ctx.db
  .query("orders")
  .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
  .unique();
if (existing) return existing._id;
```

#### Payment mutations — Idempotent on already-paid orders
- **File:** `packages/backend/convex/checkout.ts`
- **Change:** In both `processCashPayment` and `processCardPayment`, if `order.status === "paid"`, return success with existing payment data instead of throwing.

```typescript
// processCashPayment — before the "not open" throw:
if (order.status === "paid") {
  return { success: true, changeGiven: order.changeGiven ?? 0 };
}

// processCardPayment — before the "not open" throw:
if (order.status === "paid") {
  return { success: true };
}
```

### Layer 3: Schema Enhancement

- **File:** `packages/backend/convex/schema.ts`
- **Change:** Add `requestId` field to the `orders` table definition and a new index:

```typescript
requestId: v.optional(v.string()),
// ...indexes:
.index("by_requestId", ["requestId"])
```

`requestId` is `v.optional()` to remain backward-compatible with existing orders that don't have one.

## What We're NOT Doing

- **No transactional counter table** — Unnecessary at restaurant-scale concurrency. Convex mutation serialization handles the realistic load.
- **No unique constraint on orderNumber** — Convex doesn't support native unique indexes. The `requestId` idempotency key prevents duplicate creation at the source.
- **No changes to order number generation** — `getNextOrderNumber()` works correctly under serial execution, which Convex guarantees for same-document mutations.

## Files Changed

| File | Change |
|------|--------|
| `packages/backend/convex/schema.ts` | Add `requestId` field + `by_requestId` index to orders |
| `packages/backend/convex/orders.ts` | Idempotent `submitDraft`, `requestId` dedup in `createDraftOrder` |
| `packages/backend/convex/checkout.ts` | Idempotent payment mutations |
| `apps/native/.../TakeoutOrderScreen.tsx` | Add `isSending` to button disabled prop |
| `apps/native/.../TakeoutListScreen.tsx` | Add loading states to New Order, Resume, Discard buttons |

## Testing

- Double-tap "New Order" rapidly → only one draft created
- Double-tap "Proceed to Payment" rapidly → only one submission, no error alert
- Double-tap payment button → only one payment processed, no error
- Slow network simulation → mutations complete correctly without duplicates
- Existing orders without `requestId` → continue working (backward compatible)
