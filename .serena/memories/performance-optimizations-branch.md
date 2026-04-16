# Performance Optimizations Branch

**Branch:** `performance-optimizations`
**Base:** `feature/pos-system`
**Current version:** 3.20.1
**Date:** 2026-04-14

## Work Done on This Branch

### Performance (latest)
- `aa61e7f` — Memoized list items, virtualized orders list, hoisted Intl formatter out of render loops

### Web Fixes
- `3b77b07` — Made select dropdown height viewport-aware
- `7f7fa60` — Restored scrolling in select dropdowns
- `f5a2c6b` — Included inactive products in admin filter

### Takeout Running Bill (v3.20.0)
- Send to Kitchen button for all open takeout orders
- Moved kitchen receipt actions to TakeoutOrderScreen
- Smart kitchen button for running bill workflow

### Advance Takeout Orders (v3.19.x)
- Send to kitchen without requiring payment first
- Kitchen receipt button no longer requires customer receipt print
- Alert when kitchen printing is disabled for advance orders
- Direct printer connection for advance order kitchen receipts

### Service Type Feature (v3.18.x)
- Item-level dine-in/takeout service type tagging
- Segmented control on CartItem for toggling service type
- Service type on receipts, kitchen tickets, and order details
- Bulk update mutation for service type changes
- Kitchen ticket items grouped by service type for mixed orders

### Void Paid Orders / Refund & Re-ring (v3.17.x)
- `voidPaidOrder` action with re-ring mutation
- Refund item flow on native (OrderDetailScreen, TakeoutOrderDetailModal) and web admin
- Refund void type and `refundedFromOrderId` in schema
- "Refunded" badge on replacement orders

### Split Payments & Counter Ordering (v3.16.0)
- `orderPayments` table for multiple payment methods per order
- `processPayment` mutation with payments array
- Split payment UI with multiple payment lines
- Category toggle (dine-in/takeout) and table marker on takeout screen
- Receipt and Z-report updates for split payments

### TanStack Form Migration (v3.15.0)
- Migrated admin pages (tables, roles, categories, modifiers, stores, products, users) from Zustand + React Hook Form to TanStack Form
- Inline entity creation (categories, roles, modifier groups)
- Colocated page architecture with `_components/`, `_hooks/`, `_stores/` folders

### End-of-Day Reporting (v3.14.0)
- Date navigation bar with day arrows and calendar picker
- Item breakdown card for product sales display
- Time range selector (Full Day / Custom) for Z-reports
- PDF export via @react-pdf/renderer
- Products grouped by category in reports

### Earlier Features
- Duplicate transaction prevention (idempotent mutations, requestId dedup)
- Draft takeout orders (create/submit/discard/cleanup)
- Open-price products (custom pricing with min/max range)
- Dashboard real percentage trends
- Products category/status filtering

## Uncommitted Changes (as of 2026-04-14)
- Extensive native app component modifications across checkout, orders, home, lock, day-closing, order-history features
- Android config changes (strings.xml, settings.gradle)
- Deleted Android Java files (MainActivity.kt, MainApplication.kt)
- Modified `.serena/project.yml`

These uncommitted changes appear to be part of the performance optimization work (memoization, virtualization, etc.) applied across many components.
