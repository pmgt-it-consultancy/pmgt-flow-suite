import { Model } from "@nozbe/watermelondb";
import { children, field, text } from "@nozbe/watermelondb/decorators";

export class Category extends Model {
  static table = "categories";
  static associations = {
    products: { type: "has_many" as const, foreignKey: "category_id" },
  };

  @text("server_id") serverId?: string;
  @field("store_id") storeId!: string;
  @text("name") name!: string;
  @field("parent_id") parentId?: string;
  @field("sort_order") sortOrder!: number;
  @field("is_active") isActive!: boolean;
  @field("created_at") createdAt!: number;
  @field("updated_at") updatedAt!: number;

  @children("products") products: unknown;
}
