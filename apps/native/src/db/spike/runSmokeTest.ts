import { createSpikeDatabase } from "./database";
import type { SpikeProduct } from "./Product";

/**
 * Phase 0 spike smoke test. Run once at app boot when
 * EXPO_PUBLIC_WATERMELON_SPIKE === "1" to verify JSI SQLite boots cleanly.
 *
 * Logs:
 *   "[WatermelonDB spike] OK — N row(s) in spike_products"
 * on success, or
 *   "[WatermelonDB spike] FAIL — <error>"
 * on failure.
 *
 * REMOVE THIS DIRECTORY (apps/native/src/db/spike) once Phase 0 verification
 * passes on a real device in both dev and release builds.
 */
export async function runWatermelonSpike(): Promise<void> {
  try {
    const db = createSpikeDatabase();
    const collection = db.get<SpikeProduct>("spike_products");
    await db.write(async () => {
      await collection.create((p) => {
        p.name = `spike-${Date.now()}`;
        p.price = 100;
      });
    });
    const all = await collection.query().fetch();
    // biome-ignore lint/suspicious/noConsole: Phase 0 spike test output
    console.log(`[WatermelonDB spike] OK — ${all.length} row(s) in spike_products`);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: Phase 0 spike test output
    console.error("[WatermelonDB spike] FAIL —", err);
  }
}
