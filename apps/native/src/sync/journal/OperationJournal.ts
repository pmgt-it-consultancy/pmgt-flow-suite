import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateUUID } from "../idBridge";
import type { KeyValueStorage } from "../v2/checkpoints";
import type { BusinessCommand, JournalEntry, JournalState } from "./types";

export class OperationJournal {
  private readonly storage: KeyValueStorage;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      storeId: string;
      deviceId: string;
      storage?: KeyValueStorage;
      now?: () => number;
      createOperationId?: () => string;
    },
  ) {
    this.storage = options.storage ?? AsyncStorage;
  }

  async appendCommand(command: BusinessCommand): Promise<JournalEntry> {
    return this.exclusive(async () => {
      const entries = await this.read();
      if (command.kind === "SetOrderItemQuantity") {
        const priorIndex = entries.findIndex(
          (entry) =>
            (entry.state === "pending" || entry.state === "projected") &&
            entry.command.kind === command.kind &&
            entry.command.aggregateId === command.aggregateId &&
            entry.command.itemId === command.itemId,
        );
        if (priorIndex >= 0) entries.splice(priorIndex, 1);
      }
      const now = this.options.now?.() ?? Date.now();
      const entry: JournalEntry = {
        operationId: this.options.createOperationId?.() ?? generateUUID(),
        schemaVersion: 1,
        storeId: this.options.storeId,
        deviceId: this.options.deviceId,
        command: structuredClone(command),
        state: "pending",
        createdAt: now,
        updatedAt: now,
      };
      entries.push(entry);
      await this.write(entries);
      return structuredClone(entry);
    });
  }

  markProjected(operationId: string): Promise<void> {
    return this.transition(operationId, "projected");
  }

  markSending(operationIds: string[]): Promise<void> {
    return this.exclusive(async () => {
      const ids = new Set(operationIds);
      const entries = await this.read();
      const now = this.options.now?.() ?? Date.now();
      for (const entry of entries) {
        if (ids.has(entry.operationId) && entry.state === "projected") {
          entry.state = "sending";
          entry.updatedAt = now;
        }
      }
      await this.write(entries);
    });
  }

  markAccepted(operationId: string): Promise<void> {
    return this.transition(operationId, "accepted");
  }

  markObserved(operationId: string): Promise<void> {
    return this.transition(operationId, "observed");
  }

  requireAttention(operationId: string, error: string): Promise<void> {
    return this.transition(operationId, "attention_required", error);
  }

  async nextUploadBatch(limit: number): Promise<JournalEntry[]> {
    await this.queue;
    const entries = await this.read();
    return entries
      .filter((entry) => entry.state === "projected" || entry.state === "sending")
      .slice(0, Math.max(1, limit))
      .map((entry) => structuredClone(entry));
  }

  async pendingCount(): Promise<number> {
    await this.queue;
    return (await this.read()).filter((entry) => entry.state !== "observed").length;
  }

  async get(operationId: string): Promise<JournalEntry | null> {
    await this.queue;
    const entry = (await this.read()).find((candidate) => candidate.operationId === operationId);
    return entry ? structuredClone(entry) : null;
  }

  private transition(operationId: string, state: JournalState, error?: string): Promise<void> {
    return this.exclusive(async () => {
      const entries = await this.read();
      const entry = entries.find((candidate) => candidate.operationId === operationId);
      if (!entry) throw new Error(`Unknown operation ${operationId}`);
      entry.state = state;
      entry.error = error;
      entry.updatedAt = this.options.now?.() ?? Date.now();
      await this.write(entries);
    });
  }

  private key(): string {
    return `@pmgt-flow:operation-journal:v1:${encodeURIComponent(this.options.storeId)}:${encodeURIComponent(this.options.deviceId)}`;
  }

  private async read(): Promise<JournalEntry[]> {
    const raw = await this.storage.getItem(this.key());
    if (!raw) return [];
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? (value as JournalEntry[]) : [];
    } catch {
      throw new Error("Operation journal is corrupted; refusing to discard pending business work");
    }
  }

  private write(entries: JournalEntry[]): Promise<void> {
    return this.storage.setItem(this.key(), JSON.stringify(entries));
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
