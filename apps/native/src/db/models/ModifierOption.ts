import { Model } from "@nozbe/watermelondb";
import { field, relation, text } from "@nozbe/watermelondb/decorators";

export class ModifierOption extends Model {
  static table = "modifier_options";
  static associations = {
    modifier_groups: { type: "belongs_to" as const, key: "modifier_group_id" },
  };

  @text("server_id") serverId?: string;
  @field("store_id") storeId?: string;
  @field("modifier_group_id") modifierGroupId!: string;
  @text("name") name!: string;
  @field("price_adjustment") priceAdjustment!: number;
  @field("is_default") isDefault!: boolean;
  @field("is_available") isAvailable!: boolean;
  @field("sort_order") sortOrder!: number;
  @field("created_at") createdAt!: number;
  @field("updated_at") updatedAt!: number;

  @relation("modifier_groups", "modifier_group_id") group: unknown;
}
