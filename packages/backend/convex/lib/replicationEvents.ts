import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type ReplicationStream = "store_core" | "catalog" | "floor" | "operational_orders";

export type ReplicationEventKind =
  | "upsert"
  | "domain_delete"
  | "membership_enter"
  | "membership_leave"
  | "business_day_settled";

export type AppendReplicationEventArgs = {
  storeId: Id<"stores">;
  stream: ReplicationStream;
  entityType: string;
  entityId: string;
  aggregateVersion: number;
  eventKind: ReplicationEventKind;
  operationId?: string;
};

export async function appendReplicationEvent(
  ctx: MutationCtx,
  args: AppendReplicationEventArgs,
): Promise<Id<"replicationEvents">> {
  if (!Number.isInteger(args.aggregateVersion) || args.aggregateVersion <= 0) {
    throw new Error("aggregateVersion must be a positive integer");
  }
  return ctx.db.insert("replicationEvents", {
    ...args,
    protocolVersion: 2,
  });
}
