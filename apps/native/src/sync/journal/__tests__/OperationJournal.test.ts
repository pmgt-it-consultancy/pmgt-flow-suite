jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

import type { KeyValueStorage } from "../../v2/checkpoints";
import { OperationJournal } from "../OperationJournal";

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

describe("OperationJournal", () => {
  it("retains a stable operation across append, projection, retry, acceptance, and observation", async () => {
    const storage = new MemoryStorage();
    const journal = new OperationJournal({ storeId: "store-1", deviceId: "device-1", storage });
    const operation = await journal.appendCommand({
      kind: "SetOrderItemQuantity",
      aggregateId: "order-1",
      itemId: "item-1",
      quantity: 2,
    });
    await journal.markProjected(operation.operationId);
    const firstBatch = await journal.nextUploadBatch(10);
    await journal.markSending(firstBatch.map((entry) => entry.operationId));
    const retryBatch = await journal.nextUploadBatch(10);

    expect(retryBatch[0].operationId).toBe(operation.operationId);
    expect(retryBatch[0].command).toEqual(firstBatch[0].command);

    await journal.markAccepted(operation.operationId);
    await journal.markObserved(operation.operationId);
    await expect(journal.pendingCount()).resolves.toBe(0);
  });

  it("compacts only unsent quantity changes and preserves financial commands", async () => {
    const journal = new OperationJournal({
      storeId: "store-1",
      deviceId: "device-1",
      storage: new MemoryStorage(),
    });
    await journal.appendCommand({
      kind: "SetOrderItemQuantity",
      aggregateId: "order-1",
      itemId: "item-1",
      quantity: 2,
    });
    const compactedQuantity = await journal.appendCommand({
      kind: "SetOrderItemQuantity",
      aggregateId: "order-1",
      itemId: "item-1",
      quantity: 4,
    });
    const firstPayment = await journal.appendCommand({
      kind: "SettleOrder",
      aggregateId: "order-1",
      payments: [{ paymentMethod: "cash", amount: 100 }],
    });
    const secondPayment = await journal.appendCommand({
      kind: "SettleOrder",
      aggregateId: "order-1",
      payments: [{ paymentMethod: "cash", amount: 100 }],
    });
    await journal.markProjected(compactedQuantity.operationId);
    await journal.markProjected(firstPayment.operationId);
    await journal.markProjected(secondPayment.operationId);

    const batch = await journal.nextUploadBatch(10);
    expect(batch.map((entry) => entry.command.kind)).toEqual([
      "SetOrderItemQuantity",
      "SettleOrder",
      "SettleOrder",
    ]);
    expect(batch[0].command).toMatchObject({ quantity: 4 });
  });

  it("keeps rejected operations for explicit attention", async () => {
    const journal = new OperationJournal({
      storeId: "store-1",
      deviceId: "device-1",
      storage: new MemoryStorage(),
    });
    const operation = await journal.appendCommand({ kind: "VoidOrder", aggregateId: "order-1" });
    await journal.requireAttention(operation.operationId, "Order is already closed");

    expect(await journal.pendingCount()).toBe(1);
    expect(await journal.get(operation.operationId)).toMatchObject({
      state: "attention_required",
      error: "Order is already closed",
    });
  });
});
