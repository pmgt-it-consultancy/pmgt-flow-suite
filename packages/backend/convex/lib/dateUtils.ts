/**
 * Philippine timezone (PHT = UTC+8) date utilities for the Convex backend.
 *
 * Convex server functions run in UTC, so all "today" boundaries must be
 * calculated relative to PHT to match business-day expectations.
 */

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8

/**
 * Returns the start (inclusive) and end (exclusive) timestamps of the
 * current PHT business day, expressed as UTC milliseconds.
 *
 * Example: at 2026-03-13 18:00 PHT (10:00 UTC)
 *  → startOfDay = 2026-03-13 00:00 PHT = 2026-03-12 16:00 UTC
 *  → endOfDay   = 2026-03-14 00:00 PHT = 2026-03-13 16:00 UTC
 */
export function getPHTDayBoundaries(now?: number): {
  startOfDay: number;
  endOfDay: number;
} {
  const utcNow = now ?? Date.now();
  const phtNow = utcNow + PHT_OFFSET_MS;
  const msSinceStartOfPHTDay = phtNow % (24 * 60 * 60 * 1000);
  const startOfDay = utcNow - msSinceStartOfPHTDay;
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
  return { startOfDay, endOfDay };
}

/**
 * Converts a YYYY-MM-DD date string to PHT day boundaries (UTC milliseconds).
 *
 * Example: "2026-03-13"
 *  → startOfDay = 2026-03-13 00:00 PHT = 2026-03-12 16:00 UTC
 *  → endOfDay   = 2026-03-14 00:00 PHT = 2026-03-13 16:00 UTC
 */
export function getPHTDayBoundariesForDate(dateStr: string): {
  startOfDay: number;
  endOfDay: number;
} {
  // Parse YYYY-MM-DD as midnight UTC, then subtract PHT offset
  // to get midnight PHT expressed as a UTC timestamp
  const midnightUTC = new Date(dateStr).getTime();
  const startOfDay = midnightUTC - PHT_OFFSET_MS;
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
  return { startOfDay, endOfDay };
}

/**
 * Converts a YYYY-MM-DD date string + optional "HH:mm" time strings
 * to PHT time boundaries (UTC milliseconds).
 *
 * If startTime/endTime are omitted, defaults to full day (00:00-23:59:59).
 *
 * Example: "2026-03-13", "06:00", "14:00"
 *  → start = 2026-03-13 06:00 PHT = 2026-03-12 22:00 UTC
 *  → end   = 2026-03-13 14:00 PHT = 2026-03-13 06:00 UTC
 */
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

/**
 * Returns the PHT hour (0-23) for a UTC timestamp.
 */
export function getPHTHour(utcTimestamp: number): number {
  const phtDate = new Date(utcTimestamp + PHT_OFFSET_MS);
  return phtDate.getUTCHours();
}
