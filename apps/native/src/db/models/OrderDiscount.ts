import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class OrderDiscount extends Model {
  static table = "order_discounts";
  static associations = {
    orders: { type: "belongs_to" as const, key: "order_id" },
  };

  @text("server_id") serverId?: string;
  @field("order_id") orderId!: string;
  @field("order_item_id") orderItemId?: string;
  @text("discount_type") discountType!: string;
  @text("customer_name") customerName!: string;
  @text("customer_id") customerId!: string;
  @field("quantity_applied") quantityApplied!: number;
  @field("discount_amount") discountAmount!: number;
  @field("vat_exempt_amount") vatExemptAmount!: number;
  @field("approved_by") approvedBy!: string;
  @field("created_at") createdAt!: number;
  @field("updated_at") updatedAt!: number;
}
