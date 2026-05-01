import type { Collection, Database, Model } from "@nozbe/watermelondb";
import { Q } from "@nozbe/watermelondb";
import { synchronize } from "@nozbe/watermelondb/sync";
import { getOrCreateDeviceId } from "../auth/deviceId";
import { getDatabase } from "../db";
import { generateUUID } from "./idBridge";
import { subscribeToNetworkChanges } from "./networkStatus";
import { callPull, callPush, callRegisterDevice } from "./syncEndpoints";
import type { ChangeBucket, CursorMap, SyncState, WatermelonRow } from "./types";

// Bound the pull loop so a server bug returning complete:false forever can't
// hang the client. 50 pages * 1500 rows-per-request = 75k rows, far above any
// realistic store's first-pull volume.
const MAX_PULL_PAGES = 50;

/**
 * Hands control back to the event loop so the JS thread can render a frame
 * between page applies. `setTimeout(0)` queues at the end of the macrotask
 * queue; `Promise.resolve()` would not yield far enough.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Maps camelCase Convex collection names to the snake_case WatermelonDB
 * table names used in `tablesApplied`. The pull payload uses camelCase, so
 * we translate before counting.
 */
function camelCollectionToSnake(name: string): string {
  return name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

const PULL_PERIOD_MS = 60_000;
const RETRY_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];

type Listener = (s: SyncState) => void;

/**
 * Singleton orchestrator for the offline-first sync layer. Wraps
 * WatermelonDB's `synchronize` against /sync/pull and /sync/push,
 * handles retry/backoff on failure, and triggers a fresh sync when
 * NetInfo reports the network has come back.
 *
 * Lifecycle:
 *   start()   — call once after the user is signed in (so syncEndpoints
 *               can read an auth token). Starts periodic timer and
 *               subscribes to network changes.
 *   stop()    — call on sign-out.
 *   syncNow() — explicit trigger (e.g. "Sync now" button or
 *               Z-Report-precondition gate).
 *
 * State: subscribers see a SyncState reflecting current status, last
 * sync timestamps, error, and live per-page progress.
 */
class SyncManagerImpl {
  private state: SyncState = {
    status: "idle",
    lastPulledAt: null,
    lastPushedAt: null,
    lastError: null,
    progress: null,
  };
  private listeners = new Set<Listener>();
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private retryAttempt = 0;
  private deviceId = "";
  private deviceCode = "";
  private unsubNet: (() => void) | null = null;
  private started = false;
  private pushDebounce: ReturnType<typeof setTimeout> | null = null;

  async start(storeId: string): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.deviceId = await getOrCreateDeviceId();

    // One-time cursor reset for upgrades from schema v1. v1 silently
    // sanitized rows pulled with camelCase keys to defaults, so catalog
    // data on disk is mostly empty — force a full re-pull once.
    const adapter = getDatabase().adapter as unknown as {
      getLocal: (k: string) => Promise<string | null>;
      setLocal: (k: string, v: string) => Promise<void>;
    };
    const resetFlag = await adapter.getLocal("__sync_cursor_reset_v2");
    if (!resetFlag) {
      await adapter.setLocal("__watermelon_last_pulled_at", "0");
      await adapter.setLocal("__sync_cursor_reset_v2", "1");
    }

    try {
      const result = await callRegisterDevice(this.deviceId, storeId);
      this.deviceCode = result.deviceCode;
    } catch (err) {
      console.warn("[SyncManager] device registration failed:", err);
    }

    this.unsubNet = subscribeToNetworkChanges((online) => {
      if (online) {
        this.setState({ status: "idle" });
        void this.syncOnce();
      } else {
        this.setState({ status: "offline" });
      }
    });

    this.periodicTimer = setInterval(() => void this.syncOnce(), PULL_PERIOD_MS);
    void this.syncOnce();
  }

  stop(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.unsubNet) {
      this.unsubNet();
      this.unsubNet = null;
    }
    this.started = false;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): SyncState {
    return this.state;
  }

  getDeviceCode(): string {
    return this.deviceCode;
  }

  /**
   * Called by service functions after any local write. Pushes immediately
   * but debounces: multiple calls within 500ms collapse into one push so
   * rapid-fire cart edits don't hammer the Convex backend.
   */
  triggerPush(): void {
    if (this.pushDebounce) clearTimeout(this.pushDebounce);
    this.pushDebounce = setTimeout(() => void this.syncOnce(), 500);
  }

  async syncNow(): Promise<void> {
    return this.syncOnce();
  }

  /**
   * Force a full re-sync from scratch. Resets the WatermelonDB pull cursor
   * to zero, so the next pull fetches all rows from the server. Used when
   * the local data is stale or incomplete (e.g. after a schema migration
   * or a sync bug that left the catalog empty).
   */
  async forceFullResync(): Promise<void> {
    const adapter = getDatabase().adapter as unknown as {
      getLocal: (k: string) => Promise<string | null>;
      setLocal: (k: string, v: string) => Promise<void>;
    };
    await adapter.setLocal("__watermelon_last_pulled_at", "0");
    return this.syncOnce();
  }

  /**
   * One sync run. Drives WatermelonDB's `synchronize()` once per server page
   * so the apply phase commits in small SQLite transactions and yields to
   * the event loop between pages — keeps the JS thread responsive on a
   * Force Resync against a populated store.
   *
   * Server cursors and `serverNow` are threaded through closure variables
   * so each iteration's `since` matches the original pull start (matches
   * existing protocol; no backend change). Push runs once per `syncOnce()`
   * invocation, on the first iteration only.
   *
   * Progress is stamped on `state.progress` at every meaningful boundary:
   * before each pull, after each apply, and during the push step.
   */
  private async syncOnce(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.setState({
      status: "syncing",
      progress: {
        phase: "pull",
        pageIndex: 1,
        rowsApplied: 0,
        currentTable: null,
        tablesApplied: {},
      },
    });

    let pageIndex = 1;
    let rowsApplied = 0;
    const tablesApplied: Record<string, number> = {};
    let cursors: CursorMap | undefined;
    let serverNow: number | undefined;
    let pushDone = false;
    // Capture the original `lastPulledAt` once. WatermelonDB advances its
    // own lastPulledAt after every synchronize() apply (to the timestamp we
    // returned, i.e. `serverNow`), so on iter 2+ the parameter passed to
    // pullChanges is `serverNow`, not the original since. Convex
    // pagination cursors are only valid against the index range they were
    // generated for — we MUST keep `since` constant across the loop.
    let initialSince: number | null = null;
    let initialSinceCaptured = false;

    try {
      while (true) {
        let pageComplete = false;
        let thisPageRows = 0;
        let thisPageTopTable: string | null = null;

        await synchronize({
          database: getDatabase(),
          pullChanges: async ({ lastPulledAt }) => {
            if (!initialSinceCaptured) {
              initialSince = lastPulledAt ?? null;
              initialSinceCaptured = true;
            }
            // Always send the captured initialSince to the server — never
            // the per-iter `lastPulledAt`, which advances after each apply
            // and would invalidate our pagination cursors.
            const page = await callPull(initialSince, cursors, serverNow);
            if (serverNow === undefined) serverNow = page.timestamp;
            cursors = page.cursors;
            pageComplete = page.complete;

            const counts = countRows(page.changes as Record<string, ChangeBucket>);
            thisPageRows = counts.total;
            // Pick the table with the most rows in this page as
            // `currentTable` — the user-visible signal of what's being
            // applied right now. Tables map from camelCase (server) to
            // snake_case (WM) so the UI label matches the local schema.
            let topRows = 0;
            for (const [table, n] of Object.entries(counts.perTable)) {
              const snake = camelCollectionToSnake(table);
              tablesApplied[snake] = (tablesApplied[snake] ?? 0) + n;
              if (n > topRows) {
                topRows = n;
                thisPageTopTable = snake;
              }
            }

            this.setState({
              progress: {
                phase: "apply",
                pageIndex,
                rowsApplied: rowsApplied + thisPageRows,
                currentTable: thisPageTopTable,
                tablesApplied: { ...tablesApplied },
              },
            });

            // /sync/pull returns camelCase collection names AND camelCase row
            // fields (matching the Convex schema). WatermelonDB's local schema
            // uses snake_case for both, so translate at every level.
            const mapped = mapPullChanges(
              page.changes as Record<string, ChangeBucket>,
            ) as unknown as Record<string, ChangeBucket>;
            return {
              changes: await demoteExistingCreates(getDatabase(), mapped),
              timestamp: page.timestamp,
            };
          },
          pushChanges: async ({ changes, lastPulledAt }) => {
            // Push outgoing mutations once per `syncOnce()` invocation, on
            // the first page only. Subsequent pages skip push: the local
            // outbox is unchanged across pages, and re-sending mutations
            // the server already accepted would produce noisy duplicates
            // even if they're idempotent.
            if (pushDone) return;
            const typedChanges = changes as Record<
              string,
              {
                created: WatermelonRow[];
                updated: WatermelonRow[];
                deleted?: string[];
              }
            >;
            if (allEmpty(typedChanges)) {
              pushDone = true;
              return;
            }
            this.setState({
              progress: {
                phase: "push",
                pageIndex,
                rowsApplied,
                currentTable: null,
                tablesApplied: { ...tablesApplied },
              },
            });
            const clientMutationId = generateUUID();
            // WatermelonDB hands rows in snake_case (its schema's column names);
            // /sync/push expects camelCase keys at both the collection and row
            // level. Strip Watermelon's internal `_status` / `_changed` markers
            // along the way — applyPushedRow on the backend doesn't read them.
            const mapped = mapPushChanges(typedChanges);
            const response = await callPush(
              {
                lastPulledAt: lastPulledAt ?? 0,
                changes: mapped,
                clientMutationId,
              },
              this.deviceId,
            );
            if ("rejected" in response && response.rejected.length > 0) {
              console.warn("[SyncManager] push rejections:", response.rejected);
            }
            pushDone = true;
          },
          sendCreatedAsUpdated: false,
        });

        rowsApplied += thisPageRows;
        if (pageComplete) break;

        pageIndex += 1;
        if (pageIndex > MAX_PULL_PAGES) {
          throw new Error(`syncOnce: did not complete within ${MAX_PULL_PAGES} pages`);
        }
        this.setState({
          progress: {
            phase: "pull",
            pageIndex,
            rowsApplied,
            currentTable: thisPageTopTable,
            tablesApplied: { ...tablesApplied },
          },
        });
        await yieldToEventLoop();
      }

      this.retryAttempt = 0;
      this.setState({
        status: "idle",
        lastPulledAt: Date.now(),
        lastPushedAt: Date.now(),
        lastError: null,
        progress: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SyncManager]", msg);
      this.setState({ status: "error", lastError: msg, progress: null });
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
    }
  }

  private scheduleRetry(): void {
    const delay = RETRY_BACKOFF_MS[Math.min(this.retryAttempt, RETRY_BACKOFF_MS.length - 1)];
    this.retryAttempt++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.syncOnce(), delay);
  }

  private setState(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
}

export type PageRowCounts = {
  total: number;
  perTable: Record<string, number>;
};

/**
 * Count rows in a single /sync/pull page payload. Returns the grand total
 * (created + updated + deleted across all tables) plus a per-table
 * breakdown that excludes tables with zero activity in this page. Drives
 * `SyncProgress.rowsApplied` and `SyncProgress.tablesApplied`.
 */
export function countRows(changes: Record<string, ChangeBucket>): PageRowCounts {
  let total = 0;
  const perTable: Record<string, number> = {};
  for (const [table, bucket] of Object.entries(changes)) {
    const n = bucket.created.length + bucket.updated.length + (bucket.deleted?.length ?? 0);
    if (n === 0) continue;
    perTable[table] = n;
    total += n;
  }
  return { total, perTable };
}

function allEmpty(
  changes: Record<
    string,
    { created: WatermelonRow[]; updated: WatermelonRow[]; deleted?: string[] }
  >,
): boolean {
  for (const t of Object.values(changes)) {
    if (t.created.length > 0 || t.updated.length > 0 || (t.deleted?.length ?? 0) > 0) return false;
  }
  return true;
}

/**
 * Translates a /sync/pull payload (camelCase collections + camelCase row
 * fields) into the snake_case shape WatermelonDB expects. Also drops any
 * `_*` keys WM treats as reserved, so applyRemote doesn't reject the row.
 */
function mapPullChanges(changes: Record<string, ChangeBucket>): Record<string, ChangeBucket> {
  const out: Record<string, ChangeBucket> = {};

  for (const [collection, bucket] of Object.entries(changes)) {
    out[camelToSnake(collection)] = {
      created: (bucket.created ?? []).map((row) => translateRow(row, camelToSnake, true)),
      updated: (bucket.updated ?? []).map((row) => translateRow(row, camelToSnake, true)),
      deleted: bucket.deleted ?? [],
    };
  }
  return out;
}

/**
 * Translates a WatermelonDB push payload (snake_case collections + snake_case
 * row fields, plus internal `_status`/`_changed` markers) into the camelCase
 * shape /sync/push expects.
 */
function mapPushChanges(
  changes: Record<
    string,
    { created: WatermelonRow[]; updated: WatermelonRow[]; deleted?: string[] }
  >,
): Record<string, { created: WatermelonRow[]; updated: WatermelonRow[]; deleted?: string[] }> {
  const out: Record<
    string,
    { created: WatermelonRow[]; updated: WatermelonRow[]; deleted?: string[] }
  > = {};
  for (const [collection, bucket] of Object.entries(changes)) {
    out[snakeToCamel(collection)] = {
      created: (bucket.created ?? []).map((row) => translateRow(row, snakeToCamel, true)),
      updated: (bucket.updated ?? []).map((row) => translateRow(row, snakeToCamel, true)),
      deleted: bucket.deleted ?? [],
    };
  }
  return out;
}

/**
 * Re-keys a single sync row. `id` is always preserved verbatim. Any key
 * starting with `_` is stripped — those are WatermelonDB's internal change
 * markers (`_status`, `_changed`) which neither side of the wire wants.
 */
function translateRow(
  row: WatermelonRow,
  translate: (key: string) => string,
  stripInternal: boolean,
): WatermelonRow {
  const out: WatermelonRow = { id: row.id } as WatermelonRow;
  for (const [k, v] of Object.entries(row)) {
    if (k === "id") continue;
    if (stripInternal && k.startsWith("_")) continue;
    out[translate(k)] = v;
  }
  return out;
}

/**
 * After a successful push, the server creates a Convex document whose
 * `_creationTime` is *after* the device's last pull cursor. On the next
 * pull the server puts that row in the "created" bucket, but the row
 * already exists in WatermelonDB (the device created it locally).
 * A raw INSERT for "created" rows then fails with SQLITE_CONSTRAINT_PRIMARYKEY.
 *
 * Fix: scan each "created" list for IDs that already exist locally and
 * move them to "updated" so WatermelonDB does an UPDATE instead.
 *
 * Uses a single query per table (Q.oneOf) instead of N individual
 * collection.find() calls, reducing SQLite round-trips from O(N) to O(1).
 */
async function demoteExistingCreates(
  database: Database,
  changes: Record<string, ChangeBucket>,
): Promise<Record<string, ChangeBucket>> {
  const out: Record<string, ChangeBucket> = {};

  // Process all tables in parallel — each table gets one batch query.
  const entries = await Promise.all(
    Object.entries(changes).map(async ([table, bucket]): Promise<[string, ChangeBucket]> => {
      if (bucket.created.length === 0) return [table, bucket];

      let collection: Collection<Model>;
      try {
        collection = database.collections.get(table as any);
      } catch {
        return [table, bucket];
      }

      const ids = bucket.created.map((r) => r.id);
      const existing = await collection.query(Q.where("id", Q.oneOf(ids))).fetch();
      const existingIds = new Set(existing.map((r) => r.id));

      if (existingIds.size === 0) return [table, bucket];

      const demoted: WatermelonRow[] = [];
      const kept: WatermelonRow[] = [];
      for (const row of bucket.created) {
        if (existingIds.has(row.id)) {
          demoted.push(row);
        } else {
          kept.push(row);
        }
      }

      return [
        table,
        {
          created: kept,
          updated: [...bucket.updated, ...demoted],
          deleted: bucket.deleted,
        },
      ];
    }),
  );

  for (const [table, bucket] of entries) {
    out[table] = bucket;
  }
  return out;
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

export const syncManager = new SyncManagerImpl();
