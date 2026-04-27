import { Model } from "@nozbe/watermelondb";
import { field, relation, text } from "@nozbe/watermelondb/decorators";

export class OrderPayment extends Model {
  static table = "order_payments";
  static associations = {
    orders: { type: "belongs_to" as const, key: "order_id" },
  };

  @text("server_id") serverId?: string;
  @field("order_id") orderId!: string;
  @field("store_id") storeId!: string;
  @text("payment_method") paymentMethod!: string;
  @field("amount") amount!: number;
  @field("cash_received") cashReceived?: number;
  @field("change_given") changeGiven?: number;
  @text("card_payment_type") cardPaymentType?: string;
  @text("card_reference_number") cardReferenceNumber?: string;
  @field("created_at") createdAt!: number;
  @field("created_by") createdBy!: string;
  @field("updated_at") updatedAt!: number;

  @relation("orders", "order_id") order: unknown;
}
