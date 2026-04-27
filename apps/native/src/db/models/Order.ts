import { Model } from "@nozbe/watermelondb";
import { children, field, relation, text } from "@nozbe/watermelondb/decorators";

export class Order extends Model {
  static table = "orders";
  static associations = {
    order_items: { type: "has_many" as const, foreignKey: "order_id" },
    order_payments: { type: "has_many" as const, foreignKey: "order_id" },
    order_discounts: { type: "has_many" as const, foreignKey: "order_id" },
    order_voids: { type: "has_many" as const, foreignKey: "order_id" },
    tables: { type: "belongs_to" as const, key: "table_id" },
  };

  @text("server_id") serverId?: string;
  @field("store_id") storeId!: string;
  @text("order_number") orderNumber?: string;
  @text("order_type") orderType!: string;
  @text("order_channel") orderChannel?: string;
  @text("takeout_status") takeoutStatus?: string;
  @field("table_id") tableId?: string;
  @text("customer_name") customerName?: string;
  @text("draft_label") draftLabel?: string;
  @text("status") status!: string;
  @field("gross_sales") grossSales!: number;
  @field("vatable_sales") vatableSales!: number;
  @field("vat_amount") vatAmount!: number;
  @field("vat_exempt_sales") vatExemptSales!: number;
  @field("non_vat_sales") nonVatSales!: number;
  @field("discount_amount") discountAmount!: number;
  @field("net_sales") netSales!: number;
  @text("payment_method") paymentMethod?: string;
  @field("cash_received") cashReceived?: number;
  @field("change_given") changeGiven?: number;
  @text("card_payment_type") cardPaymentType?: string;
  @text("card_reference_number") cardReferenceNumber?: string;
  @text("order_category") orderCategory?: string;
  @text("table_marker") tableMarker?: string;
  @field("created_by") createdBy!: string;
  @field("created_at") createdAt!: number;
  @field("paid_at") paidAt?: number;
  @field("paid_by") paidBy?: string;
  @field("pax") pax?: number;
  @field("tab_number") tabNumber?: number;
  @text("tab_name") tabName?: string;
  @text("request_id") requestId?: string;
  @text("table_name") tableNameSnapshot?: string;
  @field("item_count") itemCount?: number;
  @text("origin_device_id") originDeviceId?: string;
  @field("updated_at") updatedAt!: number;

  @children("order_items") items: unknown;
  @children("order_payments") payments: unknown;
  @children("order_discounts") discounts: unknown;
  @children("order_voids") voids: unknown;
  // Renamed from `table` to avoid shadowing Model.table (the static-ish
  // class accessor used by WatermelonDB internals).
  @relation("tables", "table_id") tableRef: unknown;
}
