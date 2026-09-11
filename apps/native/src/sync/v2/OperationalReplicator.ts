import type { AggregateChange } from "./aggregateApply";
import type { CheckpointScope, CheckpointStore } from "./checkpoints";
import type { OperationalDelta, OperationalSnapshot, StoredCheckpoint } from "./types";

type OperationalEndpoints = {
  snapshot(body: { retentionDays?: number }): Promise<OperationalSnapshot>;
  pull(body: { eventCursor?: string; limit?: number }): Promise<OperationalDelta>;
};

type ReplicatorOptions = {
  scope: CheckpointScope;
  checkpoints: CheckpointStore;
  endpoints: OperationalEndpoints;
  apply(change: AggregateChange): Promise<unknown>;
  countV1Membership?: () => Promise<number>;
  countShadowMembership?: () => Promise<number>;
  onShadowMismatch?: (metrics: { v1Count: number; v2Count: number }) => void;
  onOperationObserved?: (operationId: string) => Promise<void>;
  reportCheckpoint?: (checkpoint: StoredCheckpoint) => Promise<void>;
};

export class OperationalReplicator {
  private inFlight: Promise<StoredCheckpoint> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: ReplicatorOptions) {}

  start(): Promise<StoredCheckpoint> {
    if (!this.timer) this.timer = setInterval(() => void this.requestSync(), 60_000);
    return this.requestSync();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  requestSync(): Promise<StoredCheckpoint> {
    if (this.inFlight) return this.inFlight;
    const run = this.runSync();
    this.inFlight = run;
    void run
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null;
      })
      .catch(() => undefined);
    return run;
  }

  async awaitCheckpoint(eventCursor: string): Promise<StoredCheckpoint> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const checkpoint = await this.requestSync();
      if (checkpoint.eventCursor === eventCursor) return checkpoint;
    }
    throw new Error(`Operational checkpoint ${eventCursor} was not observed`);
  }

  private async runSync(): Promise<StoredCheckpoint> {
    let checkpoint = await this.options.checkpoints.load(this.options.scope);
    if (!checkpoint) {
      const snapshot = await this.options.endpoints.snapshot({ retentionDays: 7 });
      for (const aggregate of snapshot.aggregates) {
        const entityId = aggregate.order._id;
        if (typeof entityId !== "string") throw new Error("Snapshot order is missing _id");
        const rawVersion = aggregate.order.replicationVersion;
        const aggregateVersion = typeof rawVersion === "number" ? rawVersion : 1;
        await this.options.apply({
          storeId: this.options.scope.storeId,
          entityId,
          aggregateVersion,
          aggregate,
        });
      }
      checkpoint = {
        generation: snapshot.checkpoint.generation,
        eventCursor: snapshot.checkpoint.eventCursor,
      };
      await this.options.checkpoints.save(this.options.scope, checkpoint);
    } else {
      let hasMore = true;
      while (hasMore) {
        const delta = await this.options.endpoints.pull({
          eventCursor: checkpoint.eventCursor ?? undefined,
          limit: 100,
        });
        if (delta.checkpoint.generation !== checkpoint.generation) {
          await this.options.checkpoints.clear(this.options.scope);
          return this.runSync();
        }
        for (const change of delta.changes) {
          await this.options.apply({
            storeId: this.options.scope.storeId,
            entityId: change.entityId,
            aggregateVersion: change.aggregateVersion,
            aggregate: change.aggregate,
          });
          if (change.operationId) await this.options.onOperationObserved?.(change.operationId);
        }
        checkpoint = {
          generation: delta.checkpoint.generation,
          eventCursor: delta.checkpoint.eventCursor,
        };
        await this.options.checkpoints.save(this.options.scope, checkpoint);
        hasMore = delta.hasMore;
      }
    }

    await this.compareShadowMembership();
    await this.options.reportCheckpoint?.(checkpoint);
    return checkpoint;
  }

  private async compareShadowMembership(): Promise<void> {
    const { countV1Membership, countShadowMembership, onShadowMismatch } = this.options;
    if (!countV1Membership || !countShadowMembership || !onShadowMismatch) return;
    const [v1Count, v2Count] = await Promise.all([countV1Membership(), countShadowMembership()]);
    if (v1Count !== v2Count) onShadowMismatch({ v1Count, v2Count });
  }
}
