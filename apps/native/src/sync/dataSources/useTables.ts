import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { getDatabase, type Order, type OrderItem, type TableModel } from "../../db";
import { useObservable } from "../../db/useObservable";
import { isFlagEnabled } from "../featureFlags";

export type TableOrderSummary = {
  _id: Id<"orders">;
  orderNumber?: string;
  tabNumber: number;
  tabName: string;
  itemCount: number;
  netSales: number;
  pax?: number;
  createdAt: number;
};

export type TableWithOrders = {
  _id: Id<"tables">;
  name: string;
  capacity?: number;
  status: "available" | "occupied";
  sortOrder: number;
  orders: TableOrderSummary[];
  totalTabs: number;
  totalItemCount: number;
  totalNetSales: number;
};

export type AvailableTable = {
  _id: Id<"tables">;
  name: string;
  capacity?: number;
};

export function useTablesListWithOrders(
  storeId: Id<"stores"> | undefined,
): TableWithOrders[] | undefined {
  const offline = isFlagEnabled("useWatermelon.tables");

  const convexResult = useQuery(
    api.tables.listWithOrders,
    !offline && storeId ? { storeId } : "skip",
  );

  const watermelonTables = useObservable<TableModel>(
    () =>
      getDatabase()
        .collections.get<TableModel>("tables")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("is_active", true)]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonOrders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("status", "open")]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonOrderItems = useObservable<OrderItem>(
    () => getDatabase().collections.get<OrderItem>("order_items").query(),
    [offline],
  );

  const watermelonResult = useMemo(() => {
    if (!offline) return undefined;
    if (!watermelonTables || !watermelonOrders || !watermelonOrderItems) return undefined;

    const activeItems = watermelonOrderItems.filter((i) => !i.isVoided);
    const itemCountByOrderId = new Map<string, number>();
    for (const item of activeItems) {
      const count = itemCountByOrderId.get(item.orderId) ?? 0;
      itemCountByOrderId.set(item.orderId, count + item.quantity);
    }

    const ordersByTableId = new Map<string, Order[]>();
    for (const o of watermelonOrders) {
      if (!o.tableId) continue;
      const list = ordersByTableId.get(o.tableId);
      if (list) list.push(o);
      else ordersByTableId.set(o.tableId, [o]);
    }

    return watermelonTables
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((table) => {
        const tableOrders = ordersByTableId.get(table.id) ?? [];
        tableOrders.sort((a, b) => (a.tabNumber ?? 1) - (b.tabNumber ?? 1));

        const orderSummaries: TableOrderSummary[] = tableOrders.map((o) => ({
          _id: o.id as Id<"orders">,
          orderNumber: o.orderNumber,
          tabNumber: o.tabNumber ?? 1,
          tabName: o.tabName ?? `Tab ${o.tabNumber ?? 1}`,
          itemCount: itemCountByOrderId.get(o.id) ?? 0,
          netSales: o.netSales,
          pax: o.pax,
          createdAt: o.createdAt,
        }));

        const totalTabs = orderSummaries.length;
        const totalItemCount = orderSummaries.reduce((sum, o) => sum + o.itemCount, 0);
        const totalNetSales = orderSummaries.reduce((sum, o) => sum + o.netSales, 0);

        return {
          _id: table.id as Id<"tables">,
          name: table.name,
          capacity: table.capacity,
          status: (tableOrders.length > 0 ? "occupied" : "available") as "available" | "occupied",
          sortOrder: table.sortOrder,
          orders: orderSummaries,
          totalTabs,
          totalItemCount,
          totalNetSales,
        };
      });
  }, [offline, watermelonTables, watermelonOrders, watermelonOrderItems]);

  return offline ? watermelonResult : convexResult;
}

export function useTablesAvailable(
  storeId: Id<"stores"> | undefined,
): AvailableTable[] | undefined {
  const offline = isFlagEnabled("useWatermelon.tables");

  const convexResult = useQuery(
    api.tables.getAvailable,
    !offline && storeId ? { storeId } : "skip",
  );

  const watermelonTables = useObservable<TableModel>(
    () =>
      getDatabase()
        .collections.get<TableModel>("tables")
        .query(
          ...(storeId
            ? [
                Q.where("store_id", storeId),
                Q.where("is_active", true),
                Q.where("status", "available"),
              ]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonResult = useMemo(() => {
    if (!offline) return undefined;
    if (!watermelonTables) return undefined;
    return watermelonTables
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        _id: t.id as Id<"tables">,
        name: t.name,
        capacity: t.capacity,
      }));
  }, [offline, watermelonTables]);

  return offline ? watermelonResult : convexResult;
}
