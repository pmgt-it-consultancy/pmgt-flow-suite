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
