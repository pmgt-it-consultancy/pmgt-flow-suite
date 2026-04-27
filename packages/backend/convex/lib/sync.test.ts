import { describe, expect, it } from "vitest";
import { deviceCodeFromIndex, newClientId, SYNCED_TABLES, TABLET_WRITABLE_TABLES } from "./sync";

describe("deviceCodeFromIndex", () => {
  it.each([
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
    [703, "AAB"],
    [18277, "ZZZ"],
    [18278, "AAAA"],
  ])("encodes %i as %s", (n, expected) => {
    expect(deviceCodeFromIndex(n)).toBe(expected);
  });

  it("rejects negative index", () => {
    expect(() => deviceCodeFromIndex(-1)).toThrow();
  });

  it("rejects non-integer index", () => {
    expect(() => deviceCodeFromIndex(1.5)).toThrow();
    expect(() => deviceCodeFromIndex(Number.NaN)).toThrow();
  });
});

describe("newClientId", () => {
  it("returns a UUIDv4-shaped string", () => {
    const id = newClientId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("returns unique values across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newClientId()));
    expect(ids.size).toBe(100);
  });
});

describe("table sets", () => {
  it("TABLET_WRITABLE_TABLES is a strict subset of SYNCED_TABLES", () => {
    for (const t of TABLET_WRITABLE_TABLES) {
      expect(SYNCED_TABLES).toContain(t);
    }
  });

  it("SYNCED_TABLES contains expected tablet-writable tables", () => {
    expect(TABLET_WRITABLE_TABLES.has("orders")).toBe(true);
    expect(TABLET_WRITABLE_TABLES.has("orderItems")).toBe(true);
    expect(TABLET_WRITABLE_TABLES.has("orderPayments")).toBe(true);
  });

  it("catalog tables are NOT in TABLET_WRITABLE_TABLES", () => {
    expect(TABLET_WRITABLE_TABLES.has("products")).toBe(false);
    expect(TABLET_WRITABLE_TABLES.has("categories")).toBe(false);
    expect(TABLET_WRITABLE_TABLES.has("modifierGroups")).toBe(false);
  });
});
