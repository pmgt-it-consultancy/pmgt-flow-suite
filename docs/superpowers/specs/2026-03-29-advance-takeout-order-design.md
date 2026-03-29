# Advance Takeout Order — Send to Kitchen Without Payment

## Overview

Allow staff to send a takeout order to the kitchen without completing payment first. A "Send to Kitchen" button on the checkout screen triggers a confirmation, auto-prints the kitchen receipt, and places the order into the takeout queue as "preparing" with an "Unpaid" badge. Payment is settled later when the customer picks up.

## Use Case

Customer walks in, places a takeout order, and wants to pay on pickup. Kitchen needs to start preparing immediately rather than waiting for payment.

## Flow

```
Takeout screen → Add items → Proceed to Payment → Checkout screen
                                                      ├─ Pay normally (existing flow)
                                                      └─ "Send to Kitchen" button
                                                           → Confirmation dialog
                                                           → Auto-print kitchen receipt
                                                           → Mark items as sent
                                                           → Navigate to takeout queue

Takeout queue shows order as "Preparing" + "Unpaid" badge
  → Staff taps unpaid order
  → Opens checkout screen
  → Processes payment normally
  → Existing post-payment flow takes over
```

## Backend Changes

### `packages/backend/convex/orders.ts`

New mutation: `sendToKitchenWithoutPayment`

- Args: `orderId`, `storeId`
- Validates order is `"open"` and `takeoutStatus` is `"pending"`
- Marks all items as `isSentToKitchen: true`
- Updates `takeoutStatus` from `"pending"` to `"preparing"`
- Does NOT change `order.status` — it stays `"open"` (unpaid)
- Logs to `auditLogs`

### No changes to `checkout.ts`

Payment flow stays the same. Existing `updateTakeoutStatus` validation already blocks moving to `"completed"` unless `status === "paid"`.

## Native App Changes

### Checkout screen (`CheckoutScreen.tsx`)

- Add a "Send to Kitchen" button in the header area (secondary style, not competing with payment buttons)
- On tap: show confirmation dialog — "Send to kitchen without payment?"
- On confirm:
  1. Call `sendToKitchenWithoutPayment` mutation
  2. Auto-print kitchen receipt (reuse existing `printKitchenTicketToThermal`)
  3. Navigate to takeout queue

### Takeout queue screen

- Add an "Unpaid" badge on orders where `order.status !== "paid"` and `takeoutStatus === "preparing"`
- Badge styling: red/orange tint to draw attention (`backgroundColor: "#FEF2F2"`, `color: "#DC2626"`)
- Tapping an unpaid order navigates to checkout screen for payment

## What stays the same

- Takeout order creation (draft → submit → checkout)
- Payment processing
- Post-payment receipt printing
- Takeout status lifecycle (preparing → ready_for_pickup → completed)
- The "completed" guard requiring payment
- Dine-in flow — completely untouched

## Edge cases

- **Accidental send**: Staff can open the order from the queue and void it (existing void flow)
- **Customer never returns**: Order stays "preparing" + "unpaid" in the queue. Staff can void it.
- **Items added after sending**: Not supported — order is already in the queue. Staff creates a new order for additional items (same as current dine-in behavior for sent orders).
