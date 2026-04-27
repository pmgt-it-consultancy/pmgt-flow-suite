import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class AppConfig extends Model {
  static table = "app_config";

  @text("server_id") serverId?: string;
  @text("key") key!: string;
  @text("value") value!: string;
  @field("store_id") storeId?: string;
  @field("updated_at") updatedAt!: number;
}
