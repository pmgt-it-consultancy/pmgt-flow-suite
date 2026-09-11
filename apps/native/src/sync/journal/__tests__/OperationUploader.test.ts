jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

import type { KeyValueStorage } from "../../v2/checkpoints";
import { OperationJournal } from "../OperationJournal";
import { OperationUploader } from "../OperationUploader";

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

it("retries a lost acknowledgement with the same operation id", async () => {
  const journal = new OperationJournal({
    storeId: "store-1",
    deviceId: "device-1",
    storage: new MemoryStorage(),
    createOperationId: () => "operation-1",
  });
  const entry = await journal.appendCommand({ kind: "SettleOrder", aggregateId: "order-1" });
  await journal.markProjected(entry.operationId);
  const uploadCommands = jest
    .fn()
    .mockRejectedValueOnce(new Error("ack lost"))
    .mockResolvedValue({ results: [{ operationId: "operation-1", status: "accepted" }] });
  const uploader = new OperationUploader({ journal, uploadCommands, batchSize: 10 });

  await expect(uploader.uploadOnce()).rejects.toThrow("ack lost");
  await uploader.uploadOnce();

  expect(uploadCommands.mock.calls[0][0]).toEqual(uploadCommands.mock.calls[1][0]);
  expect(await journal.get("operation-1")).toMatchObject({ state: "accepted" });
});
