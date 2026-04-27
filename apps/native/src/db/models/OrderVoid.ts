import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class OrderVoid extends Model {
  static table = "order_voids";
  static associations = {
    orders: { type: "belongs_to" as const, key: "order_id" },
  };

  @text("server_id") serverId?: string;
  @field("order_id") orderId!: string;
  @text("void_type") voidType!: string;
  @field("order_item_id") orderItemId?: string;
  @text("reason") reason!: string;
  @field("approved_by") approvedBy!: string;
  @field("requested_by") requestedBy!: string;
  @field("amount") amount!: number;
  @field("created_at") createdAt!: number;
  @text("refund_method") refundMethod?: string;
  @field("replacement_order_id") replacementOrderId?: string;
  @field("updated_at") updatedAt!: number;
}
