import { describe, expect, it } from "vitest";
import {
  getPHTDayBoundaries,
  getPHTDayBoundariesForDate,
  getPHTHour,
  getPHTTimeBoundariesForDate,
} from "./dateUtils";

// Helper: create a UTC timestamp from a readable string
function utc(dateStr: string): number {
  return new Date(dateStr).getTime();
}

describe("getPHTDayBoundaries", () => {
  it("returns correct boundaries for afternoon PHT (10:00 UTC = 18:00 PHT)", () => {
    const now = utc("2026-03-13T10:00:00Z"); // 18:00 PHT
    const { startOfDay, endOfDay } = getPHTDayBoundaries(now);

    // Start of PHT day = 2026-03-13 00:00 PHT = 2026-03-12 16:00 UTC
    expect(startOfDay).toBe(utc("2026-03-12T16:00:00Z"));
    // End of PHT day = 2026-03-14 00:00 PHT = 2026-03-13 16:00 UTC
    expect(endOfDay).toBe(utc("2026-03-13T16:00:00Z"));
  });

  it("returns correct boundaries for early morning PHT (23:00 UTC = 07:00 PHT next day)", () => {
    const now = utc("2026-03-12T23:00:00Z"); // 07:00 PHT March 13
    const { startOfDay, endOfDay } = getPHTDayBoundaries(now);

    // Start of PHT day = 2026-03-13 00:00 PHT = 2026-03-12 16:00 UTC
    expect(startOfDay).toBe(utc("2026-03-12T16:00:00Z"));
    expect(endOfDay).toBe(utc("2026-03-13T16:00:00Z"));
  });

  it("handles the PHT/UTC day boundary correctly (15:59 UTC vs 16:00 UTC)", () => {
    // 15:59 UTC = 23:59 PHT on March 12
    const before = getPHTDayBoundaries(utc("2026-03-12T15:59:00Z"));
    expect(before.startOfDay).toBe(utc("2026-03-11T16:00:00Z"));

    // 16:00 UTC = 00:00 PHT on March 13 (new PHT day)
    const after = getPHTDayBoundaries(utc("2026-03-12T16:00:00Z"));
    expect(after.startOfDay).toBe(utc("2026-03-12T16:00:00Z"));
  });

  it("endOfDay is exactly 24 hours after startOfDay", () => {
    const { startOfDay, endOfDay } = getPHTDayBoundaries(utc("2026-06-15T05:30:00Z"));
    expect(endOfDay - startOfDay).toBe(24 * 60 * 60 * 1000);
  });
});

describe("getPHTDayBoundariesForDate", () => {
  it("converts YYYY-MM-DD string to PHT midnight boundaries", () => {
    const { startOfDay, endOfDay } = getPHTDayBoundariesForDate("2026-03-13");

    // 2026-03-13 00:00 PHT = 2026-03-12 16:00 UTC
    expect(startOfDay).toBe(utc("2026-03-12T16:00:00Z"));
    // 2026-03-14 00:00 PHT = 2026-03-13 16:00 UTC
    expect(endOfDay).toBe(utc("2026-03-13T16:00:00Z"));
  });

  it("matches getPHTDayBoundaries for the same PHT day", () => {
    // 10:00 UTC March 13 = 18:00 PHT March 13
    const fromTimestamp = getPHTDayBoundaries(utc("2026-03-13T10:00:00Z"));
    const fromString = getPHTDayBoundariesForDate("2026-03-13");

    expect(fromString.startOfDay).toBe(fromTimestamp.startOfDay);
    expect(fromString.endOfDay).toBe(fromTimestamp.endOfDay);
  });

  it("endOfDay is exactly 24 hours after startOfDay", () => {
    const { startOfDay, endOfDay } = getPHTDayBoundariesForDate("2026-01-01");
    expect(endOfDay - startOfDay).toBe(24 * 60 * 60 * 1000);
  });
});

describe("getPHTHour", () => {
  it("returns PHT hour for a UTC timestamp", () => {
    // 10:00 UTC = 18:00 PHT
    expect(getPHTHour(utc("2026-03-13T10:00:00Z"))).toBe(18);
  });

  it("handles day boundary (23:00 UTC = 07:00 PHT next day)", () => {
    expect(getPHTHour(utc("2026-03-12T23:00:00Z"))).toBe(7);
  });

  it("handles midnight PHT (16:00 UTC = 00:00 PHT)", () => {
    expect(getPHTHour(utc("2026-03-12T16:00:00Z"))).toBe(0);
  });
});

describe("getPHTTimeBoundariesForDate", () => {
  it("returns full-day boundaries when no times given", () => {
    const { start, end } = getPHTTimeBoundariesForDate("2026-04-16");
    // Apr 16 00:00 PHT = Apr 15 16:00 UTC
    expect(start).toBe(utc("2026-04-15T16:00:00Z"));
    // full 24-hour span
    expect(end - start).toBe(24 * 60 * 60 * 1000);
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
