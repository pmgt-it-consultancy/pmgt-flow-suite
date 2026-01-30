# Takeout Payment Flow + Card/E-Wallet Reference Numbers

**Commit:** 083add3  
**Branch:** feature/pos-system

## What Was Done
Implemented two changes:
1. **Takeout flow**: Pay before kitchen — create order → checkout → pay → optionally send to kitchen
2. **Card/E-Wallet payments (both flows)**: Payment type selector (GCash, Maya, Credit/Debit Card, Bank Transfer, Other) + reference number field

## Files Changed

### Backend
- `packages/backend/convex/schema.ts` — Added `cardPaymentType` and `cardReferenceNumber` optional string fields to orders table
- `packages/backend/convex/checkout.ts` — `processCardPayment` now requires `paymentType` + `referenceNumber` args; `getReceipt` returns new fields
- `packages/backend/convex/orders.ts` — `orders.get` return type and handler include new card fields

### Frontend
- `apps/native/src/features/checkout/components/CardPaymentDetails.tsx` — **New** component: chip selector for payment type + reference number input
- `apps/native/src/features/checkout/components/index.ts` — Export new component
- `apps/native/src/features/checkout/screens/CheckoutScreen.tsx` — Card payment state/validation, passes new args to mutation. Takeout post-payment shows "Send to Kitchen" / "Done" alert. Accepts `orderType` route param.
- `apps/native/src/features/shared/utils/receipt.ts` — Added `cardPaymentType`/`cardReferenceNumber` to `ReceiptData`; updated HTML to show them
- `apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx` — Includes card fields in receipt data
- `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx` — `handleSendToKitchen` → `handleCheckout`: creates order + items, navigates to CheckoutScreen instead of sending to kitchen
- `apps/native/src/navigation/Navigation.tsx` — Added `orderType` to CheckoutScreen params

## Key Patterns
- Card payment validation: both `paymentType` (not empty/"Other") and `referenceNumber` required before enabling payment
- Takeout post-payment: receipt preview → alert with "Send to Kitchen" (calls `sendToKitchenMutation` + prints kitchen ticket) or "Done" (navigates back)
- `CardPaymentDetails` uses chip/pill selector with "Other" option showing a custom text input
