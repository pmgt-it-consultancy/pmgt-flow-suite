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

export type TableCursor = {
  cursor: string | null;
  isDone: boolean;
};
export type CursorMap = Record<string, TableCursor>;

// Single-page response from /sync/pull. The native client pages until
// `complete: true`, merging buckets across pages, then hands one combined
// payload to WatermelonDB.
export type PullResponse = {
  changes: Record<string, ChangeBucket>;
  cursors: CursorMap;
  complete: boolean;
  timestamp: number;
};

export type PushPayload = {
  lastPulledAt: number;
  changes: Record<
    string,
    { created: WatermelonRow[]; updated: WatermelonRow[]; deleted?: string[] }
  >;
  clientMutationId: string;
};

export type PushRejection = {
  table: string;
  clientId: string;
  reason: string;
};

export type PushResponse = { success: true } | { rejected: PushRejection[] };
