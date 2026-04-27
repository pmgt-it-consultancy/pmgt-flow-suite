import { Model } from "@nozbe/watermelondb";
import { field, relation, text } from "@nozbe/watermelondb/decorators";

export class Product extends Model {
  static table = "products";
  static associations = {
    categories: { type: "belongs_to" as const, key: "category_id" },
  };

  @text("server_id") serverId?: string;
  @field("store_id") storeId!: string;
  @text("name") name!: string;
  @field("category_id") categoryId!: string;
  @field("price") price!: number;
  @field("is_vatable") isVatable!: boolean;
  @field("is_active") isActive!: boolean;
  @field("is_open_price") isOpenPrice?: boolean;
  @field("min_price") minPrice?: number;
  @field("max_price") maxPrice?: number;
  @field("sort_order") sortOrder!: number;
  @field("created_at") createdAt!: number;
  @field("updated_at") updatedAt!: number;

  @relation("categories", "category_id") category: unknown;
}
