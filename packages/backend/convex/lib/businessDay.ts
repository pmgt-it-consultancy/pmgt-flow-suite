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
