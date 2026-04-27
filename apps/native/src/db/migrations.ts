import { schemaMigrations } from "@nozbe/watermelondb/Schema/migrations";

/**
 * WatermelonDB migration history. Empty for v1 — when bumping
 * SCHEMA_VERSION in schema.ts, append a `createTable` /
 * `addColumns` / `unsafeExecuteSql` migration here.
 */
export const watermelonMigrations = schemaMigrations({
  migrations: [],
});
