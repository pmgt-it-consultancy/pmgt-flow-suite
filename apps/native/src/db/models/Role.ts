import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class Role extends Model {
  static table = "roles";

  @text("server_id") serverId?: string;
  @text("name") name!: string;
  @text("permissions") permissions!: string; // JSON-stringified array of permission strings
  @text("scope_level") scopeLevel!: string;
  @field("is_system") isSystem!: boolean;
  @field("updated_at") updatedAt!: number;
}
