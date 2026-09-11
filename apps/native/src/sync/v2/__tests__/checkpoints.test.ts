jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import { CheckpointStore, type KeyValueStorage } from "../checkpoints";

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

describe("v2 CheckpointStore", () => {
  it("isolates checkpoints by store, device, and stream", async () => {
    const storage = new MemoryStorage();
    const checkpoints = new CheckpointStore(storage);
    await checkpoints.save(
      { storeId: "store-a", deviceId: "device-a", stream: "catalog" },
      { generation: "g1", eventCursor: "cursor-a" },
    );

    await expect(
      checkpoints.load({ storeId: "store-a", deviceId: "device-a", stream: "catalog" }),
    ).resolves.toEqual({ generation: "g1", eventCursor: "cursor-a" });
    await expect(
      checkpoints.load({ storeId: "store-a", deviceId: "device-b", stream: "catalog" }),
    ).resolves.toBeNull();
    await expect(
      checkpoints.load({ storeId: "store-b", deviceId: "device-a", stream: "catalog" }),
    ).resolves.toBeNull();
  });

  it("rejects an old generation and recovers corrupted metadata", async () => {
    const storage = new MemoryStorage();
    const checkpoints = new CheckpointStore(storage);
    const scope = {
      storeId: "store-a",
      deviceId: "device-a",
      stream: "operational_orders" as const,
    };
    await checkpoints.save(scope, { generation: "old", eventCursor: "cursor-old" });
    await expect(checkpoints.load(scope, "new")).resolves.toBeNull();

    storage.values.set(checkpoints.keyFor(scope), "not-json");
    await expect(checkpoints.load(scope)).resolves.toBeNull();
    expect(storage.values.has(checkpoints.keyFor(scope))).toBe(false);
  });
});
