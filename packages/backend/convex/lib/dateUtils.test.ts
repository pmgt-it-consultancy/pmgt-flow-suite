import { describe, expect, it } from "vitest";
import { getPHTDayBoundaries, getPHTDayBoundariesForDate, getPHTHour } from "./dateUtils";

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
