import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class AuditLog extends Model {
  static table = "audit_logs";

  @text("server_id") serverId?: string;
  @field("store_id") storeId!: string;
  @text("action") action!: string;
  @text("entity_type") entityType!: string;
  @text("entity_id") entityId!: string;
  @text("details") details!: string;
  @field("user_id") userId!: string;
  @field("created_at") createdAt!: number;
  @field("updated_at") updatedAt!: number;
}
