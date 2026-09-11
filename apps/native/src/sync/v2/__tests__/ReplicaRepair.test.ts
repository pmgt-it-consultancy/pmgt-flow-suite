jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

import type { KeyValueStorage } from "../checkpoints";
import { ReplicaRepair } from "../ReplicaRepair";

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

const snapshot = {
  protocolVersion: 2 as const,
  stream: "operational_orders" as const,
  aggregates: [
    {
      order: { _id: "order-1", replicationVersion: 2 },
      items: [],
      modifiers: [],
      discounts: [],
      voids: [],
      payments: [],
    },
  ],
  checkpoint: {
    stream: "operational_orders" as const,
    generation: "generation-2",
    eventCursor: "cursor-2",
  },
};

it("validates before atomic activation and catches up before completing", async () => {
  const calls: string[] = [];
  const repair = new ReplicaRepair({
    scope: "operational_orders",
    storage: new MemoryStorage(),
    ensureJournalSafe: async () => calls.push("journal"),
    download: async () => {
      calls.push("download");
      return snapshot;
    },
    activate: async () => calls.push("activate"),
    catchUp: async () => calls.push("catchup"),
    audit: async () => calls.push("audit"),
  });

  await expect(repair.run()).resolves.toMatchObject({ state: "completed" });
  expect(calls).toEqual(["journal", "download", "activate", "catchup", "audit"]);
});

it("never activates an invalid or cancelled repair", async () => {
  const activate = jest.fn();
  const invalid = new ReplicaRepair({
    scope: "operational_orders",
    storage: new MemoryStorage(),
    ensureJournalSafe: async () => undefined,
    download: async () => ({ ...snapshot, aggregates: [{ ...snapshot.aggregates[0], order: {} }] }),
    activate,
    catchUp: async () => undefined,
    audit: async () => undefined,
  });
  await expect(invalid.run()).rejects.toThrow("missing order id");
  expect(activate).not.toHaveBeenCalled();

  const cancelled = new ReplicaRepair({
    scope: "operational_orders",
    storage: new MemoryStorage(),
    ensureJournalSafe: async () => undefined,
    download: async () => snapshot,
    activate,
    catchUp: async () => undefined,
    audit: async () => undefined,
  });
  cancelled.cancel();
  await expect(cancelled.run()).resolves.toMatchObject({ state: "cancelled" });
  expect(activate).not.toHaveBeenCalled();
});
