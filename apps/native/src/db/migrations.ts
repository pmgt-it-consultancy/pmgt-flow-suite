import { addColumns, createTable, schemaMigrations } from "@nozbe/watermelondb/Schema/migrations";

/**
 * WatermelonDB migration history. Append (never edit) entries when bumping
 * SCHEMA_VERSION in schema.ts.
 *
 * v2: add `audit_logs` table (push-only on tablet) and
 *     `orders.refunded_from_order_id` so the "Refunded" badge survives sync.
 */
export const watermelonMigrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        createTable({
          name: "audit_logs",
          columns: [
            { name: "server_id", type: "string", isOptional: true, isIndexed: true },
            { name: "store_id", type: "string", isIndexed: true },
            { name: "action", type: "string", isIndexed: true },
            { name: "entity_type", type: "string" },
            { name: "entity_id", type: "string", isIndexed: true },
            { name: "details", type: "string" },
            { name: "user_id", type: "string" },
            { name: "created_at", type: "number" },
            { name: "updated_at", type: "number" },
          ],
        }),
        addColumns({
          table: "orders",
          columns: [
            {
              name: "refunded_from_order_id",
              type: "string",
              isOptional: true,
              isIndexed: true,
            },
          ],
        }),
      ],
    },
  ],
});
