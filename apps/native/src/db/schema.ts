import { appSchema, tableSchema } from "@nozbe/watermelondb";

export const SCHEMA_VERSION = 1;

/**
 * WatermelonDB schema mirroring the synced Convex tables.
 *
 * Naming conventions:
 *   - SQLite columns are snake_case (Watermelon convention)
 *   - Models expose camelCase via @field/@text decorators
 *   - WatermelonDB primary key `id` is the UUID clientId
 *   - `server_id` carries the Convex `_id` for the sync handshake
 *   - `updated_at` is the diff cursor used by /sync/pull
 *
 * Keep this aligned with packages/backend/convex/schema.ts and
 * packages/backend/convex/lib/sync.ts SYNCED_TABLES.
 */
export const watermelonSchema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    // ===== Catalog (read-only on tablet) =====
    tableSchema({
      name: "categories",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "parent_id", type: "string", isOptional: true, isIndexed: true },
        { name: "sort_order", type: "number" },
        { name: "is_active", type: "boolean" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "products",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "category_id", type: "string", isIndexed: true },
        { name: "price", type: "number" },
        { name: "is_vatable", type: "boolean" },
        { name: "is_active", type: "boolean", isIndexed: true },
        { name: "is_open_price", type: "boolean", isOptional: true },
        { name: "min_price", type: "number", isOptional: true },
        { name: "max_price", type: "number", isOptional: true },
        { name: "sort_order", type: "number" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "modifier_groups",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "selection_type", type: "string" },
        { name: "min_selections", type: "number" },
        { name: "max_selections", type: "number", isOptional: true },
        { name: "sort_order", type: "number" },
        { name: "is_active", type: "boolean" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "modifier_options",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isOptional: true, isIndexed: true },
        { name: "modifier_group_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "price_adjustment", type: "number" },
        { name: "is_default", type: "boolean" },
        { name: "is_available", type: "boolean" },
        { name: "sort_order", type: "number" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "modifier_group_assignments",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "modifier_group_id", type: "string", isIndexed: true },
        { name: "product_id", type: "string", isOptional: true, isIndexed: true },
        { name: "category_id", type: "string", isOptional: true, isIndexed: true },
        { name: "sort_order", type: "number" },
        { name: "min_selections_override", type: "number", isOptional: true },
        { name: "max_selections_override", type: "number", isOptional: true },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "tables",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "capacity", type: "number", isOptional: true },
        { name: "status", type: "string", isIndexed: true },
        { name: "current_order_id", type: "string", isOptional: true },
        { name: "sort_order", type: "number" },
        { name: "is_active", type: "boolean" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),

    // ===== Transactional core (read+write on tablet) =====
    tableSchema({
      name: "orders",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "order_number", type: "string", isOptional: true },
        { name: "order_type", type: "string" },
        { name: "order_channel", type: "string", isOptional: true },
        { name: "takeout_status", type: "string", isOptional: true },
        { name: "table_id", type: "string", isOptional: true, isIndexed: true },
        { name: "customer_name", type: "string", isOptional: true },
        { name: "draft_label", type: "string", isOptional: true },
        { name: "status", type: "string", isIndexed: true },
        { name: "gross_sales", type: "number" },
        { name: "vatable_sales", type: "number" },
        { name: "vat_amount", type: "number" },
        { name: "vat_exempt_sales", type: "number" },
        { name: "non_vat_sales", type: "number" },
        { name: "discount_amount", type: "number" },
        { name: "net_sales", type: "number" },
        { name: "payment_method", type: "string", isOptional: true },
        { name: "cash_received", type: "number", isOptional: true },
        { name: "change_given", type: "number", isOptional: true },
        { name: "card_payment_type", type: "string", isOptional: true },
        { name: "card_reference_number", type: "string", isOptional: true },
        { name: "order_category", type: "string", isOptional: true },
        { name: "table_marker", type: "string", isOptional: true },
        { name: "created_by", type: "string" },
        { name: "created_at", type: "number" },
        { name: "paid_at", type: "number", isOptional: true },
        { name: "paid_by", type: "string", isOptional: true },
        { name: "pax", type: "number", isOptional: true },
        { name: "tab_number", type: "number", isOptional: true },
        { name: "tab_name", type: "string", isOptional: true },
        { name: "request_id", type: "string", isOptional: true },
        { name: "table_name", type: "string", isOptional: true },
        { name: "item_count", type: "number", isOptional: true },
        { name: "origin_device_id", type: "string", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_items",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_id", type: "string", isIndexed: true },
        { name: "product_id", type: "string", isIndexed: true },
        { name: "product_name", type: "string" },
        { name: "product_price", type: "number" },
        { name: "quantity", type: "number" },
        { name: "notes", type: "string", isOptional: true },
        { name: "service_type", type: "string", isOptional: true },
        { name: "is_voided", type: "boolean" },
        { name: "is_sent_to_kitchen", type: "boolean", isOptional: true },
        { name: "voided_by", type: "string", isOptional: true },
        { name: "voided_at", type: "number", isOptional: true },
        { name: "void_reason", type: "string", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_item_modifiers",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_item_id", type: "string", isIndexed: true },
        { name: "modifier_group_name", type: "string" },
        { name: "modifier_option_name", type: "string" },
        { name: "price_adjustment", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_discounts",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_id", type: "string", isIndexed: true },
        { name: "order_item_id", type: "string", isOptional: true },
        { name: "discount_type", type: "string" },
        { name: "customer_name", type: "string" },
        { name: "customer_id", type: "string" },
        { name: "quantity_applied", type: "number" },
        { name: "discount_amount", type: "number" },
        { name: "vat_exempt_amount", type: "number" },
        { name: "approved_by", type: "string" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_voids",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_id", type: "string", isIndexed: true },
        { name: "void_type", type: "string" },
        { name: "order_item_id", type: "string", isOptional: true },
        { name: "reason", type: "string" },
        { name: "approved_by", type: "string" },
        { name: "requested_by", type: "string" },
        { name: "amount", type: "number" },
        { name: "created_at", type: "number" },
        { name: "refund_method", type: "string", isOptional: true },
        { name: "replacement_order_id", type: "string", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_payments",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_id", type: "string", isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "payment_method", type: "string" },
        { name: "amount", type: "number" },
        { name: "cash_received", type: "number", isOptional: true },
        { name: "change_given", type: "number", isOptional: true },
        { name: "card_payment_type", type: "string", isOptional: true },
        { name: "card_reference_number", type: "string", isOptional: true },
        { name: "created_at", type: "number" },
        { name: "created_by", type: "string" },
        { name: "updated_at", type: "number" },
      ],
    }),

    // ===== Reference data =====
    tableSchema({
      name: "users",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "name", type: "string", isOptional: true },
        { name: "email", type: "string", isOptional: true },
        { name: "role_id", type: "string", isOptional: true },
        { name: "store_id", type: "string", isOptional: true, isIndexed: true },
        { name: "pin", type: "string", isOptional: true },
        { name: "is_active", type: "boolean", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "roles",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "name", type: "string" },
        { name: "permissions", type: "string" }, // JSON-stringified array
        { name: "scope_level", type: "string" },
        { name: "is_system", type: "boolean" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "stores",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "name", type: "string" },
        { name: "parent_id", type: "string", isOptional: true },
        { name: "logo", type: "string", isOptional: true },
        { name: "address1", type: "string" },
        { name: "address2", type: "string", isOptional: true },
        { name: "tin", type: "string" },
        { name: "min", type: "string" },
        { name: "vat_rate", type: "number" },
        { name: "printer_mac", type: "string", isOptional: true },
        { name: "kitchen_printer_mac", type: "string", isOptional: true },
        { name: "contact_number", type: "string", isOptional: true },
        { name: "telephone", type: "string", isOptional: true },
        { name: "email", type: "string", isOptional: true },
        { name: "website", type: "string", isOptional: true },
        { name: "footer", type: "string", isOptional: true },
        { name: "schedule_json", type: "string", isOptional: true },
        { name: "is_active", type: "boolean" },
        { name: "created_at", type: "number" },
        { name: "device_code_counter", type: "number", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "settings",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isOptional: true, isIndexed: true },
        { name: "key", type: "string", isIndexed: true },
        { name: "value", type: "string" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "app_config",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "key", type: "string", isIndexed: true },
        { name: "value", type: "string" },
        { name: "store_id", type: "string", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),

    // ===== Local-only meta =====
    tableSchema({
      name: "sync_meta",
      columns: [
        { name: "key", type: "string", isIndexed: true },
        { name: "value", type: "string" },
      ],
    }),
  ],
});
