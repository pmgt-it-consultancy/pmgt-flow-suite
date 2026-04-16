# Store Schedule & Business-Day Cutoff

**Date:** 2026-04-16
**Status:** Approved
**Scope:** Backend schema + date utilities, order numbering, daily reports, void/refund counters, admin web UI

## Problem

Restaurants that operate past midnight lose continuity mid-shift. The current business day is hardcoded to 00:00 PHT via `getPHTDayBoundaries()` in `packages/backend/convex/lib/dateUtils.ts`, which drives the `T-xxx` / `D-xxx` order number reset, daily reports, "today's orders" lists, and daily void/refund counters.

A store that closes at 01:00 sees its order counter reset at midnight — `D-046` placed at 23:45 is followed by `D-001` at 00:15 on the same shift. Daily reports also split the shift across two business days.

## Goal

Let each store configure a weekly operating-hours schedule. The **closing time** defines the business-day cutoff for that store, replacing the hardcoded midnight boundary wherever it's used today. The opening time is stored for display purposes only (receipts, admin UI) and does not gate behavior.

## Non-Goals

- Calendar-date holiday overrides (e.g. "closed Dec 24 this year"). Day-of-week granularity only.
- Enforcing "store is closed, reject new orders" — opening time is informational.
- Supporting timezones other than PHT. Store schedules are expressed in PHT local time.
- Daylight-saving transitions (Philippines does not observe DST).

## Scenario

Kusina ng Nanay restaurant configures:

| Day | Open | Close |
|-----|------|-------|
| Monday | 10:00 | 01:00 (next day) |
| Tuesday | 10:00 | 01:00 |
| Wednesday | 10:00 | 01:00 |
| Thursday | 10:00 | 01:00 |
| Friday | 10:00 | 03:00 (next day, weekend late night) |
| Saturday | 10:00 | 03:00 |
| Sunday | 11:00 | 22:00 (close early, Sunday family day) |

**Friday night → Saturday morning:**

- 22:30 Fri — `D-045`
- 23:45 Fri — `T-012`
- 00:15 **Sat** — `D-046` (Friday's counter continues, not reset)
- 02:50 Sat — `D-047`
- 03:00 Sat — cutoff. Friday's business day closes; daily report aggregates `D-045`–`D-047` + `T-012`.
- 03:30 Sat — next order is `D-001` (Saturday's counter started).

**Sunday early close → Monday:**

- 21:45 Sun — `D-032`
- 22:00 Sun — Sunday business day ends (same-day close, no midnight crossing).
- 23:00 Sun — staff test order creates `D-001` (Monday's counter — Sunday closed at 22:00, so everything after belongs to Monday's business day).
- 09:30 Mon — still Monday business day, counter continues.

**Today, without the feature:** at 00:00 Sat, the counter resets mid-shift. `D-046` would be numbered `D-001`, staff loses the running count, daily report splits Friday's shift across two dates.

## Data Model

New optional field on the `stores` table:

```ts
// packages/backend/convex/schema.ts
schedule: v.optional(
  v.object({
    monday:    v.object({ open: v.string(), close: v.string() }),
    tuesday:   v.object({ open: v.string(), close: v.string() }),
    wednesday: v.object({ open: v.string(), close: v.string() }),
    thursday:  v.object({ open: v.string(), close: v.string() }),
    friday:    v.object({ open: v.string(), close: v.string() }),
    saturday:  v.object({ open: v.string(), close: v.string() }),
    sunday:    v.object({ open: v.string(), close: v.string() }),
  }),
),
```

Values are `"HH:mm"` in 24-hour PHT local time. Named fields avoid off-by-one confusion and keep TS types self-documenting.

**Migration:** field is optional; existing stores have no `schedule`. Unset = fall through to current `getPHTDayBoundaries()` behavior. No backfill required.

**A 24/7 store** sets all seven days to `{ open: "00:00", close: "00:00" }`, which evaluates identically to the current midnight-cutoff behavior.

## Cutoff Algorithm

Given a timestamp `T` (UTC ms) and a store's `schedule`:

1. Compute `(dateStr, timeOfDay)` of `T` in PHT (`YYYY-MM-DD` and `HH:mm`).
2. Determine PHT weekday of `dateStr` — call this `today`.
3. Determine PHT weekday of `dateStr - 1` — call this `yesterday`.
4. Look up `yesterday`'s schedule slot: `prev = schedule[yesterday]`.
5. If `prev.close <= prev.open` lexicographically (i.e. yesterday's close crossed midnight) **AND** `timeOfDay < prev.close` → `T` belongs to **yesterday's** business day.
6. Else → `T` belongs to **today's** business day.

The resulting business day is identified by the PHT date on which it *opened*. Boundaries:

- `startOfDay` = the moment yesterday's close ended (or today's 00:00 PHT if yesterday's close is same-day).
- `endOfDay` = the moment today's close happens (may be tomorrow's calendar date in UTC).

When `schedule` is undefined, the new function delegates to `getPHTDayBoundaries()` / `getPHTDayBoundariesForDate()` unchanged.

**Edge cases:**

- `open = close = "00:00"` on all days — evaluates to exact midnight boundaries `[today 00:00, tomorrow 00:00)` via the same algorithm (close <= open is true, but `timeOfDay < "00:00"` is never true, so everything lands on "today"). This is the explicit "24/7, midnight cutoff" configuration = current behavior.
- Other `open = close` values (e.g. `22:00 / 22:00`) — evaluates to a 24-hour business day starting at that time, which is internally consistent if unusual.
- Daily report requested for a named business date (`YYYY-MM-DD`) — resolves to the boundaries of the business day that *opened* on that PHT calendar date.

## Module Structure

**New functions in `packages/backend/convex/lib/dateUtils.ts`:**

- `getBusinessDayBoundaries(schedule, now?)` → `{ startOfDay, endOfDay, businessDate }`
  - `businessDate` is the `YYYY-MM-DD` PHT date that names the business day.
- `getBusinessDayBoundariesForDate(schedule, dateStr)` → same shape, for a named business day.
- `getWeekdayKey(dateStr)` → `"monday" | "tuesday" | ...` (internal helper).

Both new functions accept `schedule: StoreSchedule | undefined` and fall through to the existing PHT functions when undefined. The existing `getPHTDayBoundaries*` stay unchanged so callers that don't need schedule-awareness (or don't have a store in scope) keep working.

**Caller migration (search: `getPHTDayBoundaries`):**

- `packages/backend/convex/orders.ts` — 6 call sites (`generateOrderNumber`, order list filters, kitchen ticket queries). Each receives a `storeId`; load the store and pass `store.schedule`.
- `packages/backend/convex/reports.ts` — daily report queries (lines ~1203, 1268). Load store alongside the report's `storeId`.
- `packages/backend/convex/helpers/voidsHelpers.ts` — daily void count (line 333). Already has `storeId`.

Each migration is mechanical: `getPHTDayBoundaries()` → `await getBusinessDayBoundaries(store.schedule)` (where `store` is fetched once per handler).

## Admin UI (Web)

New **Operating Hours** section inside the store edit dialog — path: `apps/web/src/app/(admin)/stores/_components/` (new colocated component next to `StoreFormDialog.tsx`).

**Layout:**

- Seven rows labeled Monday → Sunday.
- Each row: day label + open time picker (`HH:mm`) + close time picker (`HH:mm`).
- Inline hint per row: when `close < open`, show `"Closes next day at HH:mm"` below the inputs. When `close === open === "00:00"`, show `"Open 24 hours (midnight cutoff)"`. When `close === open` with a non-zero value, show `"24-hour business day starting at HH:mm"`.
- Three helper buttons above the grid:
  - **Copy Monday to weekdays** — copies Mon's open/close to Tue–Fri.
  - **Copy to all days** — copies Mon's open/close to all 7 days.
  - **Reset to 24/7 (midnight cutoff)** — sets all days to `00:00 / 00:00`.
- Short help text: *"Closing time determines when orders roll over to the next business day."*

**Validation (Zod):** each time field matches `/^([01]\d|2[0-3]):[0-5]\d$/`. Empty schedule section (user leaves it blank on an existing store) is valid = no schedule = current midnight behavior.

**Form integration:** schedule is part of the existing React Hook Form that drives the store dialog; save uses the existing `updateStore` mutation (which accepts the new optional arg).

## Receipt / Kitchen Ticket (native)

Out of scope for this change — receipts already render operating hours from `stores.contactNumber` / `stores.address*` etc. If the user wants hours printed, that's a follow-up (surface `schedule` in `getReceipt`).

## Backward Compatibility

- Schema field is optional. Stores without `schedule` → existing midnight behavior, zero risk.
- No breaking changes to existing mutations / queries. New `updateStore` arg is optional.
- Legacy reports, audit logs, daily reports keep their existing shape; they just resolve to different time windows when a schedule is configured.

## Tests

**Backend (`packages/backend/convex/**/*.test.ts`):**

- `lib/dateUtils.test.ts` — expand:
  - Cross-midnight close (01:00 Mon → 00:30 Tue belongs to Mon's business day).
  - Same-day close (22:00 Sun → 23:00 Sun belongs to Mon's business day).
  - All-days-00:00 equivalent to `getPHTDayBoundaries()`.
  - Undefined schedule delegates to existing functions.
  - Weekday rollover at Sat/Sun boundary uses the correct slot.
- `orders.test.ts` — order numbers stay continuous across midnight when close is 03:00.
- `reports.test.ts` — daily report for "Friday" aggregates orders created up to 03:00 Sat when Friday closes at 03:00.
- `voidsHelpers` — daily void count window extends past midnight when schedule configured.

**Web (admin UI):** no new tests required; form validation follows existing Zod + React Hook Form patterns already covered in `StoreFormDialog`.

## Rollout

1. Ship schema + new date utilities + migrated call sites in one Convex deploy (the new field is optional, existing stores are unaffected).
2. Ship admin UI in web deploy.
3. No data migration.
4. Client can configure schedules at their leisure; until then, behavior is identical to today.
