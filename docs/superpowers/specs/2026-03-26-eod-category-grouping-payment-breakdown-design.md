# EOD Report: Category Grouping & Payment Transaction Breakdown

**Date:** 2026-03-26
**Status:** Approved

## Overview

Two improvements to the Z-day/end-of-day reporting across all outputs (native screen, thermal print, web page, PDF):

1. **Group products by category** with subtotals per category (currently a flat list sorted by quantity)
2. **Break down non-cash payments** into individual transactions with reference numbers for verification (currently only shows a single card/e-wallet total)

## Approach

Extend the existing report generation pattern: denormalize payment transaction details into a new `dailyPaymentTransactions` table at report generation time, just like `dailyProductSales` already works for products. Category grouping requires no schema changes — the data is already in `dailyProductSales`.

## Schema

### New Table: `dailyPaymentTransactions`

```typescript
dailyPaymentTransactions: defineTable({
  storeId: v.id("stores"),
  reportDate: v.string(),              // YYYY-MM-DD
  orderId: v.id("orders"),
  orderNumber: v.string(),             // Human-readable order number
  paymentType: v.string(),             // "GCash", "Credit Card", "Debit Card", etc.
  referenceNumber: v.string(),         // Card/e-wallet reference
  amount: v.number(),                  // Net amount paid
  paidAt: v.number(),                  // Timestamp for sorting
})
.index("by_store_date", ["storeId", "reportDate"])
```

Records are deleted and regenerated each time `generateDailyReport` runs for a given store+date (same pattern as `dailyProductSales`).

### Field Mapping & Fallbacks

Source fields on `orders` are optional (`orderNumber`, `cardReferenceNumber`, `paidAt`), but paid orders always have them set in practice. The generation helper maps with fallbacks:

| New table field | Source field | Fallback |
|---|---|---|
| `orderNumber` | `order.orderNumber` | `""` (empty string) |
| `paymentType` | `order.cardPaymentType` | `"Unknown"` |
| `referenceNumber` | `order.cardReferenceNumber` | `""` (empty string) |
| `paidAt` | `order.paidAt` | `order._creationTime` |
| `amount` | `order.netSales` | (always present on paid orders) |

### Assumptions

- One payment method per order (current schema: `paymentMethod` is a single value, not an array). If split payments are added later, this table design will need revisiting.

## Backend Changes (`reports.ts`)

### Report Generation

Add `generatePaymentTransactionsBreakdown()` helper called from `generateDailyReport`. Must be added to **both code paths** (new report creation and existing report regeneration), same as `generateProductSalesBreakdown`:
- Delete existing `dailyPaymentTransactions` for store+date
- Iterate paid orders where `paymentMethod === "card_ewallet"`
- Read from `order.cardPaymentType` and `order.cardReferenceNumber` (mapped to `paymentType` and `referenceNumber`)
- Insert one row per non-cash order with fallbacks as documented above

### New Query: `getDailyPaymentTransactions`

- Args: `storeId`, `reportDate`
- Returns transactions grouped by `paymentType`, sorted by `paidAt` within each group
- Includes computed subtotal per payment type group

### Existing Queries

`getDailyProductSales` — no changes. Category grouping is handled at the display layer.

## Native App Changes

### `ItemBreakdownCard.tsx`

Transform flat product list into category-grouped layout:
- Group products by `categoryName`
- Render category header row → product rows → subtotal row per category
- Categories sorted alphabetically, products by quantity within each category

### `DayClosingScreen.tsx`

- Add `getDailyPaymentTransactions` query
- Add new **Payment Transactions** section showing:
  - Grouped by payment type (e.g., "GCash" header)
  - Each transaction: order number, reference number, amount
  - Subtotal per group
- Pass payment transactions to thermal print formatter

### `zReportFormatter.ts`

**Items Sold section** — category-grouped format:
```
── Beverages ──────────────
Iced Coffee        3  450.00
Hot Latte          2  300.00
           Subtotal:  750.00
── Main Course ──────────────
Chicken Adobo      5  750.00
...
```

**New Payment Transactions section** after Payment Breakdown:
```
── PAYMENT TRANSACTIONS ──
── GCash ──────────────────
#1042  REF-12345    500.00
#1048  REF-67890    350.00
         Subtotal:  850.00
── Credit Card ────────────
#1055  REF-ABCDE  1,200.00
         Subtotal: 1,200.00
```

## Web App Changes

### `page.tsx` (Reports Page)

- **Product Sales tab**: Group table by category with category header rows and subtotal rows
- **Payment Methods card**: Keep Cash / Card-E-Wallet summary totals, add payment transactions table below grouped by payment type with columns: Order #, Reference Number, Amount, Time. Subtotal row per group.
- Add `getDailyPaymentTransactions` query

### `ReportPdfDocument.tsx`

- **Product Sales Breakdown**: Restructure from flat list to category-grouped with header and subtotal rows
- **Payment Methods**: Add full payment transactions detail table after cash/card summary, same grouped format

## Sort Orders

- **Products**: Categories alphabetically → products by quantity descending within each category
- **Payment transactions**: Grouped by payment type → chronological (`paidAt`) within each group
