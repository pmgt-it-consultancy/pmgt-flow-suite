# Day Closing Cross-Midnight Cutoff

**Date:** 2026-04-17
**Status:** Draft
**Scope:** Backend date utilities + daily report aggregation, native Day Closing screen, printed Z-Report formatting

## Problem

Reported by a live client (Rod): the Day Closing "Custom Range" feature does not work for late-night shifts. Setting start `17:00` and end `01:00` produces a Z-Report with zero — or stale — sales. The cashier concludes the cutoff "doesn't take effect," and says "walang option for beyond 12 AM na cutoff."

Two independent defects cause this:

1. **Backend cross-midnight bug.** `getPHTTimeBoundariesForDate(reportDate, "17:00", "01:00")` in `packages/backend/convex/lib/dateUtils.ts:77` naively treats both times as belonging to `reportDate`, so `start = reportDate 17:00 PHT` but `end = reportDate 01:00 PHT`. Because `start > end`, the Convex query `q.gte("createdAt", start).lt("createdAt", end)` matches nothing. Every caller that depends on this helper for cross-midnight ranges silently returns an empty aggregate.

2. **Day Closing never consults the store schedule.** The 2026-04-16 store-schedule feature wired schedule-aware boundaries into `getLiveDailySummary`, `getTopSellingProductsLive`, `getCurrentBusinessDate`, `orders.ts`, and `voidsHelpers.ts` — but **not** into the Day Closing aggregation path (`generateDailyReport`, `aggregateDailyData`, `generateProductSalesBreakdown`, `generatePaymentTransactionsBreakdown`, `getHourlySales`). Those five call sites still use `getPHTTimeBoundariesForDate` with the user-supplied times or, when no times are given, with naive PHT midnight. A store whose schedule closes at `01:00` gets its 00:00–01:00 sales counted on the *next* PHT calendar date, splitting the shift across two Z-Reports.

## Goal

A store that closes at 01:00 gets one continuous Z-Report for the shift that opened on `YYYY-MM-DD`, including orders placed between 00:00 and 01:00 the next calendar day, without the cashier having to configure anything on the Day Closing screen.

Custom Range continues to work for ad-hoc ranges, including cross-midnight ranges like `17:00 → 01:00`.

## Non-Goals

- Redesigning the Day Closing screen layout. Only the Custom Range picker gets a small hint + a smarter default.
- Historical re-aggregation of already-printed / already-stored Z-Reports. The fix takes effect on the next "Refresh Report."
- Multi-day ranges (> 24 h). The custom range remains bounded to a single business day.
- Admin web `/reports` page UX changes. Its existing `<input type="time">` pickers keep current behavior; they pick up the backend fix automatically.
- Enforcing "store is closed, reject new orders." The schedule stays informational / cutoff-only.

## Scenarios

The current date is 2026-04-16 (Thursday). Store `Kusina ng Nanay` has `schedule.thursday = { open: "17:00", close: "01:00" }` — evening shift, closes 01:00 next calendar day.

### Scenario A — Full Day (no custom range)

1. Cashier opens Day Closing at 01:30 Fri 2026-04-17.
2. Screen shows `selectedDate = 2026-04-16` (resolved via `getCurrentBusinessDate`, schedule-aware — this already works).
3. Cashier taps "Refresh Report" with no times.
4. Backend aggregates orders where `createdAt ∈ [Thu 17:00 PHT, Fri 01:00 PHT)`.
5. Z-Report includes `D-001` at 23:50 Thu and `D-004` at 00:45 Fri.

**Today:** step 4 aggregates `[Thu 00:00 PHT, Fri 00:00 PHT)` — excludes `D-004`, which gets counted on Friday's Z-Report instead.

### Scenario B — Custom Range crossing midnight

1. Cashier wants only the late-night portion of Thu's shift.
2. Opens Custom Range. Defaults to `17:00 → 01:00` (pulled from today's schedule slot).
3. Picker shows the end time with a `(next day)` suffix when `end ≤ start`.
4. Cashier taps "Refresh Report."
5. Backend aggregates orders where `createdAt ∈ [Thu 17:00 PHT, Fri 01:00 PHT)`.

**Today:** step 5 produces an inverted range and returns zero orders. The cashier sees unchanged / zero data and reports "hindi nag-effect."

### Scenario C — Same-day Custom Range (regression check)

1. Cashier picks `06:00 → 22:00` to match a morning-to-evening subset.
2. Backend aggregates `[same day 06:00 PHT, same day 22:00 PHT)` — unchanged from today.

### Scenario D — Store with no schedule configured

1. A legacy store still has `schedule === undefined`.
2. Day Closing Full Day falls through to `getPHTDayBoundariesForDate` (midnight cutoff) — unchanged from today.
3. Custom Range uses the fixed `getPHTTimeBoundariesForDate`, so cross-midnight ranges work here too.

## Design

### 1. Backend — fix `getPHTTimeBoundariesForDate` cross-midnight

In `packages/backend/convex/lib/dateUtils.ts`, change the final computation so that when **both** `startTime` and `endTime` are provided and `endTime ≤ startTime`, `end` rolls over by 24 hours:

```ts
const startMs = startTime ? parseTime(startTime) : 0;
const endMs = endTime ? parseTime(endTime) : 24 * 60 * 60 * 1000 - 1000;
const crossesMidnight = !!startTime && !!endTime && endMs <= startMs;
const start = midnightPHT + startMs;
const end = midnightPHT + (crossesMidnight ? endMs + 24 * 60 * 60 * 1000 : endMs);
```

Equal start/end when both provided (`17:00 → 17:00`) is interpreted as a full 24-hour window starting at that time, matching the schedule editor's existing convention (`open === close === non-zero` = 24-hour business day).

### 2. Backend — schedule-aware default in Day Closing aggregation

Add a new helper in `packages/backend/convex/lib/businessDay.ts`:

```ts
export function getReportBoundariesForDate(
  schedule: StoreSchedule | undefined,
  dateStr: string,
  startTime?: string,
  endTime?: string,
): { start: number; end: number };
```

Behavior:

- If **both** `startTime` and `endTime` are provided → delegate to `getPHTTimeBoundariesForDate(dateStr, startTime, endTime)`. This is an explicit override and bypasses the schedule.
- Else if `schedule` is defined → delegate to `getBusinessDayBoundariesForDate(schedule, dateStr)` and return `{ start: startOfDay, end: endOfDay }`.
- Else → delegate to `getPHTTimeBoundariesForDate(dateStr, undefined, undefined)` (PHT midnight, current behavior).

Only one input (`startTime` xor `endTime`) is treated as "not a full custom range" → falls through to the schedule path. This keeps the UI contract simple: partial custom inputs are ignored until both are set.

**Migrate these call sites in `packages/backend/convex/reports.ts`:**

- `aggregateDailyData` (~line 187)
- `generateProductSalesBreakdown` (~line 330)
- `generatePaymentTransactionsBreakdown` (~line 483)
- `getHourlySales` (~line 1013)

Each helper currently receives `(ctx, storeId, reportDate, startTime?, endTime?)`. Load `store = await ctx.db.get(storeId)` once at the top of `generateDailyReport` and `getHourlySales`, pass `store?.schedule` down to each helper, and swap the `getPHTTimeBoundariesForDate(...)` call for `getReportBoundariesForDate(schedule, reportDate, startTime, endTime)`.

`generateDailyReport` already loads no store. It must start doing so (cheap — single `ctx.db.get`).

### 3. Native — Custom Range UX

In `apps/native/src/features/day-closing/components/TimeRangeSelector.tsx`:

- **Default from schedule.** Accept a new prop `scheduleSlot?: { open: string; close: string }` (the current weekday's slot, passed from `DayClosingScreen` which already queries the store). When `handleModeChange("custom")` fires and a slot is provided, default to that slot's `open`/`close`. Fall back to the current `06:00 / 22:00` hardcoded values when no slot is provided.
- **"(next day)" hint.** Compute `crossesMidnight = !!startTime && !!endTime && endTime <= startTime`. When true, render a small label under the end-time button reading `(next day)`. Label styling uses `Text variant="muted" size="xs"`.
- No changes to the time-picker itself — the existing `DateTimePicker` with `is24Hour={false}` remains. The AM/PM toggle is sufficient for the user to pick 01:00, and the suffix makes the semantics clear.

`DayClosingScreen.tsx` passes the current weekday's slot by reading `store.schedule` and `store.schedule[weekdayKey]`. The weekday key is derived from `selectedDate` using a small inline helper (Sun → "sunday", Mon → "monday", etc.) — no need to pull the backend `getWeekdayKey` into the native bundle.

### 4. Z-Report print output

In `apps/native/src/features/day-closing/utils/zReportFormatter.ts`, the `TIME RANGE` header currently prints `HH:mm AM/PM - HH:mm AM/PM`. When `endTime ≤ startTime`, append ` (next day)` to the line so the printed receipt is self-explanatory.

### 5. Admin web — no UX change, just inherits the fix

`apps/web/src/app/(admin)/reports/page.tsx` does not need a code change. The `<input type="time">` fields already accept any time; the fixed backend interprets `end ≤ start` as cross-midnight. An optional "(next day)" inline hint can be added as a follow-up if a client requests it.

## Module Structure

**Modified:**

- `packages/backend/convex/lib/dateUtils.ts` — cross-midnight rollover in `getPHTTimeBoundariesForDate`.
- `packages/backend/convex/lib/dateUtils.test.ts` — add cross-midnight + 24-hour cases.
- `packages/backend/convex/lib/businessDay.ts` — new `getReportBoundariesForDate` helper.
- `packages/backend/convex/lib/businessDay.test.ts` — cover the new helper.
- `packages/backend/convex/reports.ts` — four migrations (aggregation helpers + `getHourlySales`).
- `apps/native/src/features/day-closing/components/TimeRangeSelector.tsx` — schedule default + `(next day)` hint.
- `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx` — pass current weekday slot to `TimeRangeSelector`.
- `apps/native/src/features/day-closing/utils/zReportFormatter.ts` — `(next day)` suffix on printed time range.

**Created:**

- `packages/backend/convex/reports.test.ts` — integration coverage for schedule-aware Day Closing aggregation.

## Tests

**`dateUtils.test.ts` — add cases to the existing `getPHTTimeBoundariesForDate` suite:**

- Same-day range (`"06:00", "22:00"`) — unchanged.
- Cross-midnight range (`"17:00", "01:00"`) — `end = midnightPHT + 25h`, span = 8h.
- Equal start/end with both provided (`"17:00", "17:00"`) — 24-hour window.
- No times provided — unchanged (full PHT midnight day).
- Start only (`"06:00"`, undefined) — starts at 06:00, ends at PHT midnight − 1 s. No rollover (rollover needs both times).
- End only (undefined, `"22:00"`) — same as today.

**`businessDay.test.ts` — new suite for `getReportBoundariesForDate`:**

- Both times given → matches `getPHTTimeBoundariesForDate` output (including cross-midnight).
- No times + schedule defined → matches `getBusinessDayBoundariesForDate(schedule, dateStr)`.
- No times + schedule undefined → matches `getPHTDayBoundariesForDate(dateStr)`.
- Start only + schedule defined → ignores the partial input, uses schedule.

**`reports.test.ts` — new file, integration-level via `convex-test`:**

- Store with `thursday.close = "01:00"`. Seed one paid order at 00:30 Fri. Call `generateDailyReport({ storeId, reportDate: "2026-04-16" })` with no times. Assert `transactionCount === 1` and `grossSales` matches the seeded order.
- Same store. Call with `startTime: "17:00"`, `endTime: "01:00"`. Assert same result as Full Day (since the range matches the schedule).
- Store without schedule. Call with no times. Assert it aggregates by PHT midnight (regression check).
- Store without schedule. Call `startTime: "17:00"`, `endTime: "01:00"`. Seed orders at 18:00 Thu and 00:30 Fri. Assert both are counted.

No native unit test added — `TimeRangeSelector` behavior is visually verified per the POS UI guidelines.

## Backward Compatibility

- `getPHTTimeBoundariesForDate` remains backward-compatible for same-day ranges and no-time calls. Cross-midnight is strictly better than today (today: silent empty result).
- `getReportBoundariesForDate` is additive.
- Stores without `schedule` continue to aggregate by PHT midnight.
- Already-stored `dailyReports` rows keep their original `startTime` / `endTime` values; they won't change unless the cashier re-runs "Refresh Report."

## Rollout

1. Ship backend fix + new helper + migrated call sites in one Convex deploy. Stores without schedule see no change.
2. Ship native Day Closing changes in the next mobile build.
3. Tell Rod to: (a) confirm the store's Thursday slot is `17:00 / 01:00` in admin, (b) tap "Refresh Report" on Apr 16 to re-aggregate with the new logic.

## Open Questions

None. All answered during brainstorming:

- *Why not reuse Scenario A's schedule-aware path for the dashboard's "today" bucket too?* The dashboard already uses `getBusinessDayBoundariesForDate` (migrated in the Apr 16 feature). This change is only for Day Closing aggregation.
- *What about the `1:05 AM` the user picked in the screenshot?* Not a minute-level issue — the backend bug rejects the whole range. After the fix, `17:00 → 01:05` spans 8h 5m correctly.
