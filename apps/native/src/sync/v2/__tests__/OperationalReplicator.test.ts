jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import { CheckpointStore, type KeyValueStorage } from "../checkpoints";
import { OperationalReplicator } from "../OperationalReplicator";
import type { AggregateEnvelope, OperationalSnapshot } from "../types";

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>();
  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  async removeItem(key: string) {
    this.values.delete(key);
  }
}

const aggregate: AggregateEnvelope = {
  order: { _id: "order-1", replicationVersion: 1 },
  items: [],
  modifiers: [],
  discounts: [],
  voids: [],
  payments: [],
};

const snapshot: OperationalSnapshot = {
  protocolVersion: 2,
  stream: "operational_orders",
  aggregates: [aggregate],
  checkpoint: {
    stream: "operational_orders",
    eventCursor: "cursor-1",
    generation: "generation-1",
  },
};

describe("OperationalReplicator", () => {
  it("advances its checkpoint only after every aggregate commits", async () => {
    const checkpoints = new CheckpointStore(new MemoryStorage());
    const scope = {
      storeId: "store-1",
      deviceId: "device-1",
      stream: "operational_orders" as const,
    };
    const endpoints = {
      snapshot: jest.fn().mockResolvedValue(snapshot),
      pull: jest.fn(),
    };
    const apply = jest.fn().mockRejectedValueOnce(new Error("write failed"));
    const replicator = new OperationalReplicator({ scope, checkpoints, endpoints, apply });

    await expect(replicator.requestSync()).rejects.toThrow("write failed");
    await expect(checkpoints.load(scope)).resolves.toBeNull();

    apply.mockResolvedValue("applied");
    await replicator.requestSync();
    await expect(checkpoints.load(scope)).resolves.toEqual({
      eventCursor: "cursor-1",
      generation: "generation-1",
    });
  });

  it("coalesces concurrent sync requests into one flight", async () => {
    const checkpoints = new CheckpointStore(new MemoryStorage());
    const endpoints = {
      snapshot: jest.fn().mockResolvedValue(snapshot),
      pull: jest.fn(),
    };
    const replicator = new OperationalReplicator({
      scope: {
        storeId: "store-1",
        deviceId: "device-1",
        stream: "operational_orders",
      },
      checkpoints,
      endpoints,
      apply: jest.fn().mockResolvedValue("applied"),
    });

    await Promise.all([replicator.requestSync(), replicator.requestSync()]);
    expect(endpoints.snapshot).toHaveBeenCalledTimes(1);
  });

  it("reports observed operation ids after their aggregate commits", async () => {
    const checkpoints = new CheckpointStore(new MemoryStorage());
    const scope = {
      storeId: "store-1",
      deviceId: "device-1",
      stream: "operational_orders" as const,
    };
    await checkpoints.save(scope, { generation: "generation-1", eventCursor: "cursor-1" });
    const onOperationObserved = jest.fn().mockResolvedValue(undefined);
    const apply = jest.fn().mockResolvedValue("applied");
    const replicator = new OperationalReplicator({
      scope,
      checkpoints,
      endpoints: {
        snapshot: jest.fn(),
        pull: jest.fn().mockResolvedValue({
          protocolVersion: 2,
          stream: "operational_orders",
          changes: [
            {
              entityId: "order-1",
              aggregateVersion: 2,
              eventKind: "upsert",
              operationId: "operation-1",
              aggregate,
            },
          ],
          hasMore: false,
          checkpoint: {
            stream: "operational_orders",
            eventCursor: "cursor-2",
            generation: "generation-1",
          },
        }),
      },
      apply,
      onOperationObserved,
    });

    await replicator.requestSync();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onOperationObserved).toHaveBeenCalledWith("operation-1");
  });
});
