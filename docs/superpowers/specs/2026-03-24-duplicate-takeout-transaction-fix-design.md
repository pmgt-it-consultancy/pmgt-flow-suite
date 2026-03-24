# Fix: Duplicate Transaction Prevention (Takeout + Dine-In)

**Date:** 2026-03-24
**Status:** Approved
**Severity:** High
**Issue:** Payment completions sometimes lag and create duplicate transactions. Observed intermittently (~few times per week on slow devices/networks). Audit reveals the same class of vulnerability exists across both takeout and dine-in flows.

## Problem

Two takeout orders are created at the same time with identical items and amounts — one marked "Paid", the other stuck as "Open". Example: T-059 (Open) and T-060 (Paid), both Mar 24 12:42 PM, 28 items, ₱2,980.00.

A full audit of the dine-in flow reveals the same pattern: most async action buttons lack loading-state guards, allowing double-taps to fire duplicate mutations.

### Root Causes

1. **Missing loading-state guards on action buttons** — Buttons trigger async mutations but `disabled` props don't reflect in-flight state, allowing double-tap to fire mutations twice.
2. **No backend idempotency** — `createDraftOrder` and payment mutations lack deduplication, so concurrent calls succeed independently.
3. **Modal components don't receive loading state from parents** — Modals with async callbacks have no visibility into whether the parent's mutation is in-flight.

## Design

Three-layer defense: frontend guards (prevent most cases), backend idempotency (catch edge cases), schema enhancement (support deduplication lookups).

**Note on frontend guards:** These are best-effort — React Navigation screen re-mounts reset local state, so a re-mount mid-flight loses the guard. The backend idempotency layer (Layer 2) is the authoritative defense. Frontend guards prevent the common case (impatient taps); backend catches the rest.

---

### Layer 1: Frontend Double-Tap Prevention

#### 1A. Takeout Flow

##### TakeoutOrderScreen — "Proceed to Payment" button
- **File:** `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx`
- **Change:** Line 548: `disabled={!hasItems}` → `disabled={!hasItems || isSending}`
- **Also:** Update button background color to reflect disabled state when `isSending` is true

##### TakeoutListScreen — "New Order" button
- **File:** `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`
- **Change:** Add `isCreating` state. Set true before `createDraftMutation`, false in `finally`. Add `disabled={isCreating}` to the New Order button.

##### TakeoutListScreen — Draft action buttons
- **File:** Same as above, plus any card components
- **Change:** Add loading states to Resume and Discard buttons to prevent double-tap during async operations

#### 1B. Dine-In Flow — Critical (duplicate orders/transactions)

##### TablesScreen — Add New Tab button
- **File:** `apps/native/src/features/tables/screens/TablesScreen.tsx`
- **Change:** Add `isCreatingTab` state. Set true before `createOrderMutation`, false in `finally`. Pass `isCreatingTab` to `TabSelectionModal` as a prop so it can disable the "Add New Tab" button.
- **Impact:** Prevents duplicate dine-in orders from double-tap

##### TabSelectionModal — Add New Tab button
- **File:** `apps/native/src/features/tables/components/TabSelectionModal.tsx`
- **Change:** Accept `isCreating` prop from parent. Add `disabled={isCreating}` to the Add New Tab button.

##### CartFooter — Close Table button
- **File:** `apps/native/src/features/orders/components/CartFooter.tsx`
- **Change:** Accept `isClosing` prop or manage local state around `onCloseTable()` callback. Add `disabled={isClosing}` to button.

##### CartFooter — Cancel Order button
- **File:** Same as above
- **Change:** Accept `isCancelling` prop or manage local state around `onCancelOrder()` callback. Add `disabled={isCancelling}` to button. Prevents duplicate void operations.

##### VoidItemModal — Confirm Void button
- **File:** `apps/native/src/features/orders/components/VoidItemModal.tsx`
- **Change:** Add `isVoiding` local state. Set true before calling `onConfirm()`, false in `finally`. Change `disabled={!reason.trim()}` → `disabled={!reason.trim() || isVoiding}`.

#### 1C. Dine-In Flow — High (inconsistent state)

##### TablesScreen — PAX Confirm button
- **File:** `apps/native/src/features/tables/screens/TablesScreen.tsx`
- **Change:** Add `isUpdatingPax` state around `updatePaxMutation`. Add `disabled={isUpdatingPax}` to PAX confirm button.

##### OrderScreen — PAX Confirm button
- **File:** `apps/native/src/features/orders/screens/OrderScreen.tsx`
- **Change:** `isSending` state already exists — wire it to the PAX confirm button's `disabled` prop. (Same pattern as the takeout bug.)

##### EditTabNameModal — Save button
- **File:** `apps/native/src/features/orders/components/EditTabNameModal.tsx`
- **Change:** Add `isSaving` local state. Set true before `onSave()`, false in `finally`. Add `disabled={isSaving}` to Save button.

#### 1D. Dine-In Flow — Low (UI annoyance)

##### HomeScreen — Lock/Logout buttons
- **File:** `apps/native/src/features/home/screens/HomeScreen.tsx`
- **Change:** Add loading states to `handleLock` and `handleLogout`. Add `disabled` props to prevent multiple fires.

##### CartFooter — View Bill button
- **File:** `apps/native/src/features/orders/components/CartFooter.tsx`
- **Change:** Add `disabled` guard if navigation or async operation is in flight.

---

### Layer 2: Backend Idempotency Guards

#### `submitDraft` — Idempotent return on already-submitted orders
- **File:** `packages/backend/convex/orders.ts`, `submitDraft` mutation
- **Change:** Before the `status !== "draft"` throw, check if the order is already `"open"` with an `orderNumber` assigned. If so, return the existing result instead of throwing.

```typescript
// Before:
if (order.status !== "draft") throw new Error("Only draft orders can be submitted");

// After:
if (order.status !== "draft") {
  if (order.status === "open" && order.orderNumber) {
    return { orderNumber: order.orderNumber! }; // Already submitted — idempotent return
    // Note: non-null assertion safe here because the && guard ensures orderNumber is defined
  }
  throw new Error("Only draft orders can be submitted");
}
```

#### `createDraftOrder` — Request ID deduplication
- **File:** `packages/backend/convex/orders.ts`, `createDraftOrder` mutation
- **Change:** Add `requestId: v.string()` argument. Before inserting, query for an existing order with the same `requestId`. If found, return the existing order's `_id` instead of creating a duplicate.
- **Frontend change:** Generate a `crypto.randomUUID()` when the user taps "New Order" and pass it to the mutation. (Available in Hermes on React Native 0.81 + Expo 54.)
- **Callers:** Only one call site exists: `TakeoutListScreen.tsx` line 115. The test file (`orders.test.ts`) will also need updating.

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
- **Change:** In both `processCashPayment` and `processCardPayment`, if `order.status === "paid"` and the `paymentMethod` matches the endpoint, return success with existing payment data instead of throwing. If paid but paymentMethod doesn't match, still throw — that's a misrouted call, not a retry.

```typescript
// processCashPayment — before the "not open" throw:
if (order.status === "paid" && order.paymentMethod === "cash") {
  return { success: true, changeGiven: order.changeGiven ?? 0 };
}

// processCardPayment — before the "not open" throw:
if (order.status === "paid" && order.paymentMethod === "card_ewallet") {
  return { success: true };
}
```

#### Dine-in `create` mutation — Request ID deduplication
- **File:** `packages/backend/convex/orders.ts`, `create` mutation
- **Change:** Add optional `requestId: v.optional(v.string())` argument. If provided, check for existing order with same `requestId` before creating. This protects the "Add New Tab" flow in TablesScreen.
- **Callers:** Check all call sites of `api.orders.create` and pass `requestId` where applicable.

---

### Layer 3: Schema Enhancement

- **File:** `packages/backend/convex/schema.ts`
- **Change:** Add `requestId` field to the `orders` table definition and a new index:

```typescript
requestId: v.optional(v.string()),
// ...indexes:
.index("by_requestId", ["requestId"])
```

`requestId` is `v.optional()` to remain backward-compatible with existing orders that don't have one. The `by_requestId` index will contain existing orders with `requestId === undefined`, but dedup queries always pass a defined string so this is correct.

**Orphaned drafts:** Drafts created but never populated (e.g., app crash after creation) are handled by the existing `cleanupExpiredDrafts` mechanism.

---

## What We're NOT Doing

- **No transactional counter table** — Unnecessary at restaurant-scale concurrency. Convex mutation serialization handles the realistic load.
- **No unique constraint on orderNumber** — Convex doesn't support native unique indexes. The `requestId` idempotency key prevents duplicate creation at the source.
- **No changes to order number generation** — `getNextOrderNumber()` works correctly under serial execution, which Convex guarantees for same-document mutations.

## Files Changed

| File | Change |
|------|--------|
| `packages/backend/convex/schema.ts` | Add `requestId` field + `by_requestId` index to orders |
| `packages/backend/convex/orders.ts` | Idempotent `submitDraft`, `requestId` dedup in `createDraftOrder` and `create` |
| `packages/backend/convex/checkout.ts` | Idempotent payment mutations |
| `apps/native/.../TakeoutOrderScreen.tsx` | Add `isSending` to button disabled prop |
| `apps/native/.../TakeoutListScreen.tsx` | Add loading states to New Order, Resume, Discard buttons |
| `apps/native/.../TablesScreen.tsx` | Add loading states to Add New Tab, PAX Confirm buttons |
| `apps/native/.../TabSelectionModal.tsx` | Accept `isCreating` prop, disable Add New Tab button |
| `apps/native/.../CartFooter.tsx` | Add loading guards to Close Table, Cancel Order, View Bill buttons |
| `apps/native/.../VoidItemModal.tsx` | Add `isVoiding` state, wire to Confirm button disabled prop |
| `apps/native/.../OrderScreen.tsx` | Wire existing `isSending` to PAX Confirm button disabled prop |
| `apps/native/.../EditTabNameModal.tsx` | Add `isSaving` state, wire to Save button disabled prop |
| `apps/native/.../HomeScreen.tsx` | Add loading states to Lock/Logout buttons |

## Testing

### Manual Testing
- Double-tap "New Order" (takeout) rapidly → only one draft created
- Double-tap "Add New Tab" (dine-in) rapidly → only one order created
- Double-tap "Proceed to Payment" rapidly → only one submission, no error alert
- Double-tap payment button → only one payment processed, no error
- Double-tap "Confirm Void" rapidly → only one void operation
- Double-tap "Close Table" rapidly → only one closure
- Double-tap PAX confirm → only one update
- Slow network simulation → mutations complete correctly without duplicates
- Existing orders without `requestId` → continue working (backward compatible)

### Automated Backend Tests (Vitest + convex-test)
- `createDraftOrder` with duplicate `requestId` → returns same order ID
- `submitDraft` on already-open order → returns orderNumber without error
- `processCashPayment` on already-paid (cash) order → returns success
- `processCardPayment` on already-paid (card) order → returns success
- `processCashPayment` on card-paid order → throws error (misrouted)
