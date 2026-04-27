import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import { SpikeProduct } from "./Product";
import { spikeSchema } from "./schema";

/**
 * Phase 0 spike database. Verifies JSI SQLite adapter on RN 0.81 + new arch.
 * REMOVE THIS DIRECTORY once Phase 0 verification passes.
 */
export function createSpikeDatabase() {
  const adapter = new SQLiteAdapter({
    schema: spikeSchema,
    jsi: true,
    onSetUpError: (error) => {
      console.error("[WatermelonDB spike] setup error:", error);
    },
  });

  return new Database({
    adapter,
    modelClasses: [SpikeProduct],
  });
}
