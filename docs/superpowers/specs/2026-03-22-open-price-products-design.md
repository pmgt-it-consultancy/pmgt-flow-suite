# Open Price Products

**Date:** 2026-03-22
**Status:** Approved

## Summary

Allow products to be configured as "open price" so the cashier enters the price at order time. Primary use case: BBQ products with variable pricing.

## Decisions

| Question | Decision |
|----------|----------|
| How to mark open-price products | Per-product flag (`isOpenPrice` toggle) |
| Price validation | Min/max range per product |
| Authorization | No extra check — cashier enters freely |
| UI flow | Inline price input in existing AddItemModal |
| Product card display | Show "Enter Price" text instead of a price |

## Schema Changes

### `products` table — add 3 fields

- `isOpenPrice: boolean` — default `false`, toggleable per product
- `minPrice: optional<number>` — minimum allowed price (required when `isOpenPrice` is true)
- `maxPrice: optional<number>` — maximum allowed price (required when `isOpenPrice` is true)

Existing `price` field stays but is irrelevant for open-price products (set to `0`).

### `orderItems` table — no changes

`productPrice` already captures the price at order time. It will come from the cashier instead of the catalog.

## Backend Changes

### `addItem` mutation

Add optional `customPrice: v.optional(v.number())` arg:

- If `isOpenPrice === true` and no `customPrice` → throw error
- If `isOpenPrice === true` → validate `customPrice` within `minPrice`–`maxPrice` → use as `productPrice`
- If `isOpenPrice === false` and `customPrice` provided → ignore, use catalog price

### Product CRUD

Extend create/update mutations to accept `isOpenPrice`, `minPrice`, `maxPrice`. Validate `minPrice < maxPrice` when both provided.

## Native App Changes

### ProductCard

When `isOpenPrice === true`, display "Enter Price" instead of formatted price.

### AddItemModal

When product is open-price:

- Replace static price display with editable numeric input
- Show allowed range as helper text: "₱50 – ₱500"
- Disable "Add" button until valid price entered
- Total = entered price x quantity

### ModifierSelectionModal

Same treatment if open-price product also has modifiers — price input + modifier selection in same flow.

### Draft mode

Custom price stored alongside draft item, passed to `addItem` on order creation.

## Web Admin Changes

### Product form

Add "Open Price" toggle. When enabled:

- Show min/max price fields
- Hide or grey out regular price field

## Unchanged

- Tax calculations — operate on `productPrice` (already snapshotted)
- Receipts — display entered price like any other
- Reports/audit — prices captured in order items
- Order history — shows price that was entered
- Discounts/voids — operate on order total, unaffected
