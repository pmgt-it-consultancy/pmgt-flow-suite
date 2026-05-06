import { Q } from "@nozbe/watermelondb";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMemo } from "react";
import { getDatabase, type Order, type OrderItem, type OrderItemModifier } from "../../db";
import { useObservable } from "../../db/useObservable";
import { buildLineTotalByOrderId } from "../../features/orders/services/orderTotals";

const ORDER_SUMMARY_COLUMNS = [
  "order_number",
  "takeout_status",
  "customer_name",
  "status",
  "net_sales",
  "item_count",
  "created_at",
  "table_id",
  "table_name",
  "pax",
];

const ORDER_ITEM_SUMMARY_COLUMNS = ["order_id", "product_price", "quantity", "is_voided"];
const ORDER_ITEM_MODIFIER_SUMMARY_COLUMNS = ["order_item_id", "price_adjustment"];
const NEVER = "__none__";

export type ActiveOrderSummary = {
  _id: Id<"orders">;
  orderNumber?: string;
  orderType: "dine_in" | "takeout";
  tableId?: Id<"tables">;
  tableName?: string;
  pax?: number;
  customerName?: string;
  takeoutStatus?: "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";
  subtotal: number;
  itemCount: number;
  createdAt: number;
};

export type TakeoutOrderSummary = {
  _id: Id<"orders">;
  orderNumber?: string;
  orderType?: "dine_in" | "takeout";
  takeoutStatus: string;
  customerName?: string;
  status: "draft" | "open" | "paid" | "voided";
  netSales: number;
  itemCount: number;
  createdAt: number;
  refundedFromOrderId?: Id<"orders">;
};

export function useActiveOrders(
  storeId: Id<"stores"> | undefined,
): ActiveOrderSummary[] | undefined {
  const watermelonOrders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("status", "open")]
            : [Q.where("store_id", "__none__")]),
        ),
    [storeId],
    ORDER_SUMMARY_COLUMNS,
  );

  const orderIds = useMemo(() => (watermelonOrders ?? []).map((o) => o.id), [watermelonOrders]);

  const watermelonOrderItems = useObservable<OrderItem>(
    () =>
      getDatabase()
        .collections.get<OrderItem>("order_items")
        .query(
          orderIds.length > 0 ? Q.where("order_id", Q.oneOf(orderIds)) : Q.where("order_id", NEVER),
        ),
    [orderIds.join(",")],
    ORDER_ITEM_SUMMARY_COLUMNS,
  );

  return useMemo(() => {
    if (!storeId) return undefined;
    if (!watermelonOrders || !watermelonOrderItems) return undefined;

    const activeItems = watermelonOrderItems.filter((i) => !i.isVoided);
    const itemCountByOrderId = new Map<string, number>();
    for (const item of activeItems) {
      const count = itemCountByOrderId.get(item.orderId) ?? 0;
      itemCountByOrderId.set(item.orderId, count + item.quantity);
    }

    return watermelonOrders
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => ({
        _id: o.id as Id<"orders">,
        orderNumber: o.orderNumber,
        orderType: o.orderType as "dine_in" | "takeout",
        tableId: o.tableId as Id<"tables"> | undefined,
        tableName: o.tableNameSnapshot,
        pax: o.pax,
        customerName: o.customerName,
        takeoutStatus: o.takeoutStatus as ActiveOrderSummary["takeoutStatus"],
        subtotal: o.netSales,
        itemCount: itemCountByOrderId.get(o.id) ?? 0,
        createdAt: o.createdAt,
      }));
  }, [storeId, watermelonOrders, watermelonOrderItems]);
}

export function useTakeoutOrders(
  storeId: Id<"stores"> | undefined,
  startDate?: number,
  endDate?: number,
): TakeoutOrderSummary[] | undefined {
  const watermelonOrders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(
          ...(storeId
            ? [
                Q.where("store_id", storeId),
                Q.where("order_type", "takeout"),
                Q.where("status", Q.oneOf(["open", "paid", "draft"])),
              ]
            : [Q.where("store_id", "__none__")]),
        ),
    [storeId],
    ORDER_SUMMARY_COLUMNS,
  );

  const orderIds = useMemo(() => (watermelonOrders ?? []).map((o) => o.id), [watermelonOrders]);

  const watermelonOrderItems = useObservable<OrderItem>(
    () =>
      getDatabase()
        .collections.get<OrderItem>("order_items")
        .query(
          orderIds.length > 0 ? Q.where("order_id", Q.oneOf(orderIds)) : Q.where("order_id", NEVER),
        ),
    [orderIds.join(",")],
    ORDER_ITEM_SUMMARY_COLUMNS,
  );

  const orderItemIds = useMemo(
    () => (watermelonOrderItems ?? []).map((item) => item.id),
    [watermelonOrderItems],
  );

  const watermelonOrderItemModifiers = useObservable<OrderItemModifier>(
    () =>
      getDatabase()
        .collections.get<OrderItemModifier>("order_item_modifiers")
        .query(
          orderItemIds.length > 0
            ? Q.where("order_item_id", Q.oneOf(orderItemIds))
            : Q.where("order_item_id", NEVER),
        ),
    [orderItemIds.join(",")],
    ORDER_ITEM_MODIFIER_SUMMARY_COLUMNS,
  );

  return useMemo((): TakeoutOrderSummary[] | undefined => {
    if (!storeId) return undefined;
    if (!watermelonOrders || !watermelonOrderItems || !watermelonOrderItemModifiers)
      return undefined;

    const activeItems = watermelonOrderItems.filter((i) => !i.isVoided);
    const itemCountByOrderId = new Map<string, number>();
    for (const item of activeItems) {
      const count = itemCountByOrderId.get(item.orderId) ?? 0;
      itemCountByOrderId.set(item.orderId, count + item.quantity);
    }

    const modifiersByItemId = new Map<string, OrderItemModifier[]>();
    for (const modifier of watermelonOrderItemModifiers) {
      const list = modifiersByItemId.get(modifier.orderItemId);
      if (list) list.push(modifier);
      else modifiersByItemId.set(modifier.orderItemId, [modifier]);
    }

    const lineTotalByOrderId = buildLineTotalByOrderId({
      items: watermelonOrderItems,
      modifiersByItemId,
    });

    let filtered = watermelonOrders;
    if (startDate !== undefined) {
      filtered = filtered.filter((o) => o.createdAt >= startDate);
    }
    if (endDate !== undefined) {
      filtered = filtered.filter((o) => o.createdAt <= endDate);
    }

    return filtered
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => ({
        _id: o.id as Id<"orders">,
        orderNumber: o.orderNumber,
        orderType: o.orderType as "dine_in" | "takeout",
        takeoutStatus: o.takeoutStatus ?? "pending",
        customerName: o.customerName,
        status: o.status as "draft" | "open" | "paid" | "voided",
        netSales:
          o.status === "paid" || o.status === "voided"
            ? o.netSales
            : (lineTotalByOrderId.get(o.id) ?? o.netSales),
        itemCount: itemCountByOrderId.get(o.id) ?? 0,
        createdAt: o.createdAt,
        refundedFromOrderId: undefined,
      }));
  }, [
    storeId,
    watermelonOrders,
    watermelonOrderItems,
    watermelonOrderItemModifiers,
    startDate,
    endDate,
  ]);
}
