import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily cleanup of the /sync/push idempotency cache. Runs at 17:00 UTC,
// which is 01:00 PHT — typically off-hours for restaurants.
crons.daily(
  "cleanup synced mutations cache",
  { hourUTC: 17, minuteUTC: 0 },
  internal.syncMaintenance.cleanupSyncedMutations,
);

export default crons;
