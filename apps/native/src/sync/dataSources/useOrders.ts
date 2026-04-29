import { Q } from "@nozbe/watermelondb";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMemo } from "react";
import {
  getDatabase,
  type Order,
  type OrderDiscount,
  type OrderItem,
  type OrderItemModifier,
  type OrderPayment,
  type OrderVoid,
  type Product,
  type Store,
  type TableModel,
  type User,
} from "../../db";
import { useObservable } from "../../db/useObservable";

export interface OrderItemView {
  _id: Id<"orderItems">;
  productId: Id<"products">;
  productName: string;
  productPrice: number;
  isVatable: boolean;
  quantity: number;
  notes?: string;
  isVoided: boolean;
  isSentToKitchen?: boolean;
  serviceType?: "dine_in" | "takeout";
  lineTotal: number;
  modifiers: Array<{
    groupName: string;
    optionName: string;
    priceAdjustment: number;
  }>;
}

export interface OrderVoidView {
  _id: Id<"orderVoids">;
  voidType: "full_order" | "item" | "refund";
  orderItemId?: Id<"orderItems">;
  reason: string;
  amount: number;
  approvedByName: string;
  requestedByName: string;
  createdAt: number;
}

export interface OrderDiscountSummary {
  discountType: "senior_citizen" | "pwd" | "promo" | "manual";
  customerName: string;
  customerId: string;
  quantityApplied: number;
  discountAmount: number;
}

export interface OrderDetailView {
  _id: Id<"orders">;
  storeId: Id<"stores">;
  orderNumber?: string;
  orderType: "dine_in" | "takeout";
  tableId?: Id<"tables">;
  tableName?: string;
  tabNumber?: number;
  tabName?: string;
  pax?: number;
  customerName?: string;
  draftLabel?: string;
  status: "draft" | "open" | "paid" | "voided";
  takeoutStatus?: "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";
  grossSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  nonVatSales: number;
  discountAmount: number;
  netSales: number;
  paymentMethod?: "cash" | "card_ewallet";
  cashReceived?: number;
  changeGiven?: number;
  cardPaymentType?: string;
  cardReferenceNumber?: string;
  orderCategory?: "dine_in" | "takeout";
  tableMarker?: string;
  refundedFromOrderId?: Id<"orders">;
  createdBy: Id<"users">;
  createdByName: string;
  createdAt: number;
  paidAt?: number;
  paidBy?: Id<"users">;
  items: OrderItemView[];
  discounts: OrderDiscountSummary[];
  voids: OrderVoidView[];
}

export interface OrderHistoryEntry {
  _id: Id<"orders">;
  orderNumber?: string;
  orderType: "dine_in" | "takeout";
  tableName?: string;
  customerName?: string;
  status: "draft" | "open" | "paid" | "voided";
  netSales: number;
  itemCount: number;
  createdAt: number;
  paymentMethod?: "cash" | "card_ewallet";
  refundedFromOrderId?: Id<"orders">;
}

export interface OrderDiscountView {
  _id: Id<"orderDiscounts">;
  orderItemId?: Id<"orderItems">;
  itemName?: string;
  discountType: "senior_citizen" | "pwd" | "promo" | "manual";
  customerName: string;
  customerId: string;
  quantityApplied: number;
  discountAmount: number;
  vatExemptAmount: number;
  approvedByName: string;
  createdAt: number;
}

export interface OrderReceiptView {
  storeName: string;
  storeAddress1: string;
  storeAddress2?: string;
  tin: string;
  min: string;
  vatRate: number;
  orderNumber: string;
  orderType: "dine_in" | "takeout";
  tableName?: string;
  pax?: number;
  customerName?: string;
  orderCategory?: "dine_in" | "takeout";
  tableMarker?: string;
  createdAt: number;
  paidAt?: number;
  cashierName: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  grossSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  nonVatSales: number;
  discountAmount: number;
  netSales: number;
  paymentMethod?: "cash" | "card_ewallet";
  cashReceived?: number;
  changeGiven?: number;
  cardPaymentType?: string;
  cardReferenceNumber?: string;
  payments: Array<{
    paymentMethod: "cash" | "card_ewallet";
    amount: number;
    cashReceived?: number;
    changeGiven?: number;
    cardPaymentType?: string;
    cardReferenceNumber?: string;
  }>;
}

const NEVER = "__none__";

const ORDER_DETAIL_COLUMNS = [
  "order_number",
  "order_type",
  "takeout_status",
  "table_id",
  "table_name",
  "customer_name",
  "draft_label",
  "status",
  "gross_sales",
  "vatable_sales",
  "vat_amount",
  "vat_exempt_sales",
  "non_vat_sales",
  "discount_amount",
  "net_sales",
  "payment_method",
  "cash_received",
  "change_given",
  "card_payment_type",
  "card_reference_number",
  "order_category",
  "table_marker",
  "created_by",
  "created_at",
  "paid_at",
  "paid_by",
  "pax",
  "tab_number",
  "tab_name",
  "refunded_from_order_id",
];

const ORDER_ITEM_DETAIL_COLUMNS = [
  "order_id",
  "product_id",
  "product_name",
  "product_price",
  "quantity",
  "notes",
  "service_type",
  "is_voided",
  "is_sent_to_kitchen",
];

const ORDER_ITEM_MODIFIER_COLUMNS = [
  "order_item_id",
  "modifier_group_name",
  "modifier_option_name",
  "price_adjustment",
];

const ORDER_DISCOUNT_COLUMNS = [
  "order_id",
  "order_item_id",
  "discount_type",
  "customer_name",
  "customer_id",
  "quantity_applied",
  "discount_amount",
  "vat_exempt_amount",
  "approved_by",
  "created_at",
];

const ORDER_VOID_COLUMNS = [
  "order_id",
  "void_type",
  "order_item_id",
  "reason",
  "approved_by",
  "requested_by",
  "amount",
  "created_at",
];

const ORDER_PAYMENT_COLUMNS = [
  "order_id",
  "payment_method",
  "amount",
  "cash_received",
  "change_given",
  "card_payment_type",
  "card_reference_number",
];

const TABLE_SUMMARY_COLUMNS = ["name", "status"];
const PRODUCT_SUMMARY_COLUMNS = ["is_vatable"];
const USER_SUMMARY_COLUMNS = ["name"];

const ORDER_HISTORY_COLUMNS = [
  "order_number",
  "order_type",
  "table_id",
  "table_name",
  "customer_name",
  "status",
  "net_sales",
  "payment_method",
  "created_at",
  "refunded_from_order_id",
];

const ORDER_ITEM_COUNT_COLUMNS = ["order_id", "quantity", "is_voided"];

const DRAFT_ORDER_COLUMNS = [
  "order_number",
  "draft_label",
  "customer_name",
  "status",
  "net_sales",
  "created_at",
];

const RECEIPT_ORDER_COLUMNS = [
  "order_number",
  "order_type",
  "table_id",
  "table_name",
  "customer_name",
  "pax",
  "order_category",
  "table_marker",
  "status",
  "gross_sales",
  "vatable_sales",
  "vat_amount",
  "vat_exempt_sales",
  "non_vat_sales",
  "discount_amount",
  "net_sales",
  "payment_method",
  "cash_received",
  "change_given",
  "card_payment_type",
  "card_reference_number",
  "created_by",
  "created_at",
  "paid_at",
];

const STORE_RECEIPT_COLUMNS = ["name", "address1", "address2", "tin", "min", "vat_rate"];

// ─── useOrderDetail ───────────────────────────────────────────────
// Mirrors the shape of api.orders.get for a drop-in swap.

export function useOrderDetail(
  orderId: Id<"orders"> | string | undefined,
): OrderDetailView | null | undefined {
  const orders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(orderId ? Q.where("id", String(orderId)) : Q.where("id", NEVER)),
    [orderId],
    ORDER_DETAIL_COLUMNS,
  );

  const items = useObservable<OrderItem>(
    () =>
      getDatabase()
        .collections.get<OrderItem>("order_items")
        .query(orderId ? Q.where("order_id", String(orderId)) : Q.where("order_id", NEVER)),
    [orderId],
    ORDER_ITEM_DETAIL_COLUMNS,
  );

  const itemIds = useMemo(() => (items ?? []).map((i) => i.id), [items]);

  const modifiers = useObservable<OrderItemModifier>(
    () =>
      getDatabase()
        .collections.get<OrderItemModifier>("order_item_modifiers")
        .query(
          itemIds.length > 0
            ? Q.where("order_item_id", Q.oneOf(itemIds))
            : Q.where("order_item_id", NEVER),
        ),
    [itemIds.join(",")],
    ORDER_ITEM_MODIFIER_COLUMNS,
  );

  const discounts = useObservable<OrderDiscount>(
    () =>
      getDatabase()
        .collections.get<OrderDiscount>("order_discounts")
        .query(orderId ? Q.where("order_id", String(orderId)) : Q.where("order_id", NEVER)),
    [orderId],
    ORDER_DISCOUNT_COLUMNS,
  );

  const voids = useObservable<OrderVoid>(
    () =>
      getDatabase()
        .collections.get<OrderVoid>("order_voids")
        .query(orderId ? Q.where("order_id", String(orderId)) : Q.where("order_id", NEVER)),
    [orderId],
    ORDER_VOID_COLUMNS,
  );

  const tables = useObservable<TableModel>(
    () => getDatabase().collections.get<TableModel>("tables").query(),
    [],
    TABLE_SUMMARY_COLUMNS,
  );

  const products = useObservable<Product>(
    () => getDatabase().collections.get<Product>("products").query(),
    [],
    PRODUCT_SUMMARY_COLUMNS,
  );

  const users = useObservable<User>(
    () => getDatabase().collections.get<User>("users").query(),
    [],
    USER_SUMMARY_COLUMNS,
  );

  return useMemo<OrderDetailView | null | undefined>(() => {
    if (!orderId) return undefined;
    if (!orders || !items || !modifiers || !discounts || !voids) return undefined;

    const order = orders.find((o) => o.id === String(orderId));
    if (!order) return null;

    const tableName = order.tableId
      ? (tables?.find((t) => t.id === order.tableId)?.name ?? order.tableNameSnapshot)
      : undefined;

    const productById = new Map((products ?? []).map((p) => [p.id, p]));
    const userById = new Map((users ?? []).map((u) => [u.id, u]));

    const itemViews: OrderItemView[] = items.map((item) => {
      const itemMods = modifiers.filter((m) => m.orderItemId === item.id);
      const modifierTotal = itemMods.reduce((s, m) => s + m.priceAdjustment, 0);
      const product = productById.get(item.productId);
      return {
        _id: item.id as Id<"orderItems">,
        productId: item.productId as Id<"products">,
        productName: item.productName,
        productPrice: item.productPrice,
        isVatable: product?.isVatable ?? true,
        quantity: item.quantity,
        notes: item.notes,
        isVoided: item.isVoided,
        isSentToKitchen: item.isSentToKitchen,
        serviceType: item.serviceType as "dine_in" | "takeout" | undefined,
        lineTotal: item.isVoided ? 0 : (item.productPrice + modifierTotal) * item.quantity,
        modifiers: itemMods.map((m) => ({
          groupName: m.modifierGroupName,
          optionName: m.modifierOptionName,
          priceAdjustment: m.priceAdjustment,
        })),
      };
    });

    const creator = userById.get(order.createdBy);
    const createdByName = creator?.name ?? "Unknown";

    const voidViews: OrderVoidView[] = voids
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((v) => {
        const approver = userById.get(v.approvedBy);
        const requester = userById.get(v.requestedBy);
        return {
          _id: v.id as Id<"orderVoids">,
          voidType: v.voidType as OrderVoidView["voidType"],
          orderItemId: v.orderItemId as Id<"orderItems"> | undefined,
          reason: v.reason,
          amount: v.amount,
          approvedByName: approver?.name ?? "Unknown",
          requestedByName: requester?.name ?? "Unknown",
          createdAt: v.createdAt,
        };
      });

    return {
      _id: order.id as Id<"orders">,
      storeId: order.storeId as Id<"stores">,
      orderNumber: order.orderNumber,
      orderType: order.orderType as "dine_in" | "takeout",
      tableId: order.tableId as Id<"tables"> | undefined,
      tableName,
      tabNumber: order.tabNumber,
      tabName: order.tabName,
      pax: order.pax,
      customerName: order.customerName,
      draftLabel: order.draftLabel,
      status: order.status as OrderDetailView["status"],
      takeoutStatus: order.takeoutStatus as OrderDetailView["takeoutStatus"],
      grossSales: order.grossSales,
      vatableSales: order.vatableSales,
      vatAmount: order.vatAmount,
      vatExemptSales: order.vatExemptSales,
      nonVatSales: order.nonVatSales,
      discountAmount: order.discountAmount,
      netSales: order.netSales,
      paymentMethod: order.paymentMethod as "cash" | "card_ewallet" | undefined,
      cashReceived: order.cashReceived,
      changeGiven: order.changeGiven,
      cardPaymentType: order.cardPaymentType,
      cardReferenceNumber: order.cardReferenceNumber,
      orderCategory: order.orderCategory as "dine_in" | "takeout" | undefined,
      tableMarker: order.tableMarker,
      refundedFromOrderId: order.refundedFromOrderId as Id<"orders"> | undefined,
      createdBy: order.createdBy as Id<"users">,
      createdByName,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      paidBy: order.paidBy as Id<"users"> | undefined,
      items: itemViews,
      discounts: discounts.map((d) => ({
        discountType: d.discountType as OrderDiscountSummary["discountType"],
        customerName: d.customerName,
        customerId: d.customerId,
        quantityApplied: d.quantityApplied,
        discountAmount: d.discountAmount,
      })),
      voids: voidViews,
    };
  }, [orderId, orders, items, modifiers, discounts, voids, tables, products, users]);
}

// ─── useOrderHistoryQuery ──────────────────────────────────────────
// Mirrors api.orders.getOrderHistory.

export function useOrderHistoryQuery(params: {
  storeId: Id<"stores"> | undefined;
  startDate: number;
  endDate: number;
  search?: string;
  status?: "paid" | "voided";
  limit?: number;
}): OrderHistoryEntry[] | undefined {
  const { storeId, startDate, endDate, search, status, limit } = params;

  const orders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(
          ...(storeId
            ? [
                Q.where("store_id", String(storeId)),
                Q.where("created_at", Q.gte(startDate)),
                Q.where("created_at", Q.lte(endDate)),
              ]
            : [Q.where("store_id", NEVER)]),
        ),
    [storeId, startDate, endDate],
    ORDER_HISTORY_COLUMNS,
  );

  const orderItems = useObservable<OrderItem>(
    () => getDatabase().collections.get<OrderItem>("order_items").query(),
    [],
    ORDER_ITEM_COUNT_COLUMNS,
  );

  const tables = useObservable<TableModel>(
    () => getDatabase().collections.get<TableModel>("tables").query(),
    [],
    TABLE_SUMMARY_COLUMNS,
  );

  return useMemo<OrderHistoryEntry[] | undefined>(() => {
    if (!storeId) return undefined;
    if (!orders || !orderItems) return undefined;

    const tableNameById = new Map((tables ?? []).map((t) => [t.id, t.name]));

    const itemCountByOrderId = new Map<string, number>();
    for (const item of orderItems) {
      if (item.isVoided) continue;
      itemCountByOrderId.set(
        item.orderId,
        (itemCountByOrderId.get(item.orderId) ?? 0) + item.quantity,
      );
    }

    let filtered = orders.filter((o) => o.status !== "draft");
    if (status) filtered = filtered.filter((o) => o.status === status);
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (o) =>
          (o.orderNumber?.toLowerCase().includes(s) ?? false) ||
          (o.customerName?.toLowerCase().includes(s) ?? false),
      );
    }

    return filtered
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit ?? 50)
      .map((o) => ({
        _id: o.id as Id<"orders">,
        orderNumber: o.orderNumber,
        orderType: o.orderType as "dine_in" | "takeout",
        tableName: o.tableId
          ? (tableNameById.get(o.tableId) ?? o.tableNameSnapshot)
          : o.tableNameSnapshot,
        customerName: o.customerName,
        status: o.status as OrderHistoryEntry["status"],
        netSales: o.netSales,
        itemCount: itemCountByOrderId.get(o.id) ?? 0,
        createdAt: o.createdAt,
        paymentMethod: o.paymentMethod as "cash" | "card_ewallet" | undefined,
        refundedFromOrderId: o.refundedFromOrderId as Id<"orders"> | undefined,
      }));
  }, [storeId, search, status, limit, orders, orderItems, tables]);
}

// ─── useOrderDiscountsQuery ─────────────────────────────────────────
// Mirrors api.discounts.getOrderDiscounts.

export function useOrderDiscountsQuery(
  orderId: Id<"orders"> | string | undefined,
): OrderDiscountView[] | undefined {
  const discounts = useObservable<OrderDiscount>(
    () =>
      getDatabase()
        .collections.get<OrderDiscount>("order_discounts")
        .query(orderId ? Q.where("order_id", String(orderId)) : Q.where("order_id", NEVER)),
    [orderId],
    ORDER_DISCOUNT_COLUMNS,
  );

  const items = useObservable<OrderItem>(
    () => getDatabase().collections.get<OrderItem>("order_items").query(),
    [],
    ["product_name"],
  );

  const users = useObservable<User>(
    () => getDatabase().collections.get<User>("users").query(),
    [],
    USER_SUMMARY_COLUMNS,
  );

  return useMemo<OrderDiscountView[] | undefined>(() => {
    if (!orderId) return undefined;
    if (!discounts) return undefined;
    const itemNameById = new Map((items ?? []).map((i) => [i.id, i.productName]));
    const userById = new Map((users ?? []).map((u) => [u.id, u.name ?? "Unknown"]));
    return discounts.map((d) => ({
      _id: d.id as Id<"orderDiscounts">,
      orderItemId: d.orderItemId as Id<"orderItems"> | undefined,
      itemName: d.orderItemId ? itemNameById.get(d.orderItemId) : undefined,
      discountType: d.discountType as OrderDiscountView["discountType"],
      customerName: d.customerName,
      customerId: d.customerId,
      quantityApplied: d.quantityApplied,
      discountAmount: d.discountAmount,
      vatExemptAmount: d.vatExemptAmount,
      approvedByName: userById.get(d.approvedBy) ?? "Unknown",
      createdAt: d.createdAt,
    }));
  }, [orderId, discounts, items, users]);
}

// ─── useDraftOrders ─────────────────────────────────────────────────
// Mirrors api.orders.getDraftOrders.

export interface DraftOrderEntry {
  _id: Id<"orders">;
  orderNumber?: string;
  draftLabel?: string;
  customerName?: string;
  itemCount: number;
  subtotal: number;
  createdAt: number;
}

export function useDraftOrders(storeId: Id<"stores"> | undefined): DraftOrderEntry[] | undefined {
  const orders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(
          ...(storeId
            ? [Q.where("store_id", String(storeId)), Q.where("status", "draft")]
            : [Q.where("store_id", NEVER)]),
        ),
    [storeId],
    DRAFT_ORDER_COLUMNS,
  );

  const items = useObservable<OrderItem>(
    () => getDatabase().collections.get<OrderItem>("order_items").query(),
    [],
    ORDER_ITEM_COUNT_COLUMNS,
  );

  return useMemo<DraftOrderEntry[] | undefined>(() => {
    if (!storeId) return undefined;
    if (!orders || !items) return undefined;

    const itemCountByOrderId = new Map<string, number>();
    for (const it of items) {
      if (it.isVoided) continue;
      itemCountByOrderId.set(it.orderId, (itemCountByOrderId.get(it.orderId) ?? 0) + it.quantity);
    }

    return orders
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => ({
        _id: o.id as Id<"orders">,
        orderNumber: o.orderNumber,
        draftLabel: o.draftLabel,
        customerName: o.customerName,
        itemCount: itemCountByOrderId.get(o.id) ?? 0,
        subtotal: o.netSales,
        createdAt: o.createdAt,
      }));
  }, [storeId, orders, items]);
}

// ─── useOrderReceipt ────────────────────────────────────────────────
// Mirrors api.checkout.getReceipt.

export function useOrderReceipt(
  orderId: Id<"orders"> | string | undefined,
): OrderReceiptView | null | undefined {
  const orders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(orderId ? Q.where("id", String(orderId)) : Q.where("id", NEVER)),
    [orderId],
    RECEIPT_ORDER_COLUMNS,
  );

  const items = useObservable<OrderItem>(
    () =>
      getDatabase()
        .collections.get<OrderItem>("order_items")
        .query(orderId ? Q.where("order_id", String(orderId)) : Q.where("order_id", NEVER)),
    [orderId],
    ORDER_ITEM_DETAIL_COLUMNS,
  );

  const payments = useObservable<OrderPayment>(
    () =>
      getDatabase()
        .collections.get<OrderPayment>("order_payments")
        .query(orderId ? Q.where("order_id", String(orderId)) : Q.where("order_id", NEVER)),
    [orderId],
    ORDER_PAYMENT_COLUMNS,
  );

  const stores = useObservable<Store>(
    () => getDatabase().collections.get<Store>("stores").query(),
    [],
    STORE_RECEIPT_COLUMNS,
  );

  const tables = useObservable<TableModel>(
    () => getDatabase().collections.get<TableModel>("tables").query(),
    [],
    TABLE_SUMMARY_COLUMNS,
  );

  const users = useObservable<User>(
    () => getDatabase().collections.get<User>("users").query(),
    [],
    USER_SUMMARY_COLUMNS,
  );

  return useMemo<OrderReceiptView | null | undefined>(() => {
    if (!orderId) return undefined;
    if (!orders || !items || !payments) return undefined;
    const order = orders.find((o) => o.id === String(orderId));
    if (!order) return null;
    const store = stores?.find((s) => s.id === order.storeId);
    if (!store) return undefined;
    const cashier = users?.find((u) => u.id === order.createdBy);
    const tableName = order.tableId
      ? (tables?.find((t) => t.id === order.tableId)?.name ?? order.tableNameSnapshot)
      : order.tableNameSnapshot;

    const paymentArray =
      payments.length > 0
        ? payments.map((p) => ({
            paymentMethod: p.paymentMethod as "cash" | "card_ewallet",
            amount: p.amount,
            cashReceived: p.cashReceived,
            changeGiven: p.changeGiven,
            cardPaymentType: p.cardPaymentType,
            cardReferenceNumber: p.cardReferenceNumber,
          }))
        : order.paymentMethod
          ? [
              {
                paymentMethod: order.paymentMethod as "cash" | "card_ewallet",
                amount: order.netSales,
                cashReceived: order.cashReceived,
                changeGiven: order.changeGiven,
                cardPaymentType: order.cardPaymentType,
                cardReferenceNumber: order.cardReferenceNumber,
              },
            ]
          : [];

    return {
      storeName: store.name,
      storeAddress1: store.address1,
      storeAddress2: store.address2 || undefined,
      tin: store.tin,
      min: store.min,
      vatRate: store.vatRate,
      orderNumber: order.orderNumber ?? "",
      orderType: order.orderType as "dine_in" | "takeout",
      tableName,
      pax: order.pax,
      customerName: order.customerName,
      orderCategory: order.orderCategory as "dine_in" | "takeout" | undefined,
      tableMarker: order.tableMarker,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      cashierName: cashier?.name ?? "Unknown",
      items: items
        .filter((i) => !i.isVoided)
        .map((i) => ({
          name: i.productName,
          quantity: i.quantity,
          unitPrice: i.productPrice,
          lineTotal: i.productPrice * i.quantity,
        })),
      grossSales: order.grossSales,
      vatableSales: order.vatableSales,
      vatAmount: order.vatAmount,
      vatExemptSales: order.vatExemptSales,
      nonVatSales: order.nonVatSales,
      discountAmount: order.discountAmount,
      netSales: order.netSales,
      paymentMethod: order.paymentMethod as "cash" | "card_ewallet" | undefined,
      cashReceived: order.cashReceived,
      changeGiven: order.changeGiven,
      cardPaymentType: order.cardPaymentType,
      cardReferenceNumber: order.cardReferenceNumber,
      payments: paymentArray,
    };
  }, [orderId, orders, items, payments, stores, tables, users]);
}
