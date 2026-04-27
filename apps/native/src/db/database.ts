import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import { watermelonMigrations } from "./migrations";
import * as Models from "./models";
import { watermelonSchema } from "./schema";

let _db: Database | null = null;

/**
 * Lazily-initialized singleton WatermelonDB instance. Uses the JSI SQLite
 * adapter which requires the WatermelonDBJSIPackage registered in
 * MainApplication.kt (handled by plugins/withWatermelonDB.js during prebuild).
 */
export function getDatabase(): Database {
  if (_db) return _db;

  const adapter = new SQLiteAdapter({
    schema: watermelonSchema,
    migrations: watermelonMigrations,
    jsi: true,
    onSetUpError: (error) => {
      // biome-ignore lint/suspicious/noConsole: critical native init error
      console.error("[WatermelonDB] adapter setup error:", error);
    },
  });

  _db = new Database({
    adapter,
    modelClasses: Object.values(Models) as never,
  });
  return _db;
}
