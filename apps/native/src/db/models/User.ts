import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class User extends Model {
  static table = "users";

  @text("server_id") serverId?: string;
  @text("name") name?: string;
  @text("email") email?: string;
  @field("role_id") roleId?: string;
  @field("store_id") storeId?: string;
  @text("pin") pin?: string;
  @field("is_active") isActive?: boolean;
  @field("updated_at") updatedAt!: number;
}
