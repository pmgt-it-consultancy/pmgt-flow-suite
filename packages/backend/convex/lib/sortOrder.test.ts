import { describe, expect, it } from "vitest";
import { computeMoveSortOrder } from "./sortOrder";

describe("computeMoveSortOrder", () => {
  it("returns the midpoint when both neighbors are given", () => {
    expect(computeMoveSortOrder(0, 10)).toBe(5);
  });

  it("moves before the after-neighbor when there is no before-neighbor", () => {
    expect(computeMoveSortOrder(null, 5)).toBe(4);
  });

  it("moves after the before-neighbor when there is no after-neighbor", () => {
    expect(computeMoveSortOrder(5, null)).toBe(6);
  });

  it("throws when neither neighbor is given", () => {
    expect(() => computeMoveSortOrder(null, null)).toThrow(
      "computeMoveSortOrder requires at least one of before or after",
    );
  });
});
