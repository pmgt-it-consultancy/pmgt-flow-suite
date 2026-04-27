import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class Setting extends Model {
  static table = "settings";

  @text("server_id") serverId?: string;
  @field("store_id") storeId?: string;
  @text("key") key!: string;
  @text("value") value!: string;
  @field("updated_at") updatedAt!: number;
}
