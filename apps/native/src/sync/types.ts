export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export type SyncPhase = "pull" | "apply" | "push";

export type SyncProgress = {
  /** Current phase of the sync run. */
  phase: SyncPhase;
  /** 1-based index of the page currently being fetched or applied. */
  pageIndex: number;
  /** Cumulative created+updated+deleted rows applied so far this run. */
  rowsApplied: number;
  /**
   * Snake_case table name of the most recent collection that produced rows
   * in the current page. Null when the run hasn't seen any rows yet (e.g. an
   * empty incremental pull) or during push.
   */
  currentTable: string | null;
  /**
   * Per-table cumulative count for this run, snake_case keys matching
   * WatermelonDB collection names. Rendered as a breakdown in the Force
   * Resync row.
   */
  tablesApplied: Record<string, number>;
};

export type SyncState = {
  status: SyncStatus;
  lastPulledAt: number | null;
  lastPushedAt: number | null;
  pendingMutationCount: number;
  lastError: string | null;
  /** Live progress while `status === "syncing"`. Null in every other state. */
  progress: SyncProgress | null;
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
