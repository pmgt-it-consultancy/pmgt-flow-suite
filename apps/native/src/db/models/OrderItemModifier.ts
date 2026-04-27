import { Model } from "@nozbe/watermelondb";
import { field, relation, text } from "@nozbe/watermelondb/decorators";

export class OrderItemModifier extends Model {
  static table = "order_item_modifiers";
  static associations = {
    order_items: { type: "belongs_to" as const, key: "order_item_id" },
  };

  @text("server_id") serverId?: string;
  @field("order_item_id") orderItemId!: string;
  @text("modifier_group_name") modifierGroupName!: string;
  @text("modifier_option_name") modifierOptionName!: string;
  @field("price_adjustment") priceAdjustment!: number;
  @field("updated_at") updatedAt!: number;

  @relation("order_items", "order_item_id") orderItem: unknown;
}
