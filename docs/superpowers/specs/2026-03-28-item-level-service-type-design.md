# Item-Level Service Type (Dine In / Takeout) Design

**Date:** 2026-03-28
**Status:** Approved

## Problem

Currently, all items in an order inherit the order-level type (dine-in or takeout). In practice, a dine-in table may want some items packed for takeout, or a takeout customer may eat one item on-site. The kitchen has no way to know which items need different handling, and the customer receipt doesn't reflect the distinction.

## Solution

Add a `serviceType` field to each order item that defaults to the parent order's type but can be overridden per-item before sending to kitchen.

## Requirements

- Item-level dine-in/takeout designation on `orderItems`
- Order-level type sets the default; each item has a segmented control to override
- Applies to both dine-in and takeout order flows
- Kitchen ticket: items grouped by service type when mixed
- Customer receipt: exception items tagged with `(TAKEOUT)` or `(DINE IN)`
- Designation locked after item is sent to kitchen (`isSentToKitchen: true`)

## Schema

Add to `orderItems` table:

```typescript
serviceType: v.optional(v.union(v.literal("dine_in"), v.literal("takeout")))
```

Optional for backward compatibility with existing items. Code falls back to parent order's type when `serviceType` is undefined.

## Backend

### `addItem` mutation

- Accept new optional arg `serviceType?: "dine_in" | "takeout"`
- If not provided, resolve default from parent order:
  - Regular orders: use `order.orderType` (map `"takeout"` to `"takeout"`, `"dine_in"` to `"dine_in"`)
  - Draft orders: use `order.orderCategory` (fallback to `"takeout"` if unset, since drafts have `orderType: "takeout"`)
- Store `serviceType` on the created `orderItem`

### `createAndSendToKitchen` mutation

- Accept per-item `serviceType` in the items array
- Same default resolution as `addItem` — falls back to parent order's type
- Items created through this path get `isSentToKitchen: true` immediately, so their service type is locked from creation

### `updateItemServiceType` mutation (new)

- Args: `orderId`, `itemId`, `serviceType`
- Guards: throw error if `isSentToKitchen === true` (follows same pattern as `updateItemQuantity`)
- Updates the `serviceType` field on the specified `orderItem`

### `bulkUpdateItemServiceType` mutation (new)

- Args: `orderId`, `serviceType`
- Updates `serviceType` on all unsent items (`isSentToKitchen !== true`) for the given order
- Called when the order-level type changes (e.g., toggling `orderCategory` in draft flow)
- The existing `updateCustomerName` mutation (which handles `orderCategory` changes) should call this internally or the frontend should call it alongside

### No new indexes needed

Items are always queried by `orderId` (existing `by_order` index). Grouping by `serviceType` is done in-memory when building receipt data.

### Lock rule

Enforced at **both** backend and frontend:
- **Backend:** `updateItemServiceType` throws if `isSentToKitchen === true` (consistent with existing `updateItemQuantity` pattern)
- **Frontend:** DINE IN / TAKEOUT toggle is disabled when `isSentToKitchen: true`

### Query return validators

`getOrder`, `getOrdersByStore`, and `getOrderHistory` return validators must be extended to include `serviceType` in the order items response.

## Native App UI

### Cart item list

Each item row has a **DINE IN | TAKEOUT** segmented control (top-right of the item row).

**States:**
- **Default (matches order type):** White background. Active segment highlighted in blue (`#DBEAFE` bg, `#0D87E1` text).
- **Overridden (differs from order type):** Amber row tint (`#FFFBEB`), left border (`3px solid #F59E0B`), "Packed for takeout" hint text (`#D97706`). Active segment in amber (`#FEF3C7` bg, `#D97706` text).
- **Locked (sent to kitchen):** Row at reduced opacity, toggle grayed out and disabled (`#F3F4F6` bg, `#9CA3AF` text).

### Default behavior

When the order-level type changes (e.g., toggling `orderCategory` in the draft flow), all **unsent** items should update their `serviceType` to match. Items already sent to kitchen remain unchanged.

## Kitchen Ticket

Changes only to the items section of `printKitchenTicketToThermal`. Everything above (order number, table marker, order category, customer name, timestamp) stays unchanged.

### Mixed orders (items have different service types)

Items grouped under bold designation headers:

```
---- DINE IN ----
  2x Chicken Adobo
  1x Sinigang na Baboy
     * Extra rice
  3x Plain Rice

---- TAKEOUT ----
  1x Lechon Kawali
  1x Pancit Canton
     > No veggies
```

### Uniform orders (all items same service type)

No grouping headers. Prints exactly as today.

## Interface Changes

### `KitchenTicketItem`

Add `serviceType?: "dine_in" | "takeout"` to the existing interface in `escposFormatter.ts`.

### `ReceiptItem` (in `receipt.ts`)

Add `serviceType?: "dine_in" | "takeout"` to the existing receipt item type.

### `KitchenTicketData`

Add `orderDefaultServiceType?: "dine_in" | "takeout"` to enable mixed vs. uniform detection in the formatter.

## Customer Receipt

Changes to the items loop in both `printReceiptToThermal` (thermal printer) and `generateReceiptHtml` (on-screen preview / PDF share) in the receipt utilities.

### Mixed orders

Exception items (those differing from the order's default type) get a suffix on the item name line:

```
Chicken Adobo
  2x ₱270.00                    ₱540.00
Lechon Kawali (TAKEOUT)
  1x ₱320.00                    ₱320.00
```

### Uniform orders

No tags. Receipt prints exactly as today.

## Web Admin

The order detail view in `apps/web/src/app/(admin)/orders/` should display per-item service type for mixed orders. Minimal change — show a small badge next to exception items, consistent with the customer receipt tagging approach.

## Backward Compatibility

- `serviceType` is `v.optional(...)` so existing `orderItems` rows are unaffected
- When reading items without `serviceType`, fall back to the parent order's `orderType` or `orderCategory`
- Kitchen ticket and customer receipt formatting only activates grouping/tagging when items have mixed service types
- Reprinting receipts for historical orders (via order history screens) works identically to today — no grouping headers, no tags, since all items will resolve to the same fallback type

## Edge Cases

- **Voided items:** Excluded when determining if an order is "mixed" for formatting purposes. Only active (non-voided) items are considered.
- **Historical reprints:** Orders created before this feature have no `serviceType` on items. Fallback to parent order type means they print as uniform orders — identical to current behavior.

## Approach Rejected

- **Separate packing list table:** Over-engineered for a boolean distinction
- **Zone-based system:** Violates YAGNI; simple field migration is straightforward if ever needed
