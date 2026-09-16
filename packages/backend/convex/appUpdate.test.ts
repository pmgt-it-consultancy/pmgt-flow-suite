import { describe, expect, it } from "vitest";
import { releaseVersion } from "./appUpdate";

describe("releaseVersion", () => {
  it.each([
    ["kotlin-v1.2.1-production", "1.2.1"],
    ["kotlin-v1.2.1-staging", "1.2.1"],
    ["v3.28.1-production", "3.28.1"],
    ["v3.28.1-staging", "3.28.1"],
  ])("parses %s", (tag, expected) => {
    expect(releaseVersion(tag)).toBe(expected);
  });
});
