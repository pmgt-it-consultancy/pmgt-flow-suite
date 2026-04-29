import { synchronize } from "@nozbe/watermelondb/sync";
import { getOrCreateDeviceId } from "../auth/deviceId";
import { getDatabase } from "../db";
import { generateUUID } from "./idBridge";
import { subscribeToNetworkChanges } from "./networkStatus";
import { callPull, callPush, callRegisterDevice } from "./syncEndpoints";
import type { ChangeBucket, SyncState, WatermelonRow } from "./types";

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
 * sync timestamps, and pending queue depth (TODO: wire from
 * WatermelonDB's outbox).
 */
class SyncManagerImpl {
  private state: SyncState = {
    status: "idle",
    lastPulledAt: null,
    lastPushedAt: null,
    pendingMutationCount: 0,
    lastError: null,
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

  private async syncOnce(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.setState({ status: "syncing" });

    try {
      await synchronize({
        database: getDatabase(),
        pullChanges: async ({ lastPulledAt }) => {
          const result = await callPull(lastPulledAt ?? null);
          // /sync/pull returns camelCase collection names (matching Convex
          // tables), but WatermelonDB's local schema uses snake_case.
          return {
            changes: mapCamelToSnake(result.changes) as unknown as Record<string, ChangeBucket>,
            timestamp: result.timestamp,
          };
        },
        pushChanges: async ({ changes, lastPulledAt }) => {
          if (
            allEmpty(
              changes as Record<string, { created: WatermelonRow[]; updated: WatermelonRow[] }>,
            )
          ) {
            return;
          }
          const clientMutationId = generateUUID();
          // WatermelonDB pushes snake_case keys; /sync/push expects camelCase.
          const mapped = mapSnakeToCamel(
            changes as Record<string, { created: WatermelonRow[]; updated: WatermelonRow[] }>,
          );
          const response = await callPush(
            {
              lastPulledAt: lastPulledAt ?? 0,
              changes: mapped,
              clientMutationId,
            },
            this.deviceId,
          );
          if ("rejected" in response && response.rejected.length > 0) {
            // biome-ignore lint/suspicious/noConsole: surface rejections to logs for ops
            console.warn("[SyncManager] push rejections:", response.rejected);
          }
        },
        sendCreatedAsUpdated: false,
      });

      this.retryAttempt = 0;
      this.setState({
        status: "idle",
        lastPulledAt: Date.now(),
        lastPushedAt: Date.now(),
        lastError: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // biome-ignore lint/suspicious/noConsole: surface to logs for ops
      console.error("[SyncManager]", msg);
      this.setState({ status: "error", lastError: msg });
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

function allEmpty(
  changes: Record<string, { created: WatermelonRow[]; updated: WatermelonRow[] }>,
): boolean {
  for (const t of Object.values(changes)) {
    if (t.created.length > 0 || t.updated.length > 0) return false;
  }
  return true;
}

/**
 * Translates camelCase collection names from /sync/pull into snake_case
 * keys that WatermelonDB's local schema understands.
 */
function mapCamelToSnake(changes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    out[camelToSnake(key)] = value;
  }
  return out;
}

/**
 * Translates snake_case collection names from WatermelonDB into camelCase
 * keys that /sync/push expects.
 */
function mapSnakeToCamel<T>(changes: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(changes)) {
    out[snakeToCamel(key)] = value;
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
