import { appSchema, tableSchema } from "@nozbe/watermelondb";

/**
 * Phase 0 spike schema. Single table for verifying that WatermelonDB's
 * JSI adapter boots cleanly on RN 0.81 + Expo 54 + new architecture.
 * REMOVE THIS DIRECTORY once Phase 0 verification passes.
 */
export const spikeSchema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: "spike_products",
      columns: [
        { name: "name", type: "string" },
        { name: "price", type: "number" },
      ],
    }),
  ],
});
