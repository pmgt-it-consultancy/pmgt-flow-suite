import { Model } from "@nozbe/watermelondb";
import { text } from "@nozbe/watermelondb/decorators";

/**
 * Local-only key/value table for sync metadata: lastPulledAt cursor,
 * order-number counters, etc. Never synced — purely client-side state
 * that survives app restarts.
 */
export class SyncMeta extends Model {
  static table = "sync_meta";

  @text("key") key!: string;
  @text("value") value!: string;
}
