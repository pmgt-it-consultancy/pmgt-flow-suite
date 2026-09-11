import { type AuditLog, getDatabase } from "../../db";
import { generateUUID } from "../idBridge";
import { OperationJournal } from "../journal/OperationJournal";
import { syncManager } from "../SyncManager";
import { applyAggregateEnvelope, replaceOperationalReplica } from "./aggregateApply";
import { CheckpointStore } from "./checkpoints";
import { syncV2Endpoints } from "./endpoints";
import { OperationalReplicator } from "./OperationalReplicator";
import { ReplicaRepair } from "./ReplicaRepair";

export function createOperationalRepair(storeId: string, deviceId: string): ReplicaRepair {
  const database = getDatabase();
  const checkpoints = new CheckpointStore();
  const scope = { storeId, deviceId, stream: "operational_orders" as const };
  const journal = new OperationJournal({ storeId, deviceId });

  return new ReplicaRepair({
    scope: `operational_orders:${storeId}:${deviceId}`,
    ensureJournalSafe: async () => {
      if ((await journal.pendingCount()) > 0) {
        throw new Error("Pending or attention-required sales must be resolved before repair");
      }
      const outcome = await syncManager.syncForDelivery();
      if (outcome.kind !== "delivered") throw new Error("Current POS changes are not sync-clean");
    },
    download: () => syncV2Endpoints.snapshot({ retentionDays: 7 }),
    activate: async (snapshot) => {
      await replaceOperationalReplica(database, storeId, snapshot.aggregates);
      await checkpoints.save(scope, {
        generation: snapshot.checkpoint.generation,
        eventCursor: snapshot.checkpoint.eventCursor,
      });
    },
    catchUp: async () => {
      const replicator = new OperationalReplicator({
        scope,
        checkpoints,
        endpoints: syncV2Endpoints,
        apply: (change) => applyAggregateEnvelope(database, change),
      });
      await replicator.requestSync();
    },
    audit: async ({ scope: repairedScope, state }) => {
      await database.write(async () => {
        await database.get<AuditLog>("audit_logs").create((audit) => {
          audit._raw.id = generateUUID();
          audit.storeId = storeId;
          audit.action = "sync_replica_repair";
          audit.entityType = "syncReplica";
          audit.entityId = repairedScope;
          audit.details = JSON.stringify({ scope: repairedScope, state });
          audit.userId = "";
          audit.createdAt = Date.now();
          audit.updatedAt = Date.now();
        });
      });
      syncManager.triggerPush();
    },
  });
}
