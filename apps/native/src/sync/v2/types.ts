export type ReplicationStream = "store_core" | "catalog" | "floor" | "operational_orders";

export type StreamCheckpoint = {
  stream: ReplicationStream;
  eventCursor: string | null;
  generation: string;
};

export type StoredCheckpoint = Pick<StreamCheckpoint, "eventCursor" | "generation">;

export type AggregateEnvelope = {
  order: Record<string, unknown>;
  items: Record<string, unknown>[];
  modifiers: Record<string, unknown>[];
  discounts: Record<string, unknown>[];
  voids: Record<string, unknown>[];
  payments: Record<string, unknown>[];
};

export type OperationalSnapshot = {
  protocolVersion: 2;
  stream: "operational_orders";
  aggregates: AggregateEnvelope[];
  checkpoint: StreamCheckpoint;
};

export type OperationalDelta = {
  protocolVersion: 2;
  stream: "operational_orders";
  changes: Array<{
    entityId: string;
    eventKind: string;
    aggregateVersion: number;
    operationId?: string;
    aggregate: AggregateEnvelope | null;
  }>;
  hasMore: boolean;
  checkpoint: StreamCheckpoint;
};

export const isSyncV2Enabled = process.env.EXPO_PUBLIC_SYNC_V2 === "1";
