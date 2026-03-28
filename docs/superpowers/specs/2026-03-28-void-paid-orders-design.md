# Void Paid Orders (Refund & Re-ring)

## Problem

Paid orders are currently immutable. If a customer wants to refund a single item after payment, there's no way to do it in the system. Staff must handle it manually outside the POS.

## Solution

Extend the existing void system to support paid orders using a "void and re-ring" approach:

1. Void the original paid order
2. Auto-create a new order with remaining items (discounts reapplied, tax recalculated)
3. Auto-settle the new order as paid
4. Refund the difference to the customer (staff chooses cash or card)

## Flow

1. Staff opens a paid order and taps "Refund Item"
2. Selects item(s) to remove
3. Enters a reason
4. Manager PIN verification
5. Selects refund method (cash or card)
6. Confirms
7. System voids the original order, creates a new paid order with remaining items, records the refund

## Schema Changes

### `orderVoids` table

Add new void type and refund-specific fields:

```typescript
voidType: "full_order" | "item" | "refund"    // "refund" is new
refundMethod?: "cash" | "card_ewallet"         // how money was returned
replacementOrderId?: Id<"orders">              // the new re-rung order
```

### `orders` table

Add link back to original order:

```typescript
refundedFromOrderId?: Id<"orders">   // on the new order, points to the voided original
```

## Backend

### New mutation: `voidPaidOrder` in `voids.ts`

1. Validate order `status === "paid"`
2. Manager PIN verification (existing bcrypt flow)
3. Mark original order as `status: "voided"`
4. Create new order with remaining items:
   - Copy product snapshots (name, price), modifiers, quantities from non-removed items
   - Preserve `orderType`, `orderCategory`, `tableId`, `tableMarker`, `customerName`
   - Generate new order number (next in daily sequence)
5. Reapply same discount types from original `orderDiscounts`
6. Recalculate tax via `taxCalculations.ts`
7. Auto-create `orderPayments` on new order (original total minus refund amount)
8. Set new order `status: "paid"`, `paidAt`, `paidBy`
9. Record `orderVoids` entry:
   - `voidType: "refund"`
   - `refundMethod`: cash or card_ewallet
   - `replacementOrderId`: new order ID
   - `amount`: refunded amount
   - `reason`: staff-entered reason
   - `approvedBy` / `requestedBy`: manager and staff user IDs
10. Create audit log entry

### Edge cases

- **All items removed**: If customer refunds every item, void the order fully (no new order created). Refund full amount.
- **Split payments on original**: Refund method is independent of original payment method. Staff chooses how to refund.
- **No time limit**: Any paid order can be refunded at any time.
- **Discounts**: Same discount type(s) reapplied to new order and recalculated for the smaller item set.

## Reports

- Refund voids contribute to `voidCount` and `voidAmount` in daily reports (existing void accounting)
- The new re-rung order counts as a normal paid order in sales totals
- Net effect: reports reflect correct final sales

## UI

### Native App

- **Paid order detail screen**: Add "Refund Item" button
- **Refund modal**: Select items to remove, enter reason, manager PIN, choose refund method (cash/card), confirm
- **Order history**: Voided-via-refund orders show "Refund" badge; new re-rung order visible as a normal paid order

### Web Admin

- **Order detail**: Same refund flow accessible from the orders table
- **Voided filter**: Refunded orders appear under "Voided" with a "Refund" badge to distinguish from regular voids
- **Order detail view**: Shows link to replacement order and refund details

## Audit Trail

- `orderVoids` record with `voidType: "refund"` links original and replacement orders
- `auditLogs` entry with action `"refund_order"`, entity type `"order"`, details including:
  - Original order number
  - Removed item(s) and amounts
  - Refund method and total refund amount
  - Replacement order number
  - Reason

## What This Does NOT Include

- Payment processor integration (card refunds are recorded but not auto-processed)
- Store credit system
- Refund approval tiers (uses same manager PIN as voids)
- Refund time limits (configurable window)
