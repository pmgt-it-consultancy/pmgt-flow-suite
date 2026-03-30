# Takeout Running Bill with Smart Kitchen Button

## Overview

Advance takeout orders support a running bill. Staff can reopen the order to add items, send them to kitchen, and repeat. The takeout card shows "Add Items" and "Take Payment" buttons. The checkout screen has one smart kitchen button that adapts its label and behavior based on whether there are unsent items.

## Flow

```
Running bill:
  Queue → "Add Items" → TakeoutOrderScreen → Add items →
    Checkout → "Send to Kitchen" (sends unsent, prints all) → Queue

Reprint:
  Queue → "Add Items" → Checkout (no new items) →
    "Reprint Kitchen Receipt" (prints all, no mutation) → Queue

Settlement:
  Queue → "Take Payment" → Checkout → Process payment → Done
```

## Changes

### TakeoutOrderCard.tsx

Advance orders show two buttons:
- "Add Items" (orange) — navigates to TakeoutOrderScreen
- "Take Payment" (blue) — navigates to CheckoutScreen

### TakeoutListScreen.tsx

`handleOpenTakeoutOrder` accepts an action: `"add_items"` routes to TakeoutOrderScreen, `"pay"` routes to CheckoutScreen.

### CheckoutScreen.tsx — Smart kitchen button

Check if order has unsent items (`activeItems.some(i => !i.isSentToKitchen)`):
- **Has unsent items:** label = "Send to Kitchen Without Payment", calls `sendToKitchenWithoutPayment` mutation, then prints full kitchen ticket (all items)
- **All items sent:** label = "Reprint Kitchen Receipt", just prints the full kitchen ticket (no mutation)
- Button shows for takeout orders with `takeoutStatus` of `"pending"` OR `"preparing"`

### Backend — `sendToKitchenWithoutPayment` (orders.ts)

Remove `takeoutStatus !== "pending"` guard — allow calling on `"preparing"` orders too (for subsequent sends). The mutation already only marks unsent items, so it handles subsequent sends naturally.

## What stays the same

- Order creation, draft flow, item management
- Payment processing and post-payment flow
- Takeout queue sections and filtering
- Kitchen receipt data construction (includes per-item service type and order category)
- The "completed" guard requiring payment

## Edge cases

- **No new items added:** If staff opens the order, adds nothing, and goes to checkout, the button shows "Reprint Kitchen Receipt" — no mutation, just prints.
- **Customer never returns:** Order stays "preparing" + "unpaid" in the queue. Staff can void it.
