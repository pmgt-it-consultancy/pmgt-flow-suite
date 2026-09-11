import { useEffect, useState } from "react";
import { syncManager } from "../SyncManager";
import { syncV2Endpoints } from "../v2/endpoints";
import { HistoryGateway, type HistorySearch, type HistorySummary } from "../v2/HistoryGateway";

const historyGateways = new Map<string, HistoryGateway>();

export function getHistoryGateway(storeId: string): HistoryGateway {
  let gateway = historyGateways.get(storeId);
  if (!gateway) {
    gateway = new HistoryGateway({
      storeId,
      endpoints: syncV2Endpoints,
      awaitOperationalIdle: async () => {
        await syncManager.syncForDelivery();
      },
    });
    historyGateways.set(storeId, gateway);
  }
  return gateway;
}

export function useV2OrderHistory(
  storeId: string | undefined,
  query: HistorySearch,
  enabled: boolean,
): { orders: HistorySummary[] | undefined; refresh: () => Promise<void> } {
  const [orders, setOrders] = useState<HistorySummary[]>();
  const { startDate, endDate, status, search, cursor, limit } = query;

  const currentQuery = (): HistorySearch => ({ startDate, endDate, status, search, cursor, limit });
  const refresh = async () => {
    if (!enabled || !storeId) return;
    const result = await getHistoryGateway(storeId).searchHistory(currentQuery());
    setOrders(result.orders);
  };

  useEffect(() => {
    if (!enabled || !storeId) {
      setOrders(undefined);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void getHistoryGateway(storeId)
        .searchHistory({ startDate, endDate, status, search, cursor, limit })
        .then((result) => {
          if (!cancelled) setOrders(result.orders);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, storeId, startDate, endDate, status, search, cursor, limit]);

  return { orders, refresh };
}
