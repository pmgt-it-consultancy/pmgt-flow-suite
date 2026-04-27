import { Model } from "@nozbe/watermelondb";
import { children, field, text } from "@nozbe/watermelondb/decorators";

export class ModifierGroup extends Model {
  static table = "modifier_groups";
  static associations = {
    modifier_options: { type: "has_many" as const, foreignKey: "modifier_group_id" },
  };

  @text("server_id") serverId?: string;
  @field("store_id") storeId!: string;
  @text("name") name!: string;
  @text("selection_type") selectionType!: string;
  @field("min_selections") minSelections!: number;
  @field("max_selections") maxSelections?: number;
  @field("sort_order") sortOrder!: number;
  @field("is_active") isActive!: boolean;
  @field("created_at") createdAt!: number;
  @field("updated_at") updatedAt!: number;

  @children("modifier_options") options: unknown;
}
