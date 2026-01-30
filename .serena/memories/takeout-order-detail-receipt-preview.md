# Takeout Order Detail Modal with Receipt Preview/Print

## What was implemented
Added the ability to view order details and preview/print receipts from the takeout list screen.

## Files changed
- **`apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx`** (new) — Modal showing full order details (items with modifiers, totals, payment info, status badge). For paid orders, includes a "Receipt Preview / Print" button that opens the existing `ReceiptPreviewModal`.
- **`apps/native/src/features/takeout/components/TakeoutOrderCard.tsx`** — Added `onPress` prop, wrapped card in `TouchableOpacity`.
- **`apps/native/src/features/takeout/components/index.ts`** — Exported `TakeoutOrderDetailModal`.
- **`apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`** — Added `selectedOrderId` state, passes `onPress` to cards, renders `TakeoutOrderDetailModal`.

## Key patterns used
- Reuses `ReceiptPreviewModal` from `../../checkout/components` for receipt display and thermal printing.
- Builds `ReceiptData` from `api.orders.get` (full order with items/modifiers), `api.stores.get`, and `api.discounts.getOrderDiscounts`.
- Uses `usePrinterStore().printReceipt()` for thermal printing.
- Receipt is only available for paid orders (`order.status === "paid"`).
- The checkout flow (`CheckoutScreen`) already handles receipt after payment; this covers viewing receipts **after the fact** from the takeout list.

## Commit
`a0a116e` on `feature/pos-system`
