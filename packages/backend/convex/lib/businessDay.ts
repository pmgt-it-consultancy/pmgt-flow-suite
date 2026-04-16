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

  // Check if today's business day has already closed (non-midnight-crossing days only).
  // If now is past today's close, it belongs to the NEXT business day.
  const today = schedule[todayKey];
  const todayCrossesMidnight = today.close <= today.open;
  if (!todayCrossesMidnight && timeOfDayMs >= timeToMs(today.close)) {
    const phtMidnightTomorrow = phtMidnightToday + DAY_MS;
    const tomorrowKey = getWeekdayKey(phtMidnightTomorrow);
    const tomorrow = schedule[tomorrowKey];
    const tomorrowCrossesMidnight = tomorrow.close <= tomorrow.open;
    const startOfDay = phtMidnightTomorrow + timeToMs(tomorrow.open);
    const endOfDay = tomorrowCrossesMidnight
      ? phtMidnightTomorrow + DAY_MS + timeToMs(tomorrow.close)
      : phtMidnightTomorrow + timeToMs(tomorrow.close);
    return {
      startOfDay,
      endOfDay,
      businessDate: phtDateString(phtMidnightTomorrow),
    };
  }

  // Belongs to today's business day.
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
