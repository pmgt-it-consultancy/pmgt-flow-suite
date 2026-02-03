# Multi-Tab Dine-In Feature

## Overview
Implemented support for multiple separate tabs (orders) per dine-in table. A table can have multiple running bills simultaneously - e.g., friends at same table each wanting their own separate bill.

## Schema Changes

### `packages/backend/convex/schema.ts`
Added to orders table:
- `tabNumber: v.optional(v.number())` - Auto-assigned: 1, 2, 3... per table
- `tabName: v.optional(v.string())` - Default "Tab 1", editable to guest name
- Added index: `.index("by_tableId_status", ["tableId", "status"])`

## Backend Changes

### `packages/backend/convex/orders.ts`
1. **Modified `create` mutation**: Removed "Table is already occupied" validation, auto-assigns tabNumber based on existing open orders, sets tabName to "Tab {N}", only marks table "occupied" on first tab
2. **Modified `createAndSendToKitchen` mutation**: Same multi-tab logic as create
3. **Added `getOpenOrdersForTable` query**: Returns all open orders for a table with tab info
4. **Added `updateTabName` mutation**: Allows changing tab name (e.g., "Tab 2" → "John")
5. **Modified `transferTable` mutation**: Only releases source table if no other open orders remain, assigns new tabNumber at destination

### `packages/backend/convex/checkout.ts`
1. **Added `releaseTableIfLastOrder` helper**: Checks remaining open orders before releasing table
2. **Modified `processCashPayment`**: Only releases table if this was the LAST open order
3. **Modified `processCardPayment`**: Same smart release logic
4. **Modified `cancelOrder`**: Same smart release logic

### `packages/backend/convex/tables.ts`
1. **Modified `listWithOrders` query**: Returns array of orders per table (not single order), includes aggregated totals (totalTabs, totalItemCount, totalNetSales)

## Native UI Changes

### `apps/native/src/features/tables/`
1. **New component: `TabSelectionModal.tsx`**: Shows when tapping occupied table with 2+ tabs, lists existing tabs with name/item count/total, "Add New Tab" button
2. **Modified `TablesScreen.tsx`**: Tab selection flow - 1 tab goes directly, 2+ tabs shows modal
3. **Modified `TableCard.tsx`**: Shows aggregated info for multi-tab tables

### `apps/native/src/features/orders/`
1. **New component: `EditTabNameModal.tsx`**: Text input to change tab name
2. **Modified `OrderScreen.tsx`**: Shows tab name in header, edit functionality, "+" button to add new tab, guards for order loading state
3. **Modified `OrderHeader.tsx`**: Displays tab info, edit action, add new tab button

### `apps/native/src/features/checkout/`
1. **Modified `CheckoutScreen.tsx`**: Post-payment navigation goes to TablesScreen (not HomeScreen) for dine-in orders so user can see remaining tabs

## Key Behaviors
- **Tab numbers**: Auto-increment per table, not recycled within session
- **Table release**: Only when ALL tabs are paid/closed
- **Tab naming**: Default "Tab {N}", editable to guest name
- **PAX**: Per-tab, not per-table
- **Transfer**: Tab gets new number at destination, source released only if empty
