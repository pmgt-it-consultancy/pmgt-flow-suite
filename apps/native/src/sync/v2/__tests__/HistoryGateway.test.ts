jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import type { KeyValueStorage } from "../checkpoints";
import { HistoryGateway } from "../HistoryGateway";

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

describe("HistoryGateway", () => {
  it("caches bounded summaries and serves them when offline", async () => {
    const now = 2_000_000_000_000;
    const storage = new MemoryStorage();
    const endpoints = {
      searchHistory: jest.fn().mockResolvedValue({
        orders: [
          { _id: "recent", createdAt: now - 24 * 60 * 60 * 1000, status: "paid" },
          { _id: "old", createdAt: now - 10 * 24 * 60 * 60 * 1000, status: "paid" },
        ],
        nextCursor: null,
      }),
      loadHistoricalOrder: jest.fn(),
    };
    const gateway = new HistoryGateway({
      storeId: "store-1",
      storage,
      endpoints,
      now: () => now,
    });

    await gateway.searchHistory({ startDate: 0, endDate: now });
    endpoints.searchHistory.mockRejectedValue(new Error("offline"));
    const cached = await gateway.searchHistory({ startDate: 0, endDate: now });

    expect(cached.orders.map((order) => order._id)).toEqual(["recent"]);
  });

  it("loads details explicitly, keeps them for 24 hours, and prioritizes operational sync", async () => {
    const now = 2_000_000_000_000;
    const storage = new MemoryStorage();
    const awaitOperationalIdle = jest.fn().mockResolvedValue(undefined);
    const endpoints = {
      searchHistory: jest.fn(),
      loadHistoricalOrder: jest.fn().mockResolvedValue({
        aggregateVersion: 3,
        aggregate: { order: { _id: "order-1" }, items: [] },
      }),
    };
    const gateway = new HistoryGateway({
      storeId: "store-1",
      storage,
      endpoints,
      now: () => now,
      awaitOperationalIdle,
    });

    const first = await gateway.loadOrder("order-1");
    endpoints.loadHistoricalOrder.mockRejectedValue(new Error("offline"));
    const cached = await gateway.loadOrder("order-1");

    expect(first).toEqual(cached);
    expect(endpoints.loadHistoricalOrder).toHaveBeenCalledTimes(1);
    expect(awaitOperationalIdle).toHaveBeenCalledTimes(1);
  });
});
