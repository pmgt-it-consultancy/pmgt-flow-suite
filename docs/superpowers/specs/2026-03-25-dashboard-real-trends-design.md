# Dashboard Real Trends

## Problem

The admin dashboard "Today's Sales" card shows a hardcoded "+12% from yesterday" trend regardless of actual data (`dashboard/page.tsx:72`). This is misleading.

## Solution

Replace the hardcoded trend with real percentage comparisons across all 4 summary cards by querying yesterday's data alongside today's.

## Approach: Two Frontend Queries

Call `getDashboardSummary` twice — once for today, once for yesterday. Compute percentage changes client-side.

**Why this approach:**
- Zero backend changes — the existing query already accepts any `reportDate`
- Convex caches both reactive subscriptions efficiently (same index)
- Simple, flexible, and easy to extend later (e.g., weekly trends)

## Trend Calculation

```
computeTrend(today: number, yesterday: number) → { value: string; direction: "up" | "down" } | undefined
```

- If `yesterday === 0` or `today === 0` → return `undefined` (hide trend)
- Otherwise → `Math.round(((today - yesterday) / yesterday) * 100)`
- Return signed string (e.g., `"+23%"`, `"-8%"`) with direction

## Cards with Trends

| Card             | Today field        | Yesterday field           |
|------------------|--------------------|---------------------------|
| Today's Sales    | `netSales`         | `yesterday.netSales`      |
| Orders           | `transactionCount` | `yesterday.transactionCount` |
| Avg Order Value  | `netSales / transactionCount` | `yesterday.netSales / yesterday.transactionCount` |
| Discounts Given  | `totalDiscounts`   | `yesterday.totalDiscounts` |

## UI Changes

- Positive trends: green text (`text-green-600`), e.g., "+23% from yesterday"
- Negative trends: red text (`text-red-600`), e.g., "-8% from yesterday"
- Hidden when either day has zero data

The `SummaryCard` `trend` prop changes from `string | undefined` to `{ value: string; direction: "up" | "down" } | undefined`.

## Files Changed

**`apps/web/src/app/(admin)/dashboard/page.tsx`** (only file):
1. Add yesterday date computation
2. Add second `useQuery` call for yesterday's summary
3. Add `computeTrend` helper function
4. Update all 4 `SummaryCard` usages with computed trends
5. Update `SummaryCard` component to render green/red based on direction

## Loading State

Trends are hidden while either query is still loading (`undefined` result). Once both today and yesterday resolve, trends appear. No skeleton or spinner needed — cards already show their values from today's query; trends simply appear once yesterday's data arrives.

## Edge Cases

- Yesterday had no sales (store closed) → hide trend
- Today has no sales yet (early morning) → hide trend (user preference — avoids noisy -100% at start of day)
- Both days have data → show real percentage
- All cards use the same green-up/red-down convention including Discounts (more discounts typically correlates with higher sales volume)
- Only the "Today's Sales" card currently has a trend prop — the other 3 cards are **adding** a new trend
