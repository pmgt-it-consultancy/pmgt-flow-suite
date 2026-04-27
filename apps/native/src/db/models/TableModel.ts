import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

/**
 * `Table` collides with TypeScript's reserved-name conventions and
 * reads ambiguously alongside the `tableSchema()` API; exported as
 * `TableModel` for clarity. The underlying SQLite table is "tables".
 */
export class TableModel extends Model {
  static table = "tables";

  @text("server_id") serverId?: string;
  @field("store_id") storeId!: string;
  @text("name") name!: string;
  @field("capacity") capacity?: number;
  @text("status") status!: string;
  @field("current_order_id") currentOrderId?: string;
  @field("sort_order") sortOrder!: number;
  @field("is_active") isActive!: boolean;
  @field("created_at") createdAt!: number;
  @field("updated_at") updatedAt!: number;
}
