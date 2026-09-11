import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReplicationStream, StoredCheckpoint } from "./types";

export type CheckpointScope = {
  storeId: string;
  deviceId: string;
  stream: ReplicationStream;
};

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const CHECKPOINT_VERSION = 1;

export class CheckpointStore {
  constructor(private readonly storage: KeyValueStorage = AsyncStorage) {}

  keyFor(scope: CheckpointScope): string {
    return [
      "@pmgt-flow",
      "sync-v2",
      "checkpoint",
      encodeURIComponent(scope.storeId),
      encodeURIComponent(scope.deviceId),
      scope.stream,
    ].join(":");
  }

  async load(
    scope: CheckpointScope,
    expectedGeneration?: string,
  ): Promise<StoredCheckpoint | null> {
    const key = this.keyFor(scope);
    const raw = await this.storage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        parsed.version !== CHECKPOINT_VERSION ||
        typeof parsed.generation !== "string" ||
        (parsed.eventCursor !== null && typeof parsed.eventCursor !== "string")
      ) {
        throw new Error("Invalid checkpoint metadata");
      }
      if (expectedGeneration && parsed.generation !== expectedGeneration) {
        await this.storage.removeItem(key);
        return null;
      }
      return {
        generation: parsed.generation,
        eventCursor: parsed.eventCursor as string | null,
      };
    } catch {
      await this.storage.removeItem(key);
      return null;
    }
  }

  async save(scope: CheckpointScope, checkpoint: StoredCheckpoint): Promise<void> {
    await this.storage.setItem(
      this.keyFor(scope),
      JSON.stringify({ version: CHECKPOINT_VERSION, ...checkpoint }),
    );
  }

  async clear(scope: CheckpointScope): Promise<void> {
    await this.storage.removeItem(this.keyFor(scope));
  }
}
