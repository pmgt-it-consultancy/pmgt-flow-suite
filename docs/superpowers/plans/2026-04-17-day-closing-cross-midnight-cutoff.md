# Day Closing Cross-Midnight Cutoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Day Closing aggregate late-night shifts correctly. (1) Fix `getPHTTimeBoundariesForDate` so cross-midnight custom ranges resolve to a valid window instead of an inverted empty one. (2) Wire `store.schedule` into Day Closing's aggregation path so a store that closes at 01:00 gets a single continuous Z-Report. (3) Surface the cross-midnight semantics in the native `TimeRangeSelector` and printed Z-Report.

**Architecture:** Additive backend helper `getReportBoundariesForDate` in `lib/businessDay.ts` centralizes the "full day vs. custom range vs. schedule fallback" decision. All four Day Closing aggregation call sites in `reports.ts` migrate to it and start passing `store.schedule`. `getPHTTimeBoundariesForDate` gains a cross-midnight branch. Native `TimeRangeSelector` reads the store schedule and defaults Custom Range to today's slot while showing a "(next day)" hint when end ≤ start.

**Tech Stack:** Convex (backend schema, queries, mutations), Vitest + convex-test (backend tests), React Native 0.81 + Expo 54, Tamagui (UI).

**Spec reference:** `docs/superpowers/specs/2026-04-17-day-closing-cross-midnight-cutoff-design.md`

**Branch strategy:** Create a feature branch from `main` before Task 1 (e.g. `git checkout -b feat/day-closing-cross-midnight`). All commits in this plan target that branch.

---

## File Structure

**Created:**
- `packages/backend/convex/reports.test.ts` — integration test coverage for schedule-aware Day Closing aggregation.

**Modified:**
- `packages/backend/convex/lib/dateUtils.ts` — cross-midnight branch in `getPHTTimeBoundariesForDate`.
- `packages/backend/convex/lib/dateUtils.test.ts` — cross-midnight coverage.
- `packages/backend/convex/lib/businessDay.ts` — new `getReportBoundariesForDate` helper.
- `packages/backend/convex/lib/businessDay.test.ts` — new helper coverage.
- `packages/backend/convex/reports.ts` — migrate 4 aggregation call sites + load store in `generateDailyReport` and `getHourlySales`.
- `apps/native/src/features/day-closing/components/TimeRangeSelector.tsx` — accept `scheduleSlot` prop, default Custom Range from it, render `(next day)` hint.
- `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx` — compute current weekday's schedule slot and pass to `TimeRangeSelector`.
- `apps/native/src/features/day-closing/utils/zReportFormatter.ts` — append `(next day)` to the printed time-range line when cross-midnight.

---

## Task 1: Fix `getPHTTimeBoundariesForDate` cross-midnight

**Files:**
- Modify: `packages/backend/convex/lib/dateUtils.ts:59-80`
- Test: `packages/backend/convex/lib/dateUtils.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/convex/lib/dateUtils.test.ts`:

```ts
import { getPHTTimeBoundariesForDate } from "./dateUtils";

describe("getPHTTimeBoundariesForDate", () => {
  it("returns full-day boundaries when no times given", () => {
    const { start, end } = getPHTTimeBoundariesForDate("2026-04-16");
    // Apr 16 00:00 PHT = Apr 15 16:00 UTC
    expect(start).toBe(utc("2026-04-15T16:00:00Z"));
    // end is one second before next midnight in the current implementation
    expect(end - start).toBe(24 * 60 * 60 * 1000 - 1000);
  });

  it("returns same-day range for startTime < endTime", () => {
    const { start, end } = getPHTTimeBoundariesForDate("2026-04-16", "06:00", "22:00");
    // Apr 16 06:00 PHT = Apr 15 22:00 UTC
    expect(start).toBe(utc("2026-04-15T22:00:00Z"));
    // Apr 16 22:00 PHT = Apr 16 14:00 UTC
    expect(end).toBe(utc("2026-04-16T14:00:00Z"));
    expect(end - start).toBe(16 * 60 * 60 * 1000);
  });

  it("rolls end to the next day when endTime <= startTime (cross-midnight)", () => {
    const { start, end } = getPHTTimeBoundariesForDate("2026-04-16", "17:00", "01:00");
    // Apr 16 17:00 PHT = Apr 16 09:00 UTC
    expect(start).toBe(utc("2026-04-16T09:00:00Z"));
    // Apr 17 01:00 PHT = Apr 16 17:00 UTC
    expect(end).toBe(utc("2026-04-16T17:00:00Z"));
    expect(end - start).toBe(8 * 60 * 60 * 1000);
  });

  it("treats equal start/end (both provided) as a 24-hour window", () => {
    const { start, end } = getPHTTimeBoundariesForDate("2026-04-16", "17:00", "17:00");
    expect(end - start).toBe(24 * 60 * 60 * 1000);
  });

  it("ignores partial times (startTime only) — no rollover", () => {
    const { start, end } = getPHTTimeBoundariesForDate("2026-04-16", "06:00");
    // start at 06:00 PHT, end at 23:59:59 PHT — no cross-midnight
    expect(end).toBeGreaterThan(start);
    expect(end - start).toBeLessThan(24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && pnpm vitest run lib/dateUtils.test.ts`
Expected: the cross-midnight test FAILS because today `end < start` (end is on the same date as start).

- [ ] **Step 3: Patch `getPHTTimeBoundariesForDate`**

In `packages/backend/convex/lib/dateUtils.ts`, replace the body of `getPHTTimeBoundariesForDate` (lines 59-80) with:

```ts
export function getPHTTimeBoundariesForDate(
  dateStr: string,
  startTime?: string,
  endTime?: string,
): { start: number; end: number } {
  const midnightUTC = new Date(dateStr).getTime();
  const midnightPHT = midnightUTC - PHT_OFFSET_MS;
  const DAY_MS = 24 * 60 * 60 * 1000;

  if (!startTime && !endTime) {
    return { start: midnightPHT, end: midnightPHT + DAY_MS };
  }

  const parseTime = (time: string): number => {
    const [h, m] = time.split(":").map(Number);
    return (h * 60 + m) * 60 * 1000;
  };

  const startMs = startTime ? parseTime(startTime) : 0;
  const endMs = endTime ? parseTime(endTime) : DAY_MS - 1000;
  // Only roll end to next day when BOTH times are provided and the range
  // wraps through midnight (or is the full 24h sentinel where end === start).
  const crossesMidnight = !!startTime && !!endTime && endMs <= startMs;

  const start = midnightPHT + startMs;
  const end = midnightPHT + (crossesMidnight ? endMs + DAY_MS : endMs);

  return { start, end };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && pnpm vitest run lib/dateUtils.test.ts`
Expected: all 5 new cases PASS, plus existing `getPHTDayBoundaries*` / `getPHTHour` cases remain green.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/dateUtils.ts packages/backend/convex/lib/dateUtils.test.ts
git commit -m "fix(backend): roll end to next day when custom time range crosses midnight"
```

---

## Task 2: Add `getReportBoundariesForDate` helper

**Files:**
- Modify: `packages/backend/convex/lib/businessDay.ts` (append export)
- Test: `packages/backend/convex/lib/businessDay.test.ts` (append describe block)

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/convex/lib/businessDay.test.ts`:

```ts
import { getReportBoundariesForDate } from "./businessDay";
import { getPHTTimeBoundariesForDate, getPHTDayBoundariesForDate } from "./dateUtils";

describe("getReportBoundariesForDate", () => {
  it("delegates to getPHTTimeBoundariesForDate when both times provided", () => {
    const result = getReportBoundariesForDate(undefined, "2026-04-16", "17:00", "01:00");
    const expected = getPHTTimeBoundariesForDate("2026-04-16", "17:00", "01:00");
    expect(result).toEqual(expected);
  });

  it("same result regardless of schedule when both times provided (explicit override)", () => {
    const resultWithSchedule = getReportBoundariesForDate(
      restaurantSchedule,
      "2026-04-16",
      "10:00",
      "12:00",
    );
    const resultWithoutSchedule = getReportBoundariesForDate(
      undefined,
      "2026-04-16",
      "10:00",
      "12:00",
    );
    expect(resultWithSchedule).toEqual(resultWithoutSchedule);
  });

  it("uses schedule business-day boundaries when no times given and schedule defined", () => {
    // 2026-04-16 is a Thursday → restaurantSchedule.thursday = { open: 10:00, close: 01:00 (next day) }
    const result = getReportBoundariesForDate(restaurantSchedule, "2026-04-16");
    // Apr 16 10:00 PHT = Apr 16 02:00 UTC
    expect(result.start).toBe(utc("2026-04-16T02:00:00Z"));
    // Apr 17 01:00 PHT = Apr 16 17:00 UTC
    expect(result.end).toBe(utc("2026-04-16T17:00:00Z"));
  });

  it("falls back to PHT midnight boundaries when no times and no schedule", () => {
    const result = getReportBoundariesForDate(undefined, "2026-04-16");
    const expected = getPHTDayBoundariesForDate("2026-04-16");
    expect(result.start).toBe(expected.startOfDay);
    expect(result.end).toBe(expected.endOfDay);
  });

  it("treats partial times as absent (uses schedule path)", () => {
    const onlyStart = getReportBoundariesForDate(
      restaurantSchedule,
      "2026-04-16",
      "18:00",
      undefined,
    );
    const noTimes = getReportBoundariesForDate(restaurantSchedule, "2026-04-16");
    expect(onlyStart).toEqual(noTimes);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && pnpm vitest run lib/businessDay.test.ts`
Expected: all 5 new cases FAIL with "getReportBoundariesForDate is not a function" (or TypeScript compilation error).

- [ ] **Step 3: Implement the helper**

Append to `packages/backend/convex/lib/businessDay.ts`:

```ts
import { getPHTTimeBoundariesForDate, getPHTDayBoundariesForDate } from "./dateUtils";

/**
 * Resolves the time window for a daily report, choosing between:
 *   1. An explicit custom range (both startTime AND endTime given) — honors
 *      cross-midnight via getPHTTimeBoundariesForDate.
 *   2. The store's schedule, when defined.
 *   3. PHT midnight-to-midnight fallback.
 *
 * A partial custom range (only one of startTime/endTime) is treated as no
 * custom range — the schedule path is used. This matches the UI contract
 * where both time pickers must be set to engage a custom range.
 */
export function getReportBoundariesForDate(
  schedule: StoreSchedule | undefined,
  dateStr: string,
  startTime?: string,
  endTime?: string,
): { start: number; end: number } {
  if (startTime && endTime) {
    return getPHTTimeBoundariesForDate(dateStr, startTime, endTime);
  }
  if (schedule) {
    const { startOfDay, endOfDay } = getBusinessDayBoundariesForDate(schedule, dateStr);
    return { start: startOfDay, end: endOfDay };
  }
  const { startOfDay, endOfDay } = getPHTDayBoundariesForDate(dateStr);
  return { start: startOfDay, end: endOfDay };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && pnpm vitest run lib/businessDay.test.ts`
Expected: all new cases PASS, existing `getBusinessDayBoundaries*` cases remain green.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/businessDay.ts packages/backend/convex/lib/businessDay.test.ts
git commit -m "feat(backend): add getReportBoundariesForDate helper for Day Closing aggregation"
```

---

## Task 3: Migrate `aggregateDailyData` to schedule-aware boundaries

**Files:**
- Modify: `packages/backend/convex/reports.ts:48-158` (`generateDailyReport`), `161-314` (`aggregateDailyData`)

- [ ] **Step 1: Update `aggregateDailyData` signature**

In `packages/backend/convex/reports.ts`, change the import line near the top:

```ts
import {
  getBusinessDayBoundaries,
  getBusinessDayBoundariesForDate,
  getReportBoundariesForDate,
  type StoreSchedule,
} from "./lib/businessDay";
```

Change the signature of `aggregateDailyData` (around line 161):

```ts
async function aggregateDailyData(
  ctx: { db: any },
  storeId: Id<"stores">,
  reportDate: string,
  schedule: StoreSchedule | undefined,
  startTime?: string,
  endTime?: string,
): Promise<{ /* unchanged return shape */ }> {
```

Replace the first three lines of its body (the current `const { start: startOfDay, end: endOfDay } = getPHTTimeBoundariesForDate(reportDate, startTime, endTime);`) with:

```ts
  const { start: startOfDay, end: endOfDay } = getReportBoundariesForDate(
    schedule,
    reportDate,
    startTime,
    endTime,
  );
```

- [ ] **Step 2: Export `StoreSchedule` from businessDay.ts (if not already)**

Verify `packages/backend/convex/lib/businessDay.ts` already has `export type StoreSchedule = ...`. If not, change the declaration to `export type StoreSchedule = Record<WeekdayKey, DaySchedule>;`.

- [ ] **Step 3: Load store in `generateDailyReport` and thread `schedule` through**

In `generateDailyReport` (starts ~line 48), immediately after the auth check, insert:

```ts
    const store = await ctx.db.get(args.storeId);
    const schedule = store?.schedule;
```

Then pass `schedule` to both `aggregateDailyData` calls (existing report path around line 73 and new report path around line 114). Example for the new-report path:

```ts
    const reportData = await aggregateDailyData(
      ctx,
      args.storeId,
      args.reportDate,
      schedule,
      args.startTime,
      args.endTime,
    );
```

Do the same for the existing-report path. Do NOT touch `generateProductSalesBreakdown` / `generatePaymentTransactionsBreakdown` calls yet — they are migrated in Task 4.

- [ ] **Step 4: Run backend tests to confirm no regression**

Run: `cd packages/backend && pnpm vitest run`
Expected: all existing tests PASS. (No new test yet — integration coverage is in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/reports.ts
git commit -m "refactor(backend): use schedule-aware boundaries in aggregateDailyData"
```

---

## Task 4: Migrate `generateProductSalesBreakdown` and `generatePaymentTransactionsBreakdown`

**Files:**
- Modify: `packages/backend/convex/reports.ts:322-462` (`generateProductSalesBreakdown`), `465-537` (`generatePaymentTransactionsBreakdown`), and their call sites inside `generateDailyReport`.

- [ ] **Step 1: Update `generateProductSalesBreakdown` signature**

Change:

```ts
async function generateProductSalesBreakdown(
  ctx: { db: any },
  storeId: Id<"stores">,
  reportDate: string,
  schedule: StoreSchedule | undefined,
  startTime?: string,
  endTime?: string,
): Promise<void> {
```

Replace its boundary computation with:

```ts
  const { start: startOfDay, end: endOfDay } = getReportBoundariesForDate(
    schedule,
    reportDate,
    startTime,
    endTime,
  );
```

- [ ] **Step 2: Update `generatePaymentTransactionsBreakdown` signature**

Same pattern:

```ts
async function generatePaymentTransactionsBreakdown(
  ctx: { db: any },
  storeId: Id<"stores">,
  reportDate: string,
  schedule: StoreSchedule | undefined,
  startTime?: string,
  endTime?: string,
): Promise<void> {
```

Replace its boundary computation with the same `getReportBoundariesForDate(...)` call.

- [ ] **Step 3: Update both call sites inside `generateDailyReport`**

For each of the two calls (existing-report and new-report paths) pass the `schedule` loaded in Task 3:

```ts
    await generateProductSalesBreakdown(
      ctx,
      args.storeId,
      args.reportDate,
      schedule,
      args.startTime,
      args.endTime,
    );

    await generatePaymentTransactionsBreakdown(
      ctx,
      args.storeId,
      args.reportDate,
      schedule,
      args.startTime,
      args.endTime,
    );
```

- [ ] **Step 4: Run backend tests**

Run: `cd packages/backend && pnpm vitest run`
Expected: all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/reports.ts
git commit -m "refactor(backend): use schedule-aware boundaries in Z-report breakdowns"
```

---

## Task 5: Migrate `getHourlySales`

**Files:**
- Modify: `packages/backend/convex/reports.ts:991-1060` (`getHourlySales`)

- [ ] **Step 1: Load store and use new helper**

In `getHourlySales` handler, after the auth check and before the boundary computation, load the store:

```ts
    const store = await ctx.db.get(args.storeId);
```

Replace:

```ts
    const { start: startOfDay, end: endOfDay } = getPHTTimeBoundariesForDate(
      args.reportDate,
      args.startTime,
      args.endTime,
    );
```

with:

```ts
    const { start: startOfDay, end: endOfDay } = getReportBoundariesForDate(
      store?.schedule,
      args.reportDate,
      args.startTime,
      args.endTime,
    );
```

- [ ] **Step 2: Remove the now-unused `getPHTTimeBoundariesForDate` import (if no other callers)**

Check: `grep -n "getPHTTimeBoundariesForDate" packages/backend/convex/reports.ts` — after this task the symbol should have zero usages in reports.ts. Remove it from the import statement at the top of the file.

It remains imported (and tested) in `lib/dateUtils.ts` and transitively used by `lib/businessDay.ts`. Do not delete the export.

- [ ] **Step 3: Run backend tests**

Run: `cd packages/backend && pnpm vitest run`
Expected: all existing tests PASS, `pnpm typecheck` clean.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/reports.ts
git commit -m "refactor(backend): use schedule-aware boundaries in getHourlySales"
```

---

## Task 6: Integration test — schedule-aware Day Closing aggregation

**Files:**
- Create: `packages/backend/convex/reports.test.ts`

- [ ] **Step 1: Scaffold test file**

Create `packages/backend/convex/reports.test.ts` with the following content:

```ts
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2026-04-16 is a Thursday PHT. 17:00 PHT Thu = 09:00 UTC Thu.
// 00:30 PHT Fri = 16:30 UTC Thu.
const THU_APR_16 = "2026-04-16";
const UTC_THU_APR_16_18_00 = new Date("2026-04-16T10:00:00Z").getTime(); // 18:00 PHT Thu
const UTC_FRI_APR_17_00_30 = new Date("2026-04-16T16:30:00Z").getTime(); // 00:30 PHT Fri

const LATE_NIGHT_SCHEDULE = {
  monday: { open: "17:00", close: "01:00" },
  tuesday: { open: "17:00", close: "01:00" },
  wednesday: { open: "17:00", close: "01:00" },
  thursday: { open: "17:00", close: "01:00" },
  friday: { open: "17:00", close: "01:00" },
  saturday: { open: "17:00", close: "01:00" },
  sunday: { open: "17:00", close: "01:00" },
};

async function setupStoreWithSchedule(t: any, schedule?: any) {
  const roleId = await t.run(async (ctx: any) =>
    ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["reports.view", "reports.generate"],
      scopeLevel: "branch",
      isSystem: false,
    }),
  );
  const storeId = await t.run(async (ctx: any) =>
    ctx.db.insert("stores", {
      name: "Kusina ng Nanay",
      address1: "1 Test St",
      tin: "111-222-333-000",
      min: "MIN-000001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
      ...(schedule ? { schedule } : {}),
    }),
  );
  const userId = await t.run(async (ctx: any) =>
    ctx.db.insert("users", {
      name: "Cashier",
      email: "c@test.com",
      roleId,
      storeId,
      isActive: true,
    }),
  );
  return { storeId, userId };
}

async function seedPaidOrder(
  t: any,
  opts: { storeId: any; userId: any; createdAt: number; netSales: number },
) {
  await t.run(async (ctx: any) => {
    return ctx.db.insert("orders", {
      storeId: opts.storeId,
      orderNumber: "D-001",
      status: "paid",
      orderType: "dine_in",
      grossSales: opts.netSales,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: opts.netSales,
      netSales: opts.netSales,
      discountAmount: 0,
      createdBy: opts.userId,
      createdAt: opts.createdAt,
      paidAt: opts.createdAt,
      paidBy: opts.userId,
    });
  });
}

describe("generateDailyReport — schedule-aware boundaries", () => {
  it("includes 00:30 Fri order in Thu's report when schedule closes at 01:00", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupStoreWithSchedule(t, LATE_NIGHT_SCHEDULE);
    const asUser = t.withIdentity({ subject: userId });

    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_THU_APR_16_18_00, netSales: 500 });
    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_FRI_APR_17_00_30, netSales: 300 });

    await asUser.mutation(api.reports.generateDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    const report = await asUser.query(api.reports.getDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    expect(report?.transactionCount).toBe(2);
    expect(report?.grossSales).toBe(800);
  });

  it("custom range 17:00–01:00 matches schedule-aware Full Day", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupStoreWithSchedule(t, LATE_NIGHT_SCHEDULE);
    const asUser = t.withIdentity({ subject: userId });

    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_THU_APR_16_18_00, netSales: 500 });
    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_FRI_APR_17_00_30, netSales: 300 });

    await asUser.mutation(api.reports.generateDailyReport, {
      storeId,
      reportDate: THU_APR_16,
      startTime: "17:00",
      endTime: "01:00",
    });

    const report = await asUser.query(api.reports.getDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    expect(report?.transactionCount).toBe(2);
    expect(report?.grossSales).toBe(800);
  });

  it("store without schedule uses PHT midnight — excludes 00:30 Fri order from Thu", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupStoreWithSchedule(t); // no schedule
    const asUser = t.withIdentity({ subject: userId });

    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_THU_APR_16_18_00, netSales: 500 });
    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_FRI_APR_17_00_30, netSales: 300 });

    await asUser.mutation(api.reports.generateDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    const report = await asUser.query(api.reports.getDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    expect(report?.transactionCount).toBe(1);
    expect(report?.grossSales).toBe(500);
  });

  it("store without schedule + cross-midnight custom range works", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupStoreWithSchedule(t);
    const asUser = t.withIdentity({ subject: userId });

    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_THU_APR_16_18_00, netSales: 500 });
    await seedPaidOrder(t, { storeId, userId, createdAt: UTC_FRI_APR_17_00_30, netSales: 300 });

    await asUser.mutation(api.reports.generateDailyReport, {
      storeId,
      reportDate: THU_APR_16,
      startTime: "17:00",
      endTime: "01:00",
    });

    const report = await asUser.query(api.reports.getDailyReport, {
      storeId,
      reportDate: THU_APR_16,
    });

    expect(report?.transactionCount).toBe(2);
    expect(report?.grossSales).toBe(800);
  });
});
```

- [ ] **Step 2: Run the test file to verify it passes**

Run: `cd packages/backend && pnpm vitest run reports.test.ts`
Expected: all 4 cases PASS. The fixes from Tasks 1–5 are what make them green.

- [ ] **Step 3: Run the full backend suite**

Run: `cd packages/backend && pnpm vitest run`
Expected: full suite green.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/reports.test.ts
git commit -m "test(backend): cover schedule-aware Day Closing aggregation and cross-midnight custom range"
```

---

## Task 7: Native — default Custom Range from schedule + "(next day)" hint

**Files:**
- Modify: `apps/native/src/features/day-closing/components/TimeRangeSelector.tsx`
- Modify: `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx`

- [ ] **Step 1: Extend `TimeRangeSelector` props and defaults**

In `apps/native/src/features/day-closing/components/TimeRangeSelector.tsx`, extend the interface:

```ts
interface TimeRangeSelectorProps {
  startTime: string | undefined;
  endTime: string | undefined;
  onTimeRangeChange: (startTime: string | undefined, endTime: string | undefined) => void;
  scheduleSlot?: { open: string; close: string };
}
```

Change the destructure and `handleModeChange("custom")` branch:

```ts
export const TimeRangeSelector = ({
  startTime,
  endTime,
  onTimeRangeChange,
  scheduleSlot,
}: TimeRangeSelectorProps) => {
  // ... existing state ...

  const handleModeChange = (newMode: Mode) => {
    if (newMode === "full") {
      onTimeRangeChange(undefined, undefined);
    } else {
      const defaultStart = scheduleSlot?.open ?? "06:00";
      const defaultEnd = scheduleSlot?.close ?? "22:00";
      onTimeRangeChange(defaultStart, defaultEnd);
    }
  };
```

- [ ] **Step 2: Render the "(next day)" hint**

Compute `crossesMidnight` inside the component:

```ts
const crossesMidnight = !!startTime && !!endTime && endTime <= startTime;
```

Inside the custom-range `<XStack gap={10}>` block, beneath the end-time `<Pressable>`, add a small wrapper so the hint renders under the button. Replace the existing end-time `<Pressable>` with:

```tsx
          <YStack flex={1} gap={2}>
            <Pressable
              android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
              onPress={() => setShowEndPicker(true)}
              style={({ pressed }) => [
                {
                  height: 48,
                  borderRadius: 10,
                  backgroundColor: "#F9FAFB",
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="time-outline" size={16} color="#6B7280" />
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#374151" }}>
                {endTime ? formatTimeLabel(endTime) : "End"}
              </Text>
            </Pressable>
            {crossesMidnight && (
              <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
                (next day)
              </Text>
            )}
          </YStack>
```

(The outer `XStack` previously gave the start Pressable `flex: 1`. Keep the existing start-time Pressable unchanged; it already has `flex: 1`.)

- [ ] **Step 3: Compute weekday slot in `DayClosingScreen`**

In `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx`, add a weekday helper near the top-level helpers (after `parseBusinessDate`):

```ts
const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

const weekdayKeyFromDate = (date: Date): WeekdayKey => WEEKDAY_KEYS[date.getDay()];
```

Inside the component, derive the current slot:

```ts
  const scheduleSlot = selectedDate && store?.schedule
    ? store.schedule[weekdayKeyFromDate(selectedDate)]
    : undefined;
```

Pass it to the selector:

```tsx
        <TimeRangeSelector
          startTime={startTime}
          endTime={endTime}
          onTimeRangeChange={handleTimeRangeChange}
          scheduleSlot={scheduleSlot}
        />
```

- [ ] **Step 4: Manual verify in simulator**

Run: `cd apps/native && pnpm ios` (or `android`).
1. Open Day Closing for a store with schedule `17:00 / 01:00`.
2. Tap **Custom Range** — pickers default to 17:00 / 01:00.
3. Confirm "(next day)" appears under the end time.
4. Tap **Refresh Report** — the Z-Report updates with the correct totals (Task 3-5 make the backend side work).
5. Switch to **Full Day** — the selection clears and the report aggregates the same business-day window as the dashboard's "today" bucket.

Report under the previous commit if anything looks wrong; do not proceed to commit until visual verification passes.

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/day-closing/components/TimeRangeSelector.tsx apps/native/src/features/day-closing/screens/DayClosingScreen.tsx
git commit -m "feat(native): default Day Closing custom range from store schedule and show (next day) hint"
```

---

## Task 8: Native — printed Z-Report shows "(next day)"

**Files:**
- Modify: `apps/native/src/features/day-closing/utils/zReportFormatter.ts`

- [ ] **Step 1: Locate the time-range print block**

The current block (around line 105):

```ts
  if (data.startTime && data.endTime) {
    await p.printAlign({ mode: "center" });
    await p.printText("TIME RANGE\n", normal());
    await p.printText(`${formatTime(data.startTime)} - ${formatTime(data.endTime)}\n`, normal());
  }
```

- [ ] **Step 2: Append "(next day)" when end ≤ start**

Replace with:

```ts
  if (data.startTime && data.endTime) {
    const crossesMidnight = data.endTime <= data.startTime;
    await p.printAlign({ mode: "center" });
    await p.printText("TIME RANGE\n", normal());
    const suffix = crossesMidnight ? " (next day)" : "";
    await p.printText(
      `${formatTime(data.startTime)} - ${formatTime(data.endTime)}${suffix}\n`,
      normal(),
    );
  }
```

- [ ] **Step 3: Manual verify via the printer preview or a test print**

Run the app, generate a Z-Report with range `17:00 → 01:00`, print or capture — confirm the printed line reads `5:00 PM - 1:00 AM (next day)`.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/day-closing/utils/zReportFormatter.ts
git commit -m "feat(native): append (next day) to printed Z-Report time range when cross-midnight"
```

---

## Task 9: Final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: clean across all packages.

- [ ] **Step 2: Run lint**

Run: `pnpm check`
Expected: no biome errors in changed files.

- [ ] **Step 3: Run full backend test suite**

Run: `cd packages/backend && pnpm vitest run`
Expected: all tests green.

- [ ] **Step 4: Manual regression checklist (native)**

Exercise on a dev build:
1. Legacy store (no `schedule` set) — Day Closing Full Day and Custom Range `06:00 → 22:00` still produce the same numbers as before this change. (Use a prod staging store if available.)
2. New schedule store (`17:00 / 01:00`) — Full Day includes post-midnight orders. Custom Range `17:00 → 01:00` produces the same result as Full Day.
3. 24/7 store (`00:00 / 00:00` all days) — Day Closing Full Day equals PHT midnight-to-midnight. No regression.

- [ ] **Step 5: Open PR**

Open a PR from `feat/day-closing-cross-midnight` → `main`. Include in the PR body:
- Link to the spec: `docs/superpowers/specs/2026-04-17-day-closing-cross-midnight-cutoff-design.md`.
- Note the user-visible behavior change: "Stores with a late-night closing time now get a single continuous Z-Report; Custom Range supports cross-midnight spans like 5 PM → 1 AM."
- Note the manual verification Rod should perform on the client device.
