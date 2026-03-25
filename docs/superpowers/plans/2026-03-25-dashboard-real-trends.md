# Dashboard Real Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded "+12% from yesterday" on the admin dashboard with real percentage trends across all 4 summary cards.

**Architecture:** Call the existing `getDashboardSummary` Convex query twice (today + yesterday) from the frontend. Compute percentage changes client-side. Update the `SummaryCard` component to render green/red trends based on direction.

**Tech Stack:** Next.js, Convex (`useQuery`), TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-25-dashboard-real-trends-design.md`

---

### Task 1: Add real trends to all 4 dashboard summary cards

**Files:**
- Modify: `apps/web/src/app/(admin)/dashboard/page.tsx`

- [ ] **Step 1: Add yesterday date computation**

After line 21 (`const todayDateStr = formatDateString(now);`), add:

```typescript
const yesterday = new Date(now);
yesterday.setDate(yesterday.getDate() - 1);
const yesterdayDateStr = formatDateString(yesterday);
```

- [ ] **Step 2: Add the yesterday query**

After the existing `dashboardSummary` query (after line 35), add:

```typescript
const yesterdaySummary = useQuery(
  api.reports.getDashboardSummary,
  primaryStoreId
    ? {
        storeId: primaryStoreId,
        reportDate: yesterdayDateStr,
      }
    : "skip",
);
```

- [ ] **Step 3: Compute yesterday's derived values**

After the existing `totalDiscounts` calculation (after line 53), add:

```typescript
const yesterdaySales = yesterdaySummary?.netSales ?? 0;
const yesterdayOrders = yesterdaySummary?.transactionCount ?? 0;
const yesterdayAvgOrderValue = yesterdayOrders > 0 ? yesterdaySales / yesterdayOrders : 0;
const yesterdayDiscounts = yesterdaySummary?.totalDiscounts ?? 0;
```

- [ ] **Step 4: Add the `computeTrend` helper function**

Add after the `formatDateString` helper (after line 325):

```typescript
function computeTrend(
  today: number,
  yesterday: number,
): { value: string; direction: "up" | "down" } | undefined {
  if (yesterday === 0 || today === 0) return undefined;
  const change = Math.round(((today - yesterday) / yesterday) * 100);
  if (change === 0) return undefined;
  return {
    value: `${change > 0 ? "+" : ""}${change}% from yesterday`,
    direction: change > 0 ? "up" : "down",
  };
}
```

- [ ] **Step 5: Update `SummaryCard` to accept typed trend prop**

Replace the entire `SummaryCard` component (lines 240-266):

```typescript
function SummaryCard({
  title,
  value,
  description,
  icon,
  trend,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  trend?: { value: string; direction: "up" | "down" };
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
        <div className="text-gray-400">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-gray-500">{description}</p>
        {trend && (
          <p className={`text-xs mt-1 ${trend.direction === "up" ? "text-green-600" : "text-red-600"}`}>
            {trend.value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Replace hardcoded trend and add trends to all 4 cards**

Replace the entire `<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">` block (lines 66-92):

```tsx
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
  <SummaryCard
    title="Today's Sales"
    value={formatCurrency(todaySales)}
    description="Total net sales for today"
    icon={<DollarSign className="h-5 w-5" />}
    trend={dashboardSummary && yesterdaySummary ? computeTrend(todaySales, yesterdaySales) : undefined}
  />
  <SummaryCard
    title="Orders"
    value={todayOrders.toString()}
    description="Total transactions today"
    icon={<ShoppingCart className="h-5 w-5" />}
    trend={dashboardSummary && yesterdaySummary ? computeTrend(todayOrders, yesterdayOrders) : undefined}
  />
  <SummaryCard
    title="Avg Order Value"
    value={formatCurrency(avgOrderValue)}
    description="Average per transaction"
    icon={<TrendingUp className="h-5 w-5" />}
    trend={dashboardSummary && yesterdaySummary ? computeTrend(avgOrderValue, yesterdayAvgOrderValue) : undefined}
  />
  <SummaryCard
    title="Discounts Given"
    value={formatCurrency(totalDiscounts)}
    description="SC/PWD + other discounts"
    icon={<Users className="h-5 w-5" />}
    trend={dashboardSummary && yesterdaySummary ? computeTrend(totalDiscounts, yesterdayDiscounts) : undefined}
  />
</div>
```

- [ ] **Step 7: Verify the app compiles**

Run: `cd apps/web && npx next build --no-lint 2>&1 | tail -5`
Expected: Build succeeds with no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/(admin)/dashboard/page.tsx
git commit -m "fix: replace hardcoded dashboard trend with real percentage comparisons

Adds a second getDashboardSummary query for yesterday's data and computes
real percentage trends across all 4 summary cards. Trends are hidden when
either day has zero data."
```
