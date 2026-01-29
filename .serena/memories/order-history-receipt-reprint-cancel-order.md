# Order History, Receipt Reprint & Cancel Order Implementation

## Commit: 3e304c5 on feature/pos-system

## What was implemented

### 1. Order History Screen (`apps/native/src/features/order-history/`)
- Accessible from Tables screen header (receipt icon button)
- Date range presets: Today, Yesterday, Last 7 Days, Last 30 Days
- Search by order number or customer name
- Status filter: All / Paid / Voided
- Pull-to-refresh
- Tapping an order navigates to Order Detail Screen

### 2. Order Detail Screen
- Full order breakdown: info, items, discounts, BIR tax summary
- **Reprint Receipt**: Direct thermal print (no preview), logs to `auditLogs` with action `receipt_reprint`
- **Void Order**: Reason modal → Manager PIN modal → calls `voids.voidOrder` action
- Actions only shown for paid orders

### 3. Cancel Order (Order Screen)
- Added "Cancel Order" button to `CartFooter` component
- Confirmation dialog before canceling
- Uses existing `checkout.cancelOrder` mutation

### 4. Backend additions
- `orders.getOrderHistory` query: date range, search, status filter, pagination via `by_store_createdAt` index
- `checkout.logReceiptReprint` mutation: writes audit log entry

### 5. ManagerPinModal update
- `onSuccess` callback now passes `(managerId, pin)` instead of just `(managerId)`
- Needed because `voids.voidOrder` action requires both managerId and PIN
- CheckoutScreen updated to accept extra parameter

## Files changed
- `packages/backend/convex/orders.ts` - added `getOrderHistory`
- `packages/backend/convex/checkout.ts` - added `logReceiptReprint`
- `apps/native/src/features/order-history/` - new feature module (4 files)
- `apps/native/src/features/checkout/components/ManagerPinModal.tsx` - onSuccess signature change
- `apps/native/src/features/checkout/screens/CheckoutScreen.tsx` - adapted to new signature
- `apps/native/src/features/orders/components/CartFooter.tsx` - added cancel button
- `apps/native/src/features/orders/screens/OrderScreen.tsx` - added cancel handler
- `apps/native/src/features/tables/components/Header.tsx` - added onOrderHistory prop
- `apps/native/src/features/tables/screens/TablesScreen.tsx` - wired up navigation
- `apps/native/src/navigation/Navigation.tsx` - registered new screens

## Design decisions
- Receipt numbering kept simple: uses `orderNumber` (daily reset, zero-padded 3 digits)
- No schema changes needed — `auditLogs` table already supports reprint logging
- No custom date picker dependency — presets cover primary use cases
- Running bill feature deferred to next iteration
