# Store Schedule & Business-Day Cutoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each store configure a 7-day operating schedule where the closing time defines the business-day cutoff, replacing the hardcoded midnight PHT boundary.

**Architecture:** Add an optional `schedule` field to the `stores` table. Introduce two schedule-aware date utilities that fall through to the existing PHT midnight helpers when `schedule` is undefined. Migrate all callers of `getPHTDayBoundaries()` / `getPHTDayBoundariesForDate()` to pass the store's schedule. Add a 7-row schedule editor to the admin store dialog.

**Tech Stack:** Convex (backend schema, queries, mutations), Vitest + convex-test (backend tests), Next.js 16 (web admin), TanStack React Form + Zod (admin forms), Tailwind / shadcn UI primitives.

**Spec reference:** `docs/superpowers/specs/2026-04-16-store-schedule-cutoff-design.md`

**Branch strategy:** Create a feature branch from `main` before Task 1 (e.g. `git checkout -b feat/store-schedule-cutoff`). All commits in this plan target that branch.

---

## File Structure

**Created:**
- `packages/backend/convex/lib/businessDay.ts` — schedule-aware business-day boundary helpers
- `packages/backend/convex/lib/businessDay.test.ts` — Vitest coverage for the helpers
- `apps/web/src/app/(admin)/stores/_components/ScheduleEditor.tsx` — 7-row schedule form UI

**Modified:**
- `packages/backend/convex/schema.ts` — add optional `schedule` field on `stores` table
- `packages/backend/convex/stores.ts` — accept/return `schedule` in `list`, `get`, `create`, `update`
- `packages/backend/convex/orders.ts` — replace 6 `getPHTDayBoundaries()` calls; pass `store.schedule`; export `getNextOrderNumber` for testing
- `packages/backend/convex/reports.ts` — replace 2 `getPHTDayBoundariesForDate()` calls
- `packages/backend/convex/helpers/voidsHelpers.ts` — replace 1 `getPHTDayBoundaries()` call
- `packages/backend/convex/orders.test.ts` — add cross-midnight order-numbering integration test
- `apps/web/src/app/(admin)/stores/_schemas/storeSchema.ts` — add `schedule` to Zod schema + defaults
- `apps/web/src/app/(admin)/stores/_components/StoreFormDialog.tsx` — render ScheduleEditor
- `apps/web/src/app/(admin)/stores/_components/index.ts` — export ScheduleEditor
- `apps/web/src/app/(admin)/stores/_hooks/useStoreMutations.ts` — pass schedule to create/update

---

## Task 1: Schema — add `schedule` field to `stores`

**Files:**
- Modify: `packages/backend/convex/schema.ts` (stores table definition around line 47-68)

- [ ] **Step 1: Add the `schedule` field**

In `packages/backend/convex/schema.ts`, inside the `stores: defineTable({...})` block, add a new optional field BEFORE `isActive: v.boolean()`:

```ts
  schedule: v.optional(
    v.object({
      monday: v.object({ open: v.string(), close: v.string() }),
      tuesday: v.object({ open: v.string(), close: v.string() }),
      wednesday: v.object({ open: v.string(), close: v.string() }),
      thursday: v.object({ open: v.string(), close: v.string() }),
      friday: v.object({ open: v.string(), close: v.string() }),
      saturday: v.object({ open: v.string(), close: v.string() }),
      sunday: v.object({ open: v.string(), close: v.string() }),
    }),
  ),
  isActive: v.boolean(),
```

- [ ] **Step 2: Regenerate Convex types**

Run from the repo root:

```bash
cd packages/backend && pnpm convex codegen
```

Expected: no errors; `packages/backend/convex/_generated/dataModel.d.ts` updates to include the new optional field.

- [ ] **Step 3: Verify typecheck still passes**

Run from the repo root:

```bash
pnpm typecheck
```

Expected: no new type errors in any package.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/_generated
git commit -m "feat(schema): add optional schedule field to stores table"
```

---

## Task 2: Business-day helper — type definitions + weekday key

**Files:**
- Create: `packages/backend/convex/lib/businessDay.ts`
- Create: `packages/backend/convex/lib/businessDay.test.ts`

- [ ] **Step 1: Write failing test for `getWeekdayKey`**

Create `packages/backend/convex/lib/businessDay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getWeekdayKey } from "./businessDay";

function utc(s: string): number {
  return new Date(s).getTime();
}

describe("getWeekdayKey", () => {
  it("returns the PHT weekday name for a UTC timestamp", () => {
    // 2026-04-13 is a Monday in PHT
    // 14:00 UTC Apr 13 = 22:00 PHT Monday Apr 13
    expect(getWeekdayKey(utc("2026-04-13T14:00:00Z"))).toBe("monday");
  });

  it("rolls to the next PHT day after 16:00 UTC", () => {
    // 16:00 UTC Apr 13 = 00:00 PHT Tuesday Apr 14
    expect(getWeekdayKey(utc("2026-04-13T16:00:00Z"))).toBe("tuesday");
  });

  it("returns saturday then sunday correctly", () => {
    // 2026-04-18 Saturday
    expect(getWeekdayKey(utc("2026-04-18T10:00:00Z"))).toBe("saturday");
    // 2026-04-19 Sunday
    expect(getWeekdayKey(utc("2026-04-19T10:00:00Z"))).toBe("sunday");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && pnpm vitest run convex/lib/businessDay.test.ts
```

Expected: FAIL with "Cannot find module './businessDay'".

- [ ] **Step 3: Create the helper file with the weekday function**

Create `packages/backend/convex/lib/businessDay.ts`:

```ts
/**
 * Schedule-aware business-day boundary utilities. The closing time per
 * weekday defines when orders roll over to the next business day. When a
 * store has no schedule configured, these helpers fall through to the
 * existing PHT midnight-cutoff behavior from dateUtils.ts.
 */

import { getPHTDayBoundaries, getPHTDayBoundariesForDate } from "./dateUtils";

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WeekdayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type DaySchedule = { open: string; close: string };

export type StoreSchedule = Record<WeekdayKey, DaySchedule>;

// Sunday=0 ... Saturday=6 in JavaScript Date; map to our keys.
const WEEKDAY_BY_JS_INDEX: WeekdayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Returns the PHT weekday key for a UTC timestamp. */
export function getWeekdayKey(utcTimestamp: number): WeekdayKey {
  const phtDate = new Date(utcTimestamp + PHT_OFFSET_MS);
  return WEEKDAY_BY_JS_INDEX[phtDate.getUTCDay()];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/backend && pnpm vitest run convex/lib/businessDay.test.ts
```

Expected: 3 passing tests for `getWeekdayKey`.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/businessDay.ts packages/backend/convex/lib/businessDay.test.ts
git commit -m "feat(backend): add businessDay helper scaffold with getWeekdayKey"
```

---

## Task 3: Business-day helper — `getBusinessDayBoundaries` (timestamp input)

**Files:**
- Modify: `packages/backend/convex/lib/businessDay.ts`
- Modify: `packages/backend/convex/lib/businessDay.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/backend/convex/lib/businessDay.test.ts`:

```ts
import { getBusinessDayBoundaries } from "./businessDay";

const schedule24h = {
  monday: { open: "00:00", close: "00:00" },
  tuesday: { open: "00:00", close: "00:00" },
  wednesday: { open: "00:00", close: "00:00" },
  thursday: { open: "00:00", close: "00:00" },
  friday: { open: "00:00", close: "00:00" },
  saturday: { open: "00:00", close: "00:00" },
  sunday: { open: "00:00", close: "00:00" },
};

// Restaurant: 10:00 → 01:00 next day all week except Sunday (closes 22:00)
const restaurantSchedule = {
  monday: { open: "10:00", close: "01:00" },
  tuesday: { open: "10:00", close: "01:00" },
  wednesday: { open: "10:00", close: "01:00" },
  thursday: { open: "10:00", close: "01:00" },
  friday: { open: "10:00", close: "03:00" },
  saturday: { open: "10:00", close: "03:00" },
  sunday: { open: "11:00", close: "22:00" },
};

describe("getBusinessDayBoundaries (with schedule)", () => {
  it("falls through to midnight behavior when schedule is undefined", () => {
    // 18:00 PHT Monday Apr 13 = 10:00 UTC
    const now = utc("2026-04-13T10:00:00Z");
    expect(getBusinessDayBoundaries(undefined, now)).toEqual({
      ...getPHTDayBoundaries(now),
      businessDate: "2026-04-13",
    });
  });

  it("maps 24/7 schedule (all 00:00/00:00) to exact midnight boundaries", () => {
    const now = utc("2026-04-13T10:00:00Z"); // 18:00 PHT Monday
    const result = getBusinessDayBoundaries(schedule24h, now);
    expect(result.startOfDay).toBe(utc("2026-04-12T16:00:00Z")); // Mon 00:00 PHT
    expect(result.endOfDay).toBe(utc("2026-04-13T16:00:00Z")); // Tue 00:00 PHT
    expect(result.businessDate).toBe("2026-04-13");
  });

  it("rolls midnight-1am orders into the PREVIOUS business day when prior close crossed midnight", () => {
    // 00:30 Tue PHT = 16:30 UTC Mon
    // Monday closes at 01:00 (next day). 00:30 < 01:00 → belongs to Monday.
    const now = utc("2026-04-13T16:30:00Z");
    const result = getBusinessDayBoundaries(restaurantSchedule, now);
    expect(result.businessDate).toBe("2026-04-13"); // Monday
    // startOfDay = Monday's open moment = Apr 13 10:00 PHT = Apr 13 02:00 UTC
    expect(result.startOfDay).toBe(utc("2026-04-13T02:00:00Z"));
    // endOfDay = Monday's close moment = Apr 14 01:00 PHT = Apr 13 17:00 UTC
    expect(result.endOfDay).toBe(utc("2026-04-13T17:00:00Z"));
  });

  it("attributes 02:00 Tuesday PHT to Tuesday's business day when Mon closes at 01:00", () => {
    // 02:00 Tue PHT = 18:00 UTC Mon
    const now = utc("2026-04-13T18:00:00Z");
    const result = getBusinessDayBoundaries(restaurantSchedule, now);
    expect(result.businessDate).toBe("2026-04-14"); // Tuesday
  });

  it("attributes 23:00 Sunday PHT to Monday's business day when Sunday closes at 22:00", () => {
    // 23:00 Sun PHT Apr 19 = 15:00 UTC Sun
    const now = utc("2026-04-19T15:00:00Z");
    const result = getBusinessDayBoundaries(restaurantSchedule, now);
    expect(result.businessDate).toBe("2026-04-20"); // Monday
  });

  it("attributes 21:30 Sunday PHT to Sunday's business day (before 22:00 close)", () => {
    // 21:30 Sun PHT Apr 19 = 13:30 UTC Sun
    const now = utc("2026-04-19T13:30:00Z");
    const result = getBusinessDayBoundaries(restaurantSchedule, now);
    expect(result.businessDate).toBe("2026-04-19"); // Sunday
  });

  it("handles Sat→Sun boundary with Sat close at 03:00 Sun", () => {
    // 02:00 Sun PHT Apr 19 = 18:00 UTC Sat Apr 18
    // Saturday closes 03:00 → 02:00 < 03:00 → Saturday's business day.
    const now = utc("2026-04-18T18:00:00Z");
    const result = getBusinessDayBoundaries(restaurantSchedule, now);
    expect(result.businessDate).toBe("2026-04-18"); // Saturday
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && pnpm vitest run convex/lib/businessDay.test.ts
```

Expected: 7 new tests fail with "getBusinessDayBoundaries is not a function".

- [ ] **Step 3: Implement `getBusinessDayBoundaries`**

Append to `packages/backend/convex/lib/businessDay.ts`:

```ts
export type BusinessDayBoundaries = {
  startOfDay: number;
  endOfDay: number;
  businessDate: string; // YYYY-MM-DD PHT date when the business day opened
};

/** Format a UTC timestamp as YYYY-MM-DD in PHT. */
function phtDateString(utcTimestamp: number): string {
  const d = new Date(utcTimestamp + PHT_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse "HH:mm" into milliseconds offset from midnight. */
function timeToMs(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h * 60 + m) * 60 * 1000;
}

/**
 * Returns the business-day boundaries (UTC ms) containing the timestamp `now`,
 * respecting the store's weekly schedule. When `schedule` is undefined, falls
 * through to the PHT midnight-cutoff behavior of `getPHTDayBoundaries()`.
 *
 * Algorithm:
 *   1. Compute PHT calendar date and time-of-day of `now`.
 *   2. Look up the PREVIOUS PHT day's schedule slot.
 *   3. If that slot's close crosses midnight (close <= open lexicographically)
 *      AND `now`'s time-of-day is strictly before the close, then `now` belongs
 *      to the previous business day.
 *   4. Otherwise, `now` belongs to the current PHT date's business day.
 *
 * The returned `startOfDay` and `endOfDay` are the UTC ms moments when that
 * business day opened and closes (close may be next PHT day for late closures).
 */
export function getBusinessDayBoundaries(
  schedule: StoreSchedule | undefined,
  now?: number,
): BusinessDayBoundaries {
  const utcNow = now ?? Date.now();

  if (!schedule) {
    const { startOfDay, endOfDay } = getPHTDayBoundaries(utcNow);
    return { startOfDay, endOfDay, businessDate: phtDateString(utcNow) };
  }

  const phtNow = utcNow + PHT_OFFSET_MS;
  const msSinceStartOfPHTDay = phtNow % DAY_MS;
  const phtMidnightToday = utcNow - msSinceStartOfPHTDay; // UTC ms at today 00:00 PHT
  const phtMidnightYesterday = phtMidnightToday - DAY_MS;

  const todayKey = getWeekdayKey(utcNow);
  const yesterdayKey = getWeekdayKey(phtMidnightYesterday);

  const prev = schedule[yesterdayKey];
  const prevCrossesMidnight = prev.close <= prev.open;
  const timeOfDayMs = msSinceStartOfPHTDay;

  if (prevCrossesMidnight && timeOfDayMs < timeToMs(prev.close)) {
    // Belongs to yesterday's business day.
    const startOfDay = phtMidnightYesterday + timeToMs(prev.open);
    const endOfDay = phtMidnightToday + timeToMs(prev.close);
    return {
      startOfDay,
      endOfDay,
      businessDate: phtDateString(phtMidnightYesterday),
    };
  }

  // Belongs to today's business day.
  const today = schedule[todayKey];
  const todayCrossesMidnight = today.close <= today.open;
  const startOfDay = phtMidnightToday + timeToMs(today.open);
  const endOfDay = todayCrossesMidnight
    ? phtMidnightToday + DAY_MS + timeToMs(today.close)
    : phtMidnightToday + timeToMs(today.close);
  return {
    startOfDay,
    endOfDay,
    businessDate: phtDateString(phtMidnightToday),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && pnpm vitest run convex/lib/businessDay.test.ts
```

Expected: all tests pass (3 `getWeekdayKey` + 7 `getBusinessDayBoundaries`).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/businessDay.ts packages/backend/convex/lib/businessDay.test.ts
git commit -m "feat(backend): add getBusinessDayBoundaries for schedule-aware day cutoff"
```

---

## Task 4: Business-day helper — `getBusinessDayBoundariesForDate` (date-string input)

**Files:**
- Modify: `packages/backend/convex/lib/businessDay.ts`
- Modify: `packages/backend/convex/lib/businessDay.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/backend/convex/lib/businessDay.test.ts`:

```ts
import { getBusinessDayBoundariesForDate } from "./businessDay";

describe("getBusinessDayBoundariesForDate (with schedule)", () => {
  it("falls through to midnight boundaries when schedule is undefined", () => {
    const result = getBusinessDayBoundariesForDate(undefined, "2026-04-13");
    expect(result).toEqual({
      ...getPHTDayBoundariesForDate("2026-04-13"),
      businessDate: "2026-04-13",
    });
  });

  it("returns open→close window for a weekday business day with cross-midnight close", () => {
    // Monday Apr 13: open 10:00, close 01:00 next day
    const result = getBusinessDayBoundariesForDate(restaurantSchedule, "2026-04-13");
    // start = Apr 13 10:00 PHT = Apr 13 02:00 UTC
    expect(result.startOfDay).toBe(utc("2026-04-13T02:00:00Z"));
    // end = Apr 14 01:00 PHT = Apr 13 17:00 UTC
    expect(result.endOfDay).toBe(utc("2026-04-13T17:00:00Z"));
    expect(result.businessDate).toBe("2026-04-13");
  });

  it("returns open→close window for Sunday (same-day close)", () => {
    // Sunday Apr 19: open 11:00, close 22:00 same day
    const result = getBusinessDayBoundariesForDate(restaurantSchedule, "2026-04-19");
    // start = Apr 19 11:00 PHT = Apr 19 03:00 UTC
    expect(result.startOfDay).toBe(utc("2026-04-19T03:00:00Z"));
    // end = Apr 19 22:00 PHT = Apr 19 14:00 UTC
    expect(result.endOfDay).toBe(utc("2026-04-19T14:00:00Z"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && pnpm vitest run convex/lib/businessDay.test.ts
```

Expected: 3 new tests fail with "getBusinessDayBoundariesForDate is not a function".

- [ ] **Step 3: Implement `getBusinessDayBoundariesForDate`**

Append to `packages/backend/convex/lib/businessDay.ts`:

```ts
/**
 * Returns business-day boundaries for a named PHT calendar date. The date
 * argument is interpreted as the PHT date on which the business day OPENED.
 * When `schedule` is undefined, falls through to PHT midnight boundaries.
 */
export function getBusinessDayBoundariesForDate(
  schedule: StoreSchedule | undefined,
  dateStr: string,
): BusinessDayBoundaries {
  if (!schedule) {
    const { startOfDay, endOfDay } = getPHTDayBoundariesForDate(dateStr);
    return { startOfDay, endOfDay, businessDate: dateStr };
  }

  const midnightUTC = new Date(dateStr).getTime();
  const phtMidnight = midnightUTC - PHT_OFFSET_MS;
  const weekdayKey = getWeekdayKey(phtMidnight);
  const slot = schedule[weekdayKey];
  const crossesMidnight = slot.close <= slot.open;

  const startOfDay = phtMidnight + timeToMs(slot.open);
  const endOfDay = crossesMidnight
    ? phtMidnight + DAY_MS + timeToMs(slot.close)
    : phtMidnight + timeToMs(slot.close);

  return { startOfDay, endOfDay, businessDate: dateStr };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && pnpm vitest run convex/lib/businessDay.test.ts
```

Expected: all tests pass (previous + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/businessDay.ts packages/backend/convex/lib/businessDay.test.ts
git commit -m "feat(backend): add getBusinessDayBoundariesForDate for named business days"
```

---

## Task 5: Expose `schedule` on `stores.get` / `stores.list`

**Files:**
- Modify: `packages/backend/convex/stores.ts:109-169` (`get` query) and `:8-106` (`list` query)

- [ ] **Step 1: Define a reusable schedule validator constant**

At the top of `packages/backend/convex/stores.ts`, after the imports, add:

```ts
const scheduleValidator = v.optional(
  v.object({
    monday: v.object({ open: v.string(), close: v.string() }),
    tuesday: v.object({ open: v.string(), close: v.string() }),
    wednesday: v.object({ open: v.string(), close: v.string() }),
    thursday: v.object({ open: v.string(), close: v.string() }),
    friday: v.object({ open: v.string(), close: v.string() }),
    saturday: v.object({ open: v.string(), close: v.string() }),
    sunday: v.object({ open: v.string(), close: v.string() }),
  }),
);
```

- [ ] **Step 2: Add `schedule` to the `get` query return validator**

In `stores.ts`, inside the `returns: v.union(v.object({...}), v.null())` block of the `get` query (around line 113-135), add a new line before `isActive`:

```ts
      schedule: scheduleValidator,
      isActive: v.boolean(),
```

Then update the return object in the handler (around line 147-167) to include:

```ts
      schedule: store.schedule,
      isActive: store.isActive,
```

- [ ] **Step 3: Add `schedule` to the `list` query return validator**

In `stores.ts`, inside the `list` query's `returns: v.array(v.object({...}))` block (around line 12-32), add before `isActive`:

```ts
      schedule: scheduleValidator,
      isActive: v.boolean(),
```

In the `list` handler's map (around line 82-100), add before `isActive`:

```ts
          schedule: store.schedule,
          isActive: store.isActive,
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/stores.ts
git commit -m "feat(backend): expose schedule on stores.get and stores.list"
```

---

## Task 6: Accept `schedule` in `stores.create` and `stores.update`

**Files:**
- Modify: `packages/backend/convex/stores.ts:172-223` (`create` mutation) and `:227-264` (`update` mutation)

- [ ] **Step 1: Add `schedule` arg + insert value in `create`**

In `stores.ts`, inside the `create` mutation's `args` block (around line 173-187), add before the closing brace:

```ts
    footer: v.optional(v.string()),
    schedule: scheduleValidator,
  },
```

Inside the `ctx.db.insert("stores", {...})` call (around line 203-222), add before `isActive`:

```ts
      footer: args.footer,
      schedule: args.schedule,
      isActive: true,
```

- [ ] **Step 2: Add `schedule` arg in `update`**

In the `update` mutation's `args` block (around line 228-245), add before `isActive`:

```ts
    footer: v.optional(v.string()),
    schedule: scheduleValidator,
    isActive: v.optional(v.boolean()),
```

No handler changes needed — the existing `Object.fromEntries(...filter(undefined))` logic (lines 256-259) already passes through any new fields.

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/stores.ts
git commit -m "feat(backend): accept schedule in stores.create and stores.update"
```

---

## Task 7: Migrate `orders.ts` call sites to schedule-aware boundaries

**Files:**
- Modify: `packages/backend/convex/orders.ts`

The function `getPHTDayBoundaries()` is called in 6 places inside `orders.ts`. Each caller already has `storeId` in scope. Migrate each to load the store and pass `store.schedule`.

- [ ] **Step 1: Update the import**

In `packages/backend/convex/orders.ts:5`, replace:

```ts
import { getPHTDayBoundaries } from "./lib/dateUtils";
```

with:

```ts
import { getBusinessDayBoundaries } from "./lib/businessDay";
```

- [ ] **Step 2: Update `getNextOrderNumber` signature (and export it for testing)**

Replace the `getNextOrderNumber` helper (around lines 32-62) with:

```ts
// Generate next order number for today's business day (respects store schedule).
// Exported for unit-testability; internal callers pass the same `ctx` they already have.
export async function getNextOrderNumber(
  ctx: { db: any },
  storeId: Id<"stores">,
  orderType: "dine_in" | "takeout",
  now?: number,
): Promise<string> {
  const prefix = orderType === "dine_in" ? "D" : "T";
  const store = await ctx.db.get(storeId);
  const { startOfDay, endOfDay } = getBusinessDayBoundaries(store?.schedule, now);

  const todaysOrders = await ctx.db
    .query("orders")
    .withIndex("by_store_createdAt", (q: any) =>
      q.eq("storeId", storeId).gte("createdAt", startOfDay),
    )
    .filter((q: any) =>
      q.and(q.lt(q.field("createdAt"), endOfDay), q.eq(q.field("orderType"), orderType)),
    )
    .collect();

  let maxNumber = 0;
  for (const order of todaysOrders) {
    const match = order.orderNumber?.match(/\d+$/);
    if (match) {
      maxNumber = Math.max(maxNumber, Number.parseInt(match[0], 10));
    }
  }

  const nextNumber = maxNumber + 1;
  return `${prefix}-${nextNumber.toString().padStart(3, "0")}`;
}
```

- [ ] **Step 3: Update `createDraftOrder` (around line 180)**

Inside the handler, replace:

```ts
    const { startOfDay } = getPHTDayBoundaries();
```

with:

```ts
    const store = await ctx.db.get(args.storeId);
    const { startOfDay } = getBusinessDayBoundaries(store?.schedule);
```

- [ ] **Step 4: Update `cleanupExpiredDraftOrders` (around line 359)**

Inside the function body, replace:

```ts
  const { startOfDay } = getPHTDayBoundaries();
```

with:

```ts
  const store = await ctx.db.get(storeId);
  const { startOfDay } = getBusinessDayBoundaries(store?.schedule);
```

- [ ] **Step 5: Update `getTakeoutOrdersByDateRange` (around line 1328)**

Replace:

```ts
    const { startOfDay: phtStartOfDay } = getPHTDayBoundaries();
```

with:

```ts
    const store = await ctx.db.get(args.storeId);
    const { startOfDay: phtStartOfDay } = getBusinessDayBoundaries(store?.schedule);
```

- [ ] **Step 6: Update `getDashboardSummary` (around line 1384)**

Replace:

```ts
    const { startOfDay, endOfDay } = getPHTDayBoundaries();
```

with:

```ts
    const store = await ctx.db.get(args.storeId);
    const { startOfDay, endOfDay } = getBusinessDayBoundaries(store?.schedule);
```

- [ ] **Step 7: Update `getTodaysOpenOrders` (around line 1488)**

Replace:

```ts
    const { startOfDay } = getPHTDayBoundaries();
```

with:

```ts
    const store = await ctx.db.get(args.storeId);
    const { startOfDay } = getBusinessDayBoundaries(store?.schedule);
```

- [ ] **Step 8: Verify no stray references to `getPHTDayBoundaries` remain in this file**

```bash
grep -n "getPHTDayBoundaries" packages/backend/convex/orders.ts
```

Expected: no matches.

- [ ] **Step 9: Run the existing orders tests to confirm no regressions**

```bash
cd packages/backend && pnpm vitest run convex/orders.test.ts
```

Expected: all existing tests still pass.

- [ ] **Step 10: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "refactor(backend): use schedule-aware boundaries in orders.ts"
```

---

## Task 8: Migrate `reports.ts` call sites

**Files:**
- Modify: `packages/backend/convex/reports.ts`

- [ ] **Step 1: Update the import**

In `packages/backend/convex/reports.ts`, find the import line that includes `getPHTDayBoundariesForDate` (around line 6-8) and replace the `getPHTDayBoundariesForDate` import with `getBusinessDayBoundariesForDate`:

Before:

```ts
import {
  getPHTDayBoundaries,
  getPHTDayBoundariesForDate,
  ...
} from "./lib/dateUtils";
```

After (keep `getPHTDayBoundaries` import if used elsewhere in the file; only replace the `ForDate` one):

```ts
import {
  getPHTDayBoundaries,
  ...
} from "./lib/dateUtils";
import { getBusinessDayBoundariesForDate } from "./lib/businessDay";
```

(If the file only uses `getPHTDayBoundariesForDate` and not `getPHTDayBoundaries`, drop that import entirely and only import from `./lib/businessDay`.)

- [ ] **Step 2: Update `getDashboardSummary` (around line 1203)**

Replace:

```ts
    const { startOfDay, endOfDay } = getPHTDayBoundariesForDate(args.reportDate);
```

with:

```ts
    const store = await ctx.db.get(args.storeId);
    const { startOfDay, endOfDay } = getBusinessDayBoundariesForDate(
      store?.schedule,
      args.reportDate,
    );
```

- [ ] **Step 3: Update `getTopSellingProductsLive` (around line 1268)**

Replace:

```ts
    const { startOfDay, endOfDay } = getPHTDayBoundariesForDate(args.reportDate);
```

with:

```ts
    const store = await ctx.db.get(args.storeId);
    const { startOfDay, endOfDay } = getBusinessDayBoundariesForDate(
      store?.schedule,
      args.reportDate,
    );
```

- [ ] **Step 4: Verify no stray references to `getPHTDayBoundariesForDate` remain**

```bash
grep -n "getPHTDayBoundariesForDate" packages/backend/convex/reports.ts
```

Expected: no matches.

- [ ] **Step 5: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/reports.ts
git commit -m "refactor(backend): use schedule-aware boundaries in reports.ts"
```

---

## Task 9: Migrate `helpers/voidsHelpers.ts` call site

**Files:**
- Modify: `packages/backend/convex/helpers/voidsHelpers.ts` (line 5 import, line 333 call site)

- [ ] **Step 1: Update imports**

Replace:

```ts
import { getPHTDayBoundaries } from "../lib/dateUtils";
```

with:

```ts
import { getBusinessDayBoundaries } from "../lib/businessDay";
```

- [ ] **Step 2: Update the call site (around line 333)**

The surrounding code already has `order` loaded from `ctx.db.get(order._id)` earlier. Confirm `store` is already loaded (line 328-329) — it is. Replace:

```ts
      const { startOfDay, endOfDay } = getPHTDayBoundaries();
```

with:

```ts
      const { startOfDay, endOfDay } = getBusinessDayBoundaries(store?.schedule);
```

- [ ] **Step 3: Verify no stray references remain**

```bash
grep -n "getPHTDayBoundaries" packages/backend/convex/helpers/voidsHelpers.ts
```

Expected: no matches.

- [ ] **Step 4: Run void-related tests**

```bash
cd packages/backend && pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/helpers/voidsHelpers.ts
git commit -m "refactor(backend): use schedule-aware boundaries in voidsHelpers"
```

---

## Task 10: Integration test — order numbers stay continuous across midnight

**Files:**
- Modify: `packages/backend/convex/orders.test.ts`

- [ ] **Step 1: Write the failing test**

Add a static import at the top of `packages/backend/convex/orders.test.ts` (next to the existing `taxCalculations` import):

```ts
import { getNextOrderNumber } from "./orders";
```

Then append a new `describe` block at the bottom of the file:

```ts
const restaurantClose3am = {
  monday: { open: "10:00", close: "03:00" },
  tuesday: { open: "10:00", close: "03:00" },
  wednesday: { open: "10:00", close: "03:00" },
  thursday: { open: "10:00", close: "03:00" },
  friday: { open: "10:00", close: "03:00" },
  saturday: { open: "10:00", close: "03:00" },
  sunday: { open: "10:00", close: "03:00" },
};

describe("orders — business-day cutoff with store schedule", () => {
  it("keeps D-xxx numbers continuous across midnight when store closes at 03:00", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    await t.run(async (ctx: any) => {
      await ctx.db.patch(storeId, { schedule: restaurantClose3am });
      // Pre-existing D-045 at 23:30 PHT Mon Apr 13 (= 15:30 UTC Mon).
      await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-045",
        orderType: "dine_in",
        status: "open",
        grossSales: 0,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 0,
        createdBy: userId,
        createdAt: new Date("2026-04-13T15:30:00Z").getTime(),
      });
    });

    // Query next number at 00:30 PHT Tue Apr 14 (= 16:30 UTC Mon Apr 13).
    // Monday's schedule closes at 03:00 next day → this timestamp still belongs
    // to Monday's business day → counter must NOT reset.
    const nowUtc = new Date("2026-04-13T16:30:00Z").getTime();
    const nextNumber = await t.run(async (ctx: any) =>
      getNextOrderNumber(ctx, storeId, "dine_in", nowUtc),
    );
    expect(nextNumber).toBe("D-046");
  });

  it("resets counter at 04:00 PHT after Monday's 03:00 close", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    await t.run(async (ctx: any) => {
      await ctx.db.patch(storeId, { schedule: restaurantClose3am });
      await ctx.db.insert("orders", {
        storeId,
        orderNumber: "D-045",
        orderType: "dine_in",
        status: "open",
        grossSales: 0,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 0,
        createdBy: userId,
        createdAt: new Date("2026-04-13T15:30:00Z").getTime(),
      });
    });

    // Query at 04:00 PHT Tue Apr 14 (= 20:00 UTC Mon) — past Monday's 03:00 close.
    const nowUtc = new Date("2026-04-13T20:00:00Z").getTime();
    const nextNumber = await t.run(async (ctx: any) =>
      getNextOrderNumber(ctx, storeId, "dine_in", nowUtc),
    );
    expect(nextNumber).toBe("D-001");
  });
});
```

- [ ] **Step 2: Run the new tests**

```bash
cd packages/backend && pnpm vitest run convex/orders.test.ts
```

Expected: both new tests pass (since Task 7 already made `getNextOrderNumber` accept a `now` argument and use schedule-aware boundaries). If they fail, read the error carefully and fix either the helper (Tasks 3-4) or the order helper (Task 7).

- [ ] **Step 3: Run the full backend test suite**

```bash
cd packages/backend && pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/orders.test.ts
git commit -m "test(backend): cover cross-midnight order numbering with store schedule"
```

---

## Task 11: Web schema — add `schedule` to Zod + defaults

**Files:**
- Modify: `apps/web/src/app/(admin)/stores/_schemas/storeSchema.ts`

- [ ] **Step 1: Replace the schema file contents**

Overwrite `apps/web/src/app/(admin)/stores/_schemas/storeSchema.ts` with:

```ts
import { z } from "zod";

const socialSchema = z.object({
  platform: z.string().min(1, "Platform is required"),
  url: z.string().min(1, "URL is required"),
});

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const daySlotSchema = z.object({
  open: z.string().regex(timeRegex, "Must be HH:mm (24h)"),
  close: z.string().regex(timeRegex, "Must be HH:mm (24h)"),
});

export const scheduleSchema = z.object({
  monday: daySlotSchema,
  tuesday: daySlotSchema,
  wednesday: daySlotSchema,
  thursday: daySlotSchema,
  friday: daySlotSchema,
  saturday: daySlotSchema,
  sunday: daySlotSchema,
});

export type StoreSchedule = z.infer<typeof scheduleSchema>;

export const defaultSchedule: StoreSchedule = {
  monday: { open: "00:00", close: "00:00" },
  tuesday: { open: "00:00", close: "00:00" },
  wednesday: { open: "00:00", close: "00:00" },
  thursday: { open: "00:00", close: "00:00" },
  friday: { open: "00:00", close: "00:00" },
  saturday: { open: "00:00", close: "00:00" },
  sunday: { open: "00:00", close: "00:00" },
};

export const storeSchema = z.object({
  name: z.string().min(1, "Store name is required"),
  parentId: z.string().optional(),
  address1: z.string().min(1, "Address is required"),
  address2: z.string().optional(),
  tin: z.string().min(1, "TIN is required"),
  min: z.string().optional(),
  vatRate: z.number().min(0),
  contactNumber: z.string().optional(),
  telephone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  website: z.string().optional(),
  socials: z.array(socialSchema),
  footer: z.string().optional(),
  isActive: z.boolean(),
  schedule: scheduleSchema,
});

export type StoreFormValues = z.infer<typeof storeSchema>;

export const storeDefaults: StoreFormValues = {
  name: "",
  parentId: undefined,
  address1: "",
  address2: "",
  tin: "",
  min: "",
  vatRate: 12,
  contactNumber: "",
  telephone: "",
  email: "",
  website: "",
  socials: [],
  footer: "",
  isActive: true,
  schedule: defaultSchedule,
};
```

- [ ] **Step 2: Verify typecheck across the web app**

```bash
cd apps/web && pnpm typecheck
```

Expected: it will flag downstream consumers of `storeDefaults` / `StoreFormValues` that now need to provide `schedule`. They will be fixed in Tasks 12-14.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/stores/_schemas/storeSchema.ts
git commit -m "feat(web): add schedule to store Zod schema and defaults"
```

---

## Task 12: ScheduleEditor component

**Files:**
- Create: `apps/web/src/app/(admin)/stores/_components/ScheduleEditor.tsx`
- Modify: `apps/web/src/app/(admin)/stores/_components/index.ts`

- [ ] **Step 1: Create the component**

Create `apps/web/src/app/(admin)/stores/_components/ScheduleEditor.tsx`:

```tsx
"use client";

import type { FormApi } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { normalizeErrors } from "../../_shared/normalizeErrors";
import {
  type StoreFormValues,
  type StoreSchedule,
  defaultSchedule,
} from "../_schemas";

type WeekdayKey = keyof StoreSchedule;

const WEEKDAY_ROWS: { key: WeekdayKey; label: string }[] = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

function computeHint(open: string, close: string): string | null {
  if (open === close) {
    return open === "00:00"
      ? "Open 24 hours (midnight cutoff)"
      : `24-hour business day starting at ${open}`;
  }
  if (close < open) {
    return `Closes next day at ${close}`;
  }
  return null;
}

interface ScheduleEditorProps {
  // Accept the useForm API; exact generic typing would leak here — use `any` at
  // the boundary like the other StoreFormDialog children do.
  form: FormApi<StoreFormValues, any>;
}

export function ScheduleEditor({ form }: ScheduleEditorProps) {
  const applyWeekdaysFromMonday = () => {
    const mon = form.getFieldValue("schedule.monday");
    if (!mon) return;
    for (const day of ["tuesday", "wednesday", "thursday", "friday"] as const) {
      form.setFieldValue(`schedule.${day}.open` as const, mon.open);
      form.setFieldValue(`schedule.${day}.close` as const, mon.close);
    }
  };

  const applyAllFromMonday = () => {
    const mon = form.getFieldValue("schedule.monday");
    if (!mon) return;
    for (const day of WEEKDAY_ROWS.map((r) => r.key)) {
      form.setFieldValue(`schedule.${day}.open` as const, mon.open);
      form.setFieldValue(`schedule.${day}.close` as const, mon.close);
    }
  };

  const resetTo24h = () => {
    for (const day of WEEKDAY_ROWS.map((r) => r.key)) {
      form.setFieldValue(
        `schedule.${day}.open` as const,
        defaultSchedule[day].open,
      );
      form.setFieldValue(
        `schedule.${day}.close` as const,
        defaultSchedule[day].close,
      );
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Closing time determines when orders roll over to the next business day.
        Use 00:00 / 00:00 to mean "24 hours, midnight cutoff."
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={applyWeekdaysFromMonday}
        >
          Copy Monday to weekdays
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={applyAllFromMonday}
        >
          Copy Monday to all days
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={resetTo24h}>
          Reset to 24/7 (midnight cutoff)
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {WEEKDAY_ROWS.map(({ key, label }) => (
          <form.Field
            key={key}
            name={`schedule.${key}` as const}
            children={(slotField) => {
              const { open, close } = slotField.state.value;
              const hint = computeHint(open, close);
              return (
                <div className="grid grid-cols-[120px_1fr_1fr] gap-3 items-start">
                  <div className="pt-8 text-sm font-medium">{label}</div>

                  <form.Field
                    name={`schedule.${key}.open` as const}
                    children={(field) => {
                      const hasErrors =
                        field.state.meta.isTouched &&
                        field.state.meta.errors.length > 0;
                      return (
                        <Field data-invalid={hasErrors || undefined}>
                          <FieldLabel htmlFor={`schedule-${key}-open`}>
                            Open
                          </FieldLabel>
                          <Input
                            id={`schedule-${key}-open`}
                            type="time"
                            aria-invalid={hasErrors || undefined}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                          />
                          <FieldError
                            errors={normalizeErrors(field.state.meta.errors)}
                          />
                        </Field>
                      );
                    }}
                  />

                  <form.Field
                    name={`schedule.${key}.close` as const}
                    children={(field) => {
                      const hasErrors =
                        field.state.meta.isTouched &&
                        field.state.meta.errors.length > 0;
                      return (
                        <Field data-invalid={hasErrors || undefined}>
                          <FieldLabel htmlFor={`schedule-${key}-close`}>
                            Close
                          </FieldLabel>
                          <Input
                            id={`schedule-${key}-close`}
                            type="time"
                            aria-invalid={hasErrors || undefined}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                          />
                          {hint && (
                            <p className="text-xs text-gray-500">{hint}</p>
                          )}
                          <FieldError
                            errors={normalizeErrors(field.state.meta.errors)}
                          />
                        </Field>
                      );
                    }}
                  />
                </div>
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export the component from the barrel**

Modify `apps/web/src/app/(admin)/stores/_components/index.ts` to add:

```ts
export { ScheduleEditor } from "./ScheduleEditor";
```

(Keep existing exports.)

- [ ] **Step 3: Verify typecheck**

```bash
cd apps/web && pnpm typecheck
```

Expected: the ScheduleEditor itself typechecks cleanly. StoreFormDialog will still complain about `schedule` missing from defaults until Task 13 — ignore for now if that's the only remaining error.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/stores/_components/ScheduleEditor.tsx apps/web/src/app/\(admin\)/stores/_components/index.ts
git commit -m "feat(web): add ScheduleEditor component for store operating hours"
```

---

## Task 13: Integrate ScheduleEditor into StoreFormDialog

**Files:**
- Modify: `apps/web/src/app/(admin)/stores/_components/StoreFormDialog.tsx`

- [ ] **Step 1: Import the component**

At the top of the file (around line 33, next to the other internal imports), add:

```ts
import { ScheduleEditor } from "./ScheduleEditor";
```

And add `FieldSeparator` if it's already imported (it is, on line 20).

- [ ] **Step 2: Render it before the Receipt section**

In `StoreFormDialog.tsx`, find the `<FieldSeparator>Receipt</FieldSeparator>` line (around line 558) and insert ABOVE it:

```tsx
            <FieldSeparator>Operating Hours</FieldSeparator>

            <ScheduleEditor form={form} />
```

- [ ] **Step 3: Verify typecheck**

```bash
cd apps/web && pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/stores/_components/StoreFormDialog.tsx
git commit -m "feat(web): render ScheduleEditor in StoreFormDialog"
```

---

## Task 14: Pass `schedule` through `useStoreMutations`

**Files:**
- Modify: `apps/web/src/app/(admin)/stores/_hooks/useStoreMutations.ts`

- [ ] **Step 1: Add `schedule` to create and update payloads**

In `useStoreMutations.ts`, modify the `handleCreate` mutation call (around line 16-29) to include `schedule`:

```ts
      await createStore({
        name: values.name,
        parentId: (values.parentId as Id<"stores">) || undefined,
        address1: values.address1,
        address2: values.address2 || undefined,
        tin: values.tin,
        min: values.min || undefined,
        vatRate: values.vatRate,
        contactNumber: values.contactNumber || undefined,
        telephone: values.telephone || undefined,
        email: values.email || undefined,
        website: values.website || undefined,
        socials: values.socials.length > 0 ? values.socials : undefined,
        footer: values.footer || undefined,
        schedule: values.schedule,
      });
```

And modify `handleUpdate` (around line 37-53) similarly:

```ts
      await updateStore({
        storeId,
        name: values.name,
        address1: values.address1,
        address2: values.address2 || undefined,
        tin: values.tin,
        min: values.min || undefined,
        vatRate: values.vatRate,
        contactNumber: values.contactNumber || undefined,
        telephone: values.telephone || undefined,
        email: values.email || undefined,
        website: values.website || undefined,
        socials: values.socials.length > 0 ? values.socials : undefined,
        footer: values.footer || undefined,
        isActive: values.isActive,
        schedule: values.schedule,
      });
```

- [ ] **Step 2: Verify typecheck across the whole monorepo**

```bash
pnpm typecheck
```

Expected: no type errors anywhere.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/stores/_hooks/useStoreMutations.ts
git commit -m "feat(web): send schedule to stores.create and stores.update"
```

---

## Task 15: Seed initial form values on edit (pre-existing stores)

**Files:**
- Modify: `apps/web/src/app/(admin)/stores/page.tsx` (or wherever the dialog is opened for edit)

When editing an existing store that has no `schedule` yet, the form needs to fall back to `defaultSchedule` so the editor renders.

- [ ] **Step 1: Find the edit-click handler**

```bash
grep -rn "StoreFormDialog" apps/web/src/app/\(admin\)/stores/
```

The page opens the dialog with `initialValues` built from the selected store. Locate the mapping that converts a `Store` doc into `StoreFormValues`.

- [ ] **Step 2: Map `schedule` with a fallback**

Wherever the mapping happens (likely in `page.tsx` or a helper), ensure the `schedule` key is set:

```ts
import { defaultSchedule } from "./_schemas";

// inside the mapping:
{
  ...otherFields,
  schedule: store.schedule ?? defaultSchedule,
}
```

If the mapping currently spreads the store doc, add the fallback line explicitly.

- [ ] **Step 3: Verify typecheck**

```bash
cd apps/web && pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/stores/page.tsx
git commit -m "feat(web): default schedule to 24/7 when editing legacy stores"
```

---

## Task 16: Manual QA in the browser

**Files:** no code changes.

- [ ] **Step 1: Start the dev environment**

From the repo root:

```bash
pnpm dev
```

Leave this running. Open `http://localhost:3000` (or the port shown) and log in as an admin user.

- [ ] **Step 2: Golden path — create a store with a schedule**

1. Go to the Stores admin page → "Create Store".
2. Fill required fields + set schedule: Mon–Thu 10:00/01:00, Fri–Sat 10:00/03:00, Sun 11:00/22:00.
3. Verify the hint under each `close` input:
   - 01:00 under 10:00 → "Closes next day at 01:00".
   - 03:00 under 10:00 → "Closes next day at 03:00".
   - 22:00 under 11:00 → no hint (normal same-day close).
4. Save. Verify toast "Store created successfully."

- [ ] **Step 3: Edit path — edit a pre-existing store with no schedule**

1. Pick a store created before this feature. Click edit.
2. Operating Hours section should render with all rows set to 00:00/00:00 and the hint "Open 24 hours (midnight cutoff)" on every row.
3. Change Monday to 10:00/01:00. Save.
4. Reopen the edit dialog — confirm Monday is still 10:00/01:00 and other days are still 00:00/00:00.

- [ ] **Step 4: Helper buttons**

1. Set Monday to 09:00/22:00.
2. Click "Copy Monday to weekdays" — verify Tue–Fri update, Sat/Sun unchanged.
3. Click "Copy Monday to all days" — verify all 7 days are 09:00/22:00.
4. Click "Reset to 24/7 (midnight cutoff)" — verify all 7 days are 00:00/00:00.

- [ ] **Step 5: Validation**

1. Clear the Monday open input (empty string) — form should show "Must be HH:mm (24h)".
2. Restore a valid value — error clears.

- [ ] **Step 6: End-to-end cutoff behavior (time permitting)**

1. Create a test store with all days set to open 10:00 / close 03:00.
2. On the POS native app, create an order so it gets `D-001`.
3. Use the Convex dashboard (or a small script) to edit that order's `createdAt` to a timestamp equivalent to 23:30 PHT today.
4. Create another order in the POS app (which uses "now" for its timestamp). If "now" is before 03:00 tomorrow PHT, it should get `D-002`.
5. This step is optional if tests in Task 10 passed — it's belt-and-suspenders.

Report any failures before proceeding.

- [ ] **Step 7: No commit — QA only**

---

## Task 17: Final polish + merge readiness

- [ ] **Step 1: Run full lint + format + typecheck**

```bash
pnpm check && pnpm typecheck
```

Expected: all clean. If there are any remaining issues, fix them.

- [ ] **Step 2: Run full backend test suite**

```bash
cd packages/backend && pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/store-schedule-cutoff
```

- [ ] **Step 4: Open a PR against `main`** (manual step — use the commit commands skill if preferred)

Use the commit log to build the PR body. The PR description should reference `docs/superpowers/specs/2026-04-16-store-schedule-cutoff-design.md` for context.

---

## Spec Coverage Checklist

| Spec section | Implemented in task(s) |
|--------------|------------------------|
| Data model (`schedule` on stores) | Task 1 |
| Cutoff algorithm for timestamp | Task 3 |
| Cutoff algorithm for named date | Task 4 |
| Module structure (`lib/businessDay.ts`) | Tasks 2–4 |
| Migrate `orders.ts` call sites | Task 7 |
| Migrate `reports.ts` call sites | Task 8 |
| Migrate `helpers/voidsHelpers.ts` | Task 9 |
| Admin UI (7-row editor + helpers + hints) | Tasks 11–13, 15 |
| Backward compatibility (optional field, fall-through) | Tasks 1, 3, 4 |
| Tests (unit + integration) | Tasks 2–4, 10 |
| Rollout (no migration required) | Inherent in Task 1 |

All spec requirements covered.
