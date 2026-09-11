import { type Database, Q } from "@nozbe/watermelondb";
import type { SyncV2Aggregate } from "../../db/models/SyncV2Aggregate";
import type { AggregateEnvelope } from "./types";

export type AggregateChange = {
  storeId: string;
  entityId: string;
  aggregateVersion: number;
  aggregate: AggregateEnvelope | null;
};

export async function applyAggregateEnvelope(
  database: Database,
  change: AggregateChange,
): Promise<"applied" | "ignored"> {
  return database.write(async () => {
    const collection = database.get<SyncV2Aggregate>("sync_v2_aggregates");
    const existing = await collection
      .query(Q.where("store_id", change.storeId), Q.where("order_id", change.entityId))
      .fetch();
    const current = existing[0];
    if (current && current.aggregateVersion >= change.aggregateVersion) return "ignored";

    if (!change.aggregate) {
      if (current) await database.batch(current.prepareDestroyPermanently());
      return "applied";
    }

    const payload = JSON.stringify(change.aggregate);
    const now = Date.now();
    const operation = current
      ? current.prepareUpdate((record) => {
          record.aggregateVersion = change.aggregateVersion;
          record.payload = payload;
          record.updatedAt = now;
        })
      : collection.prepareCreate((record) => {
          record.storeId = change.storeId;
          record.orderId = change.entityId;
          record.aggregateVersion = change.aggregateVersion;
          record.payload = payload;
          record.updatedAt = now;
        });
    await database.batch(operation);
    return "applied";
  });
}
