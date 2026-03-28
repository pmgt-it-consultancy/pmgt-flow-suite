# Split Payment & Counter Ordering Enhancements

**Date:** 2026-03-28
**Status:** Approved
**Scope:** Backend schema, native checkout, native takeout, receipt printing

## Overview

Five changes to the POS system:

1. **Split Payment (Multiple MOP)** — Support unlimited payment methods per order
2. **Counter Ordering Category** — Takeout screen supports dine-in/takeout selection
3. **Table Marker** — Free text field for tent card / table marker numbers
4. **Daily Order Number Reset** — Fix T-xxx numbers not resetting each day
5. **Kitchen Receipt Bug** — Order type lost when customer name is set

## 1. Split Payment / Multiple MOP

### Problem

The checkout only supports one payment method per order. Customers who want to split (e.g., 2,900 cash + 1,000 GCash on a 3,900 bill) cannot do so.

### Data Model

New `orderPayments` table:

```typescript
orderPayments: defineTable({
  orderId: v.id("orders"),
  storeId: v.id("stores"),
  paymentMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
  amount: v.number(),
  cashReceived: v.optional(v.number()),
  changeGiven: v.optional(v.number()),
  cardPaymentType: v.optional(v.string()),
  cardReferenceNumber: v.optional(v.string()),
  createdAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_order", ["orderId"])
  .index("by_store", ["storeId"])
  .index("by_store_and_method", ["storeId", "paymentMethod"])
```

Existing payment fields on `orders` table (`paymentMethod`, `cashReceived`, `changeGiven`, `cardPaymentType`, `cardReferenceNumber`) are kept for backward compatibility with existing paid orders. New payments write to `orderPayments`.

### Backend: New `processPayment` mutation

Replaces both `processCashPayment` and `processCardPayment`:

```typescript
args: {
  orderId: v.id("orders"),
  payments: v.array(v.object({
    paymentMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
    amount: v.number(),
    cashReceived: v.optional(v.number()),
    cardPaymentType: v.optional(v.string()),
    cardReferenceNumber: v.optional(v.string()),
  }))
}
```

- Validates total payments >= netSales
- Inserts one row per payment into `orderPayments`
- For cash payments: computes `changeGiven = cashReceived - amount` and writes it to the `orderPayments` row. Only the last cash payment line may have `cashReceived > amount` (generating change).
- Sets order status to "paid", `paidAt`, `paidBy`
- Releases table / advances takeout status (same as existing logic)
- Old mutations kept working — they call the new logic internally

### Updated `getReceipt` Query

The `getReceipt` return type adds a `payments` array:

```typescript
payments: v.array(v.object({
  paymentMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
  amount: v.number(),
  cashReceived: v.optional(v.number()),
  changeGiven: v.optional(v.number()),
  cardPaymentType: v.optional(v.string()),
  cardReferenceNumber: v.optional(v.string()),
}))
```

Query logic: fetch `orderPayments` by `orderId`. If rows exist, populate `payments` array. If empty (legacy order), construct a single-element `payments` array from the order's legacy fields (`paymentMethod`, `cashReceived`, etc.). The legacy single-payment fields on the return type are kept for backward compatibility but consumers should migrate to `payments`.

### Checkout UI Flow (Native)

1. Order total shows (e.g., 3,900)
2. "Add Payment" button — adds payment lines one at a time
3. Each payment line has:
   - Payment method selector (Cash / Card/E-Wallet)
   - Amount field
   - Cash: tendered input + auto-calculated change (only on last cash payment)
   - Card/e-wallet: type selector (GCash, Maya, etc.) + reference number
4. Running balance shows remaining amount (e.g., "Remaining: 1,000")
5. "Complete Payment" enables when total payments >= order total
6. Single payment method works identically to today (no UX regression)

### Validation Rules

- Total of all payment amounts must equal or exceed order total
- Each payment line must have amount > 0
- Card/e-wallet lines require payment type + reference number
- At most one cash payment can generate change (the last one, if overpaid)

### Receipt Display

```
Payment:
  Cash              P2,900.00
  GCash             P1,000.00
  Ref: 0912345678
Amount Tendered     P2,900.00
Change              P0.00
```

## 2. Counter Ordering Category

### Problem

The takeout screen is used for "pay as you order" restaurants where customers order at the counter. Currently it's hardcoded as `orderType: "takeout"` with no way to indicate if the customer is dining in or taking out.

### Solution

Add a category toggle at the top of the takeout ordering screen, before the customer name input.

New field on `orders` table:

```typescript
orderCategory: v.optional(v.union(v.literal("dine_in"), v.literal("takeout")))
```

This is separate from `orderType` which drives the takeout workflow logic. `orderCategory` is the cashier's selection that appears on receipts and kitchen tickets.

### UI Layout

```
┌─────────────────────────────────────────────────────┐
│  [Dine-in]  [Takeout]              ← toggle buttons │
│                                                      │
│  [Table Marker: ___]  [Customer Name: ___]          │
└─────────────────────────────────────────────────────┘
```

- Defaults to "Takeout"
- Styled like the existing PaymentMethodSelector toggle
- Both fields visible regardless of category

### Backend Changes

- `createDraftOrder` and `submitDraft` accept `orderCategory` and `tableMarker`
- Mutation to update `tableMarker` alongside customer name
- `orderCategory` passed through to receipts and kitchen tickets

## 3. Table Marker

### Problem

No way for the cashier to assign a tent card or table marker number to an order for kitchen runners.

### Solution

New field on `orders` table:

```typescript
tableMarker: v.optional(v.string())
```

Free text input, available for both dine-in and takeout orders. Displayed on both kitchen and customer receipts. No index needed — this field is display-only, not used for filtering or searching.

### Kitchen Ticket

Large and bold, centered — the most prominent element after the order number:

```
#T-005
==================
        15
==================
DINE-IN
Customer: Juan
------------------
1x Chicken Adobo
2x Rice
```

If no marker is set, that section is omitted.

### Customer Receipt

Appended to the order number with a pipe separator:

```
Receipt #: T-005 | 15
Date: 2026-03-28 12:30 PM
Type: DINE-IN
Customer: Juan
Cashier: Maria
```

Without marker:

```
Receipt #: T-005
```

## 4. Daily Order Number Reset

### Problem

Order numbers (T-001, T-002...) keep incrementing across days. If yesterday ended at T-053, today starts at T-054 instead of T-001.

### Root Cause

The order number generator in `orders.ts` queries today's orders **plus any open orders from previous days** to "avoid collisions in the active orders display." Those old open orders inflate the counter across days.

### Fix

Only count orders created **today** when calculating the next number. Previous-day open orders are excluded from the counter.

**Collision handling:** If a previous-day order is still open (e.g., yesterday's D-007 unpaid overnight), it keeps its old number. A new D-007 could be created today. This is acceptable because:
- The order number includes the date context on receipts (transaction date is always printed)
- The UI displays both order number and date, making them distinguishable
- Stale open orders from previous days are an edge case that should be resolved operationally (voided or paid), not by inflating today's counter

If zero orders exist today, the counter starts fresh at T-001 / D-001.

## 5. Kitchen Receipt Bug — Order Type Lost

### Problem

`CheckoutScreen.tsx` line 344 sets `tableName: isTakeout ? order.customerName || "Takeout" : tableName || ""` for takeout orders. In the ESC/POS formatter, if `tableName` is set, it prints that value as the bold header instead of the order type. So a takeout order with customer name "John" shows "JOHN" where it should show "TAKE-OUT".

### Fix

**Remove `tableName` from `KitchenTicketData`.** Replace with dedicated fields:

```typescript
interface KitchenTicketData {
  orderNumber: string;
  orderType: "dine_in" | "take_out" | "delivery";
  orderCategory?: "dine_in" | "takeout";  // from counter ordering category
  tableMarker?: string;                    // new marker field
  customerName?: string;                   // separate, never conflated
  items: KitchenTicketItem[];
  timestamp: Date;
}
```

**Remove the line** `tableName: isTakeout ? order.customerName || "Takeout" : tableName || ""` from `CheckoutScreen.tsx`. Instead, pass `tableMarker`, `customerName`, and `orderCategory` as separate fields.

**Update ESC/POS formatter** (`escposFormatter.ts`) to format each field independently:
1. Order number — always shown, large and bold
2. Table marker — if set, prominent and centered between separator lines
3. Order category (or orderType fallback) — always shown (e.g., "DINE-IN", "TAKE-OUT")
4. Customer name — own line, if set

**String mapping:** `orderCategory` values (`"dine_in"`, `"takeout"`) map to display strings `"DINE-IN"` and `"TAKEOUT"`. The existing `orderType` field on `KitchenTicketData` uses `"take_out"` (with underscore) — the formatter already handles this mapping. When `orderCategory` is present, use it for display; otherwise fall back to `orderType`.

## Migration Strategy

- Existing paid orders retain their payment data in the `orders` table fields
- New `orderPayments` table starts empty — only new payments write to it
- Receipt queries check `orderPayments` first; if empty, fall back to legacy fields on the order
- No data migration needed for existing orders
