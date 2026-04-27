export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export type SyncState = {
  status: SyncStatus;
  lastPulledAt: number | null;
  lastPushedAt: number | null;
  pendingMutationCount: number;
  lastError: string | null;
};

export type WatermelonRow = {
  id: string;
  server_id?: string;
  updated_at?: number;
  [k: string]: unknown;
};

export type ChangeBucket = {
  created: WatermelonRow[];
  updated: WatermelonRow[];
  deleted: string[];
};

export type PullResponse = {
  changes: Record<string, ChangeBucket>;
  timestamp: number;
};

export type PushPayload = {
  lastPulledAt: number;
  changes: Record<string, { created: WatermelonRow[]; updated: WatermelonRow[] }>;
  clientMutationId: string;
};

export type PushRejection = {
  table: string;
  clientId: string;
  reason: string;
};

export type PushResponse = { success: true } | { rejected: PushRejection[] };
