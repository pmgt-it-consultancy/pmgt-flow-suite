import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class ModifierGroupAssignment extends Model {
  static table = "modifier_group_assignments";

  @text("server_id") serverId?: string;
  @field("store_id") storeId!: string;
  @field("modifier_group_id") modifierGroupId!: string;
  @field("product_id") productId?: string;
  @field("category_id") categoryId?: string;
  @field("sort_order") sortOrder!: number;
  @field("min_selections_override") minSelectionsOverride?: number;
  @field("max_selections_override") maxSelectionsOverride?: number;
  @field("created_at") createdAt!: number;
  @field("updated_at") updatedAt!: number;
}
