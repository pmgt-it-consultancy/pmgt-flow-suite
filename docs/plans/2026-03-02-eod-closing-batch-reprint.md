# End-of-Day Closing & Batch Receipt Reprint

**Date:** 2026-03-02
**Status:** Approved

## Problem

Restaurant managers need to perform end-of-day reconciliation: reviewing daily sales totals and reprinting all receipts to match against physical cash/card slips. Currently, receipts can only be reprinted one at a time from Order History, and the daily report (Z-Report) only exists on the web admin.

## Solution

A dedicated **Day Closing** screen in the native app, accessible from the Home screen header with one tap. Provides:

1. **Z-Report summary** — daily sales breakdown printable to thermal receipt printer
2. **Batch receipt reprint** — select all (or specific) orders and reprint their receipts sequentially

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Closing type | Day-based (no shifts) | Covers 90% of small-to-medium restaurant use cases |
| Locking | No locking | Closing is a reporting action, not a state change. Manager can re-close. |
| Reprint scope | All paid orders, with deselect | Default select-all, manager can deselect individual orders |
| Z-Report output | Screen + thermal print | Standard POS behavior; printed Z-Report is the official closing document |
| Navigation | Header icon button on Home | One tap access, role-restricted to manager/admin |
| Batch print format | Thermal only | Uses existing Bluetooth ESC/POS infrastructure |

## Screen Layout

```
┌─────────────────────────────────────┐
│  ← Back          Day Closing        │
│         📅 [Date Picker: Today]     │
├─────────────────────────────────────┤
│  Z-REPORT SUMMARY                   │
│  ┌─────────┬─────────┬──────────┐  │
│  │ Gross   │ Net     │ Trans.   │  │
│  │ ₱12,450 │ ₱11,116 │ 47       │  │
│  └─────────┴─────────┴──────────┘  │
│  Cash: ₱8,200  Card: ₱3,250       │
│  Discounts: ₱534  Voids: 2 (₱800) │
│  VAT: ₱1,334                       │
├─────────────────────────────────────┤
│  [🖨 Print Z-Report]               │
├─────────────────────────────────────┤
│  RECEIPTS (47 orders)  [Select All] │
│  ☑ #001 Dine-In  ₱350   10:15 AM  │
│  ☑ #002 Takeout   ₱180   10:32 AM  │
│  ☑ #003 Dine-In  ₱520   11:01 AM  │
│  ☐ #004 VOIDED    ₱0     11:15 AM  │
│  ... (scrollable list)              │
├─────────────────────────────────────┤
│  [🖨 Reprint 46 Selected Receipts] │
└─────────────────────────────────────┘
```

- Date picker defaults to today; allows past dates for late reconciliation
- Voided orders shown but deselected by default
- Sticky footer with batch reprint button showing selected count
- Progress modal during batch print: "Printing 12 of 46..."

## Architecture

### Backend

**Reused functions (no changes needed):**
- `generateDailyReport(storeId, reportDate)` — aggregate Z-Report data
- `getDailyReport(storeId, reportDate)` — fetch Z-Report
- `getOrderHistory(storeId, startDate, endDate)` — list orders for date
- `getReceipt(orderId)` — get receipt data for printing
- `logReceiptReprint(orderId)` — audit each reprint

**New function:**
- `logDayClosing(storeId, reportDate)` in `packages/backend/convex/closing.ts` — audit log entry for day closing action (action: `"day_closing"`)

### Native App

**New files:**
```
src/features/day-closing/
├── screens/
│   └── DayClosingScreen.tsx       # Main screen
├── components/
│   ├── ZReportSummary.tsx         # Summary card with metrics
│   ├── OrderSelectionList.tsx     # FlashList with checkboxes
│   ├── OrderSelectionItem.tsx     # Memoized list item (React.memo)
│   └── PrintProgressModal.tsx     # Batch print progress overlay
├── hooks/
│   └── useBatchPrint.ts           # Batch printing logic + progress
└── utils/
    └── zReportFormatter.ts        # ESC/POS format for Z-Report
```

**Modified files:**
- `src/features/home/components/HomeHeader.tsx` — add "Close Day" icon button (role-gated)
- `src/navigation/Navigation.tsx` — add DayClosingScreen to stack
- `src/features/settings/services/escposFormatter.ts` — add Z-Report thermal format function (or keep in new `zReportFormatter.ts`)

### Data Flow

```
Home → [Close Day button] → DayClosingScreen
  ├─ useQuery(getDailyReport) → ZReportSummary
  ├─ useQuery(getOrderHistory) → OrderSelectionList
  │   └─ useState(selectedOrderIds) — local selection state
  ├─ [Print Z-Report] → generateDailyReport → printZReportToThermal
  └─ [Reprint Selected] → for each order:
       getReceipt → printReceiptToThermal → logReceiptReprint
       (with progress: PrintProgressModal)
```

### React Native Best Practices Applied

Per Vercel React Native skills:
- **FlashList** for order list (list-performance-virtualize)
- **React.memo** on OrderSelectionItem (list-performance-item-memo)
- **useCallback** for selection handlers (list-performance-callbacks)
- **No inline styles** in list items (list-performance-inline-objects)
- Animate only transform/opacity for progress modal (animation-gpu-properties)

## Error Handling

- Printer disconnected: Show alert, allow retry or skip
- Individual receipt print failure: Log error, skip to next, report failures at end
- No orders for date: Show empty state with message
- Report generation failure: Show error toast, allow retry
