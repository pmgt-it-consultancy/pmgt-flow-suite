import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KeyValueStorage } from "./checkpoints";
import type { AggregateEnvelope } from "./types";

const SUMMARY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DETAIL_RETENTION_MS = 24 * 60 * 60 * 1000;

export type HistorySummary = {
  _id: string;
  createdAt: number;
  status: string;
  [key: string]: unknown;
};

export type HistorySearch = {
  startDate: number;
  endDate: number;
  status?: "paid" | "voided";
  search?: string;
  cursor?: string;
  limit?: number;
};

export type HistoricalOrder = {
  aggregateVersion: number;
  aggregate: AggregateEnvelope;
};

type HistoryEndpoints = {
  searchHistory(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  loadHistoricalOrder(orderId: string): Promise<Record<string, unknown>>;
};

type CachedDetail = { expiresAt: number; value: HistoricalOrder };

export class HistoryGateway {
  private readonly storage: KeyValueStorage;
  private readonly now: () => number;

  constructor(
    private readonly options: {
      storeId: string;
      endpoints: HistoryEndpoints;
      storage?: KeyValueStorage;
      now?: () => number;
      awaitOperationalIdle?: () => Promise<void>;
    },
  ) {
    this.storage = options.storage ?? AsyncStorage;
    this.now = options.now ?? Date.now;
  }

  async searchHistory(query: HistorySearch): Promise<{
    orders: HistorySummary[];
    nextCursor: string | null;
    offline?: boolean;
  }> {
    try {
      await this.options.awaitOperationalIdle?.();
      const response = await this.options.endpoints.searchHistory(query);
      const orders = Array.isArray(response.orders) ? (response.orders as HistorySummary[]) : [];
      await this.mergeSummaryCache(orders);
      return {
        orders,
        nextCursor: typeof response.nextCursor === "string" ? response.nextCursor : null,
      };
    } catch {
      const orders = (await this.readSummaries()).filter((order) => {
        if (order.createdAt < query.startDate || order.createdAt > query.endDate) return false;
        if (query.status && order.status !== query.status) return false;
        const search = query.search?.trim().toLocaleLowerCase();
        if (!search) return true;
        return [order.orderNumber, order.customerName, order.tableName].some(
          (value) => typeof value === "string" && value.toLocaleLowerCase().includes(search),
        );
      });
      return { orders: orders.slice(0, query.limit ?? 50), nextCursor: null, offline: true };
    }
  }

  async loadOrder(orderId: string): Promise<HistoricalOrder> {
    const cached = await this.readDetail(orderId);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    await this.options.awaitOperationalIdle?.();
    const response = (await this.options.endpoints.loadHistoricalOrder(orderId)) as HistoricalOrder;
    if (!response?.aggregate || typeof response.aggregateVersion !== "number") {
      throw new Error("Invalid historical order response");
    }
    await this.storage.setItem(
      this.detailKey(orderId),
      JSON.stringify({ expiresAt: this.now() + DETAIL_RETENTION_MS, value: response }),
    );
    return response;
  }

  async pinOrder(orderId: string): Promise<void> {
    const pins = await this.readPins();
    pins.add(orderId);
    await this.storage.setItem(this.pinsKey(), JSON.stringify([...pins]));
  }

  private summariesKey() {
    return `@pmgt-flow:sync-v2:history:${encodeURIComponent(this.options.storeId)}:summaries`;
  }

  private pinsKey() {
    return `@pmgt-flow:sync-v2:history:${encodeURIComponent(this.options.storeId)}:pins`;
  }

  private detailKey(orderId: string) {
    return `@pmgt-flow:sync-v2:history:${encodeURIComponent(this.options.storeId)}:detail:${encodeURIComponent(orderId)}`;
  }

  private async mergeSummaryCache(incoming: HistorySummary[]): Promise<void> {
    const existing = await this.readSummaries();
    const pins = await this.readPins();
    const byId = new Map(existing.map((summary) => [summary._id, summary]));
    for (const summary of incoming) byId.set(summary._id, summary);
    const cutoff = this.now() - SUMMARY_RETENTION_MS;
    const retained = [...byId.values()]
      .filter((summary) => summary.createdAt >= cutoff || pins.has(summary._id))
      .sort((a, b) => b.createdAt - a.createdAt);
    await this.storage.setItem(this.summariesKey(), JSON.stringify(retained));
  }

  private async readSummaries(): Promise<HistorySummary[]> {
    const value = await this.readJson(this.summariesKey());
    return Array.isArray(value) ? (value as HistorySummary[]) : [];
  }

  private async readPins(): Promise<Set<string>> {
    const value = await this.readJson(this.pinsKey());
    return new Set(Array.isArray(value) ? (value as string[]) : []);
  }

  private async readDetail(orderId: string): Promise<CachedDetail | null> {
    const value = await this.readJson(this.detailKey(orderId));
    if (!value || typeof value !== "object") return null;
    const detail = value as Partial<CachedDetail>;
    return typeof detail.expiresAt === "number" && detail.value ? (detail as CachedDetail) : null;
  }

  private async readJson(key: string): Promise<unknown> {
    const raw = await this.storage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      await this.storage.removeItem(key);
      return null;
    }
  }
}
