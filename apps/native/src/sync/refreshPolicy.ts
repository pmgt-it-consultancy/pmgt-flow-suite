import type { ResyncReadiness } from "./types";

export type RefreshAccess = "allowed" | "permission" | "syncing";

export function getRefreshAccess(args: {
  hasSettingsPermission: boolean;
  isSyncing: boolean;
}): RefreshAccess {
  if (!args.hasSettingsPermission) return "permission";
  if (args.isSyncing) return "syncing";
  return "allowed";
}

export function messageForResyncReadiness(
  readiness: Exclude<ResyncReadiness, { ready: true }>,
): string {
  switch (readiness.reason) {
    case "offline":
      return "Connect to the internet before refreshing POS data.";
    case "syncing":
      return "Wait for the current synchronization to finish.";
    case "pending":
      return "Pending sales or changes must finish syncing before POS data can refresh.";
    case "failed":
      return "POS data could not be verified. Check the connection and try again.";
  }
}
