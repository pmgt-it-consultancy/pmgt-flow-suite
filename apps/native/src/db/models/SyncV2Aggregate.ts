import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class SyncV2Aggregate extends Model {
  static table = "sync_v2_aggregates";

  @text("store_id") storeId!: string;
  @text("order_id") orderId!: string;
  @field("aggregate_version") aggregateVersion!: number;
  @text("payload") payload!: string;
  @field("updated_at") updatedAt!: number;
}
