import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KeyValueStorage } from "./checkpoints";
import type { OperationalSnapshot } from "./types";

export type RepairState =
  | "idle"
  | "checking_journal"
  | "downloading"
  | "validating"
  | "activating"
  | "catching_up"
  | "completed"
  | "failed"
  | "cancelled";

export type RepairStatus = {
  state: RepairState;
  scope: string;
  startedAt: number;
  updatedAt: number;
  error?: string;
};

type ReplicaRepairOptions = {
  scope: string;
  storage?: KeyValueStorage;
  now?: () => number;
  ensureJournalSafe: () => Promise<unknown>;
  download: () => Promise<OperationalSnapshot>;
  activate: (snapshot: OperationalSnapshot) => Promise<unknown>;
  catchUp: () => Promise<unknown>;
  audit: (result: { scope: string; state: "completed" }) => Promise<unknown>;
};

export class ReplicaRepair {
  private readonly storage: KeyValueStorage;
  private cancelled = false;
  private inFlight: Promise<RepairStatus> | null = null;

  constructor(private readonly options: ReplicaRepairOptions) {
    this.storage = options.storage ?? AsyncStorage;
  }

  cancel(): void {
    this.cancelled = true;
  }

  run(): Promise<RepairStatus> {
    if (this.inFlight) return this.inFlight;
    const run = this.execute();
    this.inFlight = run;
    void run
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null;
      })
      .catch(() => undefined);
    return run;
  }

  resume(): Promise<RepairStatus> {
    return this.run();
  }

  async status(): Promise<RepairStatus | null> {
    const raw = await this.storage.getItem(this.key());
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RepairStatus;
    } catch {
      return null;
    }
  }

  private async execute(): Promise<RepairStatus> {
    const startedAt = this.options.now?.() ?? Date.now();
    if (this.cancelled) return this.persist("cancelled", startedAt);
    try {
      await this.persist("checking_journal", startedAt);
      await this.options.ensureJournalSafe();
      if (this.cancelled) return this.persist("cancelled", startedAt);

      await this.persist("downloading", startedAt);
      const snapshot = await this.options.download();
      if (this.cancelled) return this.persist("cancelled", startedAt);

      await this.persist("validating", startedAt);
      validateSnapshot(snapshot);
      if (this.cancelled) return this.persist("cancelled", startedAt);

      await this.persist("activating", startedAt);
      await this.options.activate(snapshot);
      await this.persist("catching_up", startedAt);
      await this.options.catchUp();
      const completed = await this.persist("completed", startedAt);
      await this.options.audit({ scope: this.options.scope, state: "completed" });
      return completed;
    } catch (error) {
      await this.persist(
        "failed",
        startedAt,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async persist(
    state: RepairState,
    startedAt: number,
    error?: string,
  ): Promise<RepairStatus> {
    const status = {
      state,
      scope: this.options.scope,
      startedAt,
      updatedAt: this.options.now?.() ?? Date.now(),
      error,
    };
    await this.storage.setItem(this.key(), JSON.stringify(status));
    return status;
  }

  private key(): string {
    return `@pmgt-flow:sync-v2:repair:${encodeURIComponent(this.options.scope)}`;
  }
}

function validateSnapshot(snapshot: OperationalSnapshot): void {
  if (snapshot.protocolVersion !== 2) throw new Error("Repair snapshot protocol mismatch");
  const roots = new Set<string>();
  for (const aggregate of snapshot.aggregates) {
    const orderId = aggregate.order._id;
    if (typeof orderId !== "string" || !orderId)
      throw new Error("Repair aggregate missing order id");
    if (roots.has(orderId)) throw new Error(`Repair snapshot contains duplicate order ${orderId}`);
    roots.add(orderId);
    const itemIds = new Set(
      aggregate.items.map((item) => {
        if (typeof item._id !== "string") throw new Error("Repair item missing id");
        return item._id;
      }),
    );
    for (const modifier of aggregate.modifiers) {
      if (typeof modifier.orderItemId !== "string" || !itemIds.has(modifier.orderItemId)) {
        throw new Error("Repair modifier references a missing item");
      }
    }
  }
}
