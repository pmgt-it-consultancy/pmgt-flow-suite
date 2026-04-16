import { describe, expect, it } from "vitest";
import { getBusinessDayBoundaries, getWeekdayKey } from "./businessDay";
import { getPHTDayBoundaries } from "./dateUtils";

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
