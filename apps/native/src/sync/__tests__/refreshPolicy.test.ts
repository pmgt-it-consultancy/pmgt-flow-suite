import { getRefreshAccess, messageForResyncReadiness } from "../refreshPolicy";

describe("downloaded-data refresh policy", () => {
  it.each([
    [false, false, "permission"],
    [true, true, "syncing"],
    [true, false, "allowed"],
  ] as const)("maps permission=%s and syncing=%s to %s", (hasSettingsPermission, isSyncing, expected) => {
    expect(getRefreshAccess({ hasSettingsPermission, isSyncing })).toBe(expected);
  });

  it.each([
    ["offline", "Connect to the internet before refreshing POS data."],
    ["syncing", "Wait for the current synchronization to finish."],
    ["pending", "Pending sales or changes must finish syncing before POS data can refresh."],
    ["failed", "POS data could not be verified. Check the connection and try again."],
  ] as const)("gives actionable guidance for %s readiness", (reason, expected) => {
    expect(messageForResyncReadiness({ ready: false, reason })).toBe(expected);
  });
});
