import { Model } from "@nozbe/watermelondb";
import { children, field, relation, text } from "@nozbe/watermelondb/decorators";

export class OrderItem extends Model {
  static table = "order_items";
  static associations = {
    order_item_modifiers: { type: "has_many" as const, foreignKey: "order_item_id" },
    orders: { type: "belongs_to" as const, key: "order_id" },
    products: { type: "belongs_to" as const, key: "product_id" },
  };

  @text("server_id") serverId?: string;
  @field("order_id") orderId!: string;
  @field("product_id") productId!: string;
  @text("product_name") productName!: string;
  @field("product_price") productPrice!: number;
  @field("quantity") quantity!: number;
  @text("notes") notes?: string;
  @text("service_type") serviceType?: string;
  @field("is_voided") isVoided!: boolean;
  @field("is_sent_to_kitchen") isSentToKitchen?: boolean;
  @field("voided_by") voidedBy?: string;
  @field("voided_at") voidedAt?: number;
  @text("void_reason") voidReason?: string;
  @field("updated_at") updatedAt!: number;

  @children("order_item_modifiers") modifiers: unknown;
  @relation("orders", "order_id") order: unknown;
  @relation("products", "product_id") product: unknown;
}
