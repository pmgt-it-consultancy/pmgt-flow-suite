import { useAuthToken } from "@convex-dev/auth/react";
import { Q } from "@nozbe/watermelondb";
import { useEffect, useRef } from "react";
import { getOrCreateDeviceId } from "../auth/deviceId";
import { getDatabase } from "../db";
import { useAuth } from "../features/auth";
import { syncManager } from "./SyncManager";
import { setAuthTokenFn } from "./syncEndpoints";
import { applyAggregateEnvelope } from "./v2/aggregateApply";
import { CheckpointStore } from "./v2/checkpoints";
import { syncV2Endpoints } from "./v2/endpoints";
import { OperationalReplicator } from "./v2/OperationalReplicator";
import { isSyncV2Enabled } from "./v2/types";

let lastShadowMismatch: { v1Count: number; v2Count: number } | null = null;

export function getLastSyncV2ShadowMismatch() {
  return lastShadowMismatch ? { ...lastShadowMismatch } : null;
}

/**
 * Wires the SyncManager into the live auth state. Mount once, inside the
 * ConvexAuthProvider + AuthProvider tree. Has no DOM output — pure
 * side-effect.
 *
 * Behavior:
 *   - When the user signs in (token becomes non-null), starts the sync
 *     loop. The token getter reads from a ref so it always returns the
 *     current value, even after refresh-rotation.
 *   - When the user signs out (token becomes null), stops the sync loop.
 *
 * Auth providers wrapping this component:
 *   ConvexClientProvider → ConvexAuthProvider → AuthProvider → here
 */
export function SyncBootstrap() {
  const token = useAuthToken();
  const { isAuthenticated, user } = useAuth();

  // Keep latest token in a ref so the sync manager always sees current
  // value across refresh-token rotations without re-registering callbacks.
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;

  // Set the token getter once — it reads from the ref each call.
  useEffect(() => {
    setAuthTokenFn(async () => tokenRef.current);
  }, []);

  // Start/stop the sync loop based on auth state.
  useEffect(() => {
    if (isAuthenticated && token) {
      let v2Replicator: OperationalReplicator | null = null;
      let cancelled = false;
      if (user?.storeId) {
        console.log("Starting sync with storeId:", user.storeId);
        void syncManager.start(user.storeId as string);
        if (isSyncV2Enabled) {
          void getOrCreateDeviceId().then((deviceId) => {
            if (cancelled) return;
            const database = getDatabase();
            v2Replicator = new OperationalReplicator({
              scope: {
                storeId: user.storeId as string,
                deviceId,
                stream: "operational_orders",
              },
              checkpoints: new CheckpointStore(),
              endpoints: syncV2Endpoints,
              apply: (change) => applyAggregateEnvelope(database, change),
              countV1Membership: () =>
                database
                  .get("orders")
                  .query(
                    Q.where("store_id", user.storeId as string),
                    Q.or(
                      Q.where("status", Q.oneOf(["draft", "open"])),
                      Q.where("created_at", Q.gte(Date.now() - 7 * 24 * 60 * 60 * 1000)),
                    ),
                  )
                  .fetchCount(),
              countShadowMembership: () =>
                database
                  .get("sync_v2_aggregates")
                  .query(Q.where("store_id", user.storeId as string))
                  .fetchCount(),
              onShadowMismatch: (metrics) => {
                lastShadowMismatch = metrics;
              },
              reportCheckpoint: async (checkpoint) => {
                await syncV2Endpoints.reportDeviceState(deviceId, {
                  generation: checkpoint.generation,
                  checkpoint: checkpoint.eventCursor ?? undefined,
                  pendingCount: 0,
                  clientNow: Date.now(),
                });
              },
            });
            void v2Replicator.start().catch(() => undefined);
          });
        }
      }
      return () => {
        cancelled = true;
        v2Replicator?.stop();
        syncManager.stop();
      };
    }
  }, [isAuthenticated, token, user?.storeId]);

  return null;
}
