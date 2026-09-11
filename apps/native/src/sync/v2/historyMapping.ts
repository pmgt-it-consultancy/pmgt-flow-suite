import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { OrderDetailView, OrderHistoryEntry } from "../dataSources/useOrders";
import type { HistoricalOrder, HistorySummary } from "./HistoryGateway";

export function mapHistorySummary(summary: HistorySummary): OrderHistoryEntry {
  return {
    _id: summary._id as Id<"orders">,
    orderNumber: optionalString(summary.orderNumber),
    orderType: summary.orderType as OrderHistoryEntry["orderType"],
    tableName: optionalString(summary.tableName),
    customerName: optionalString(summary.customerName),
    status: summary.status as OrderHistoryEntry["status"],
    netSales: numberValue(summary.netSales),
    itemCount: numberValue(summary.itemCount),
    createdAt: summary.createdAt,
    paymentMethod: summary.paymentMethod as OrderHistoryEntry["paymentMethod"],
    refundedFromOrderId: optionalString(summary.refundedFromOrderId) as Id<"orders"> | undefined,
  };
}

export function mapHistoricalOrderDetail(history: HistoricalOrder): OrderDetailView {
  const { order, items, modifiers, discounts, voids } = history.aggregate;
  const modifiersByItem = new Map<string, Record<string, unknown>[]>();
  for (const modifier of modifiers) {
    const itemId = String(modifier.orderItemId ?? "");
    const current = modifiersByItem.get(itemId) ?? [];
    current.push(modifier);
    modifiersByItem.set(itemId, current);
  }

  return {
    _id: String(order._id) as Id<"orders">,
    storeId: String(order.storeId) as Id<"stores">,
    orderNumber: optionalString(order.orderNumber),
    orderType: order.orderType as OrderDetailView["orderType"],
    tableId: optionalString(order.tableId) as Id<"tables"> | undefined,
    tableName: optionalString(order.tableName),
    tabNumber: optionalNumber(order.tabNumber),
    tabName: optionalString(order.tabName),
    pax: optionalNumber(order.pax),
    customerName: optionalString(order.customerName),
    draftLabel: optionalString(order.draftLabel),
    status: order.status as OrderDetailView["status"],
    takeoutStatus: order.takeoutStatus as OrderDetailView["takeoutStatus"],
    grossSales: numberValue(order.grossSales),
    vatableSales: numberValue(order.vatableSales),
    vatAmount: numberValue(order.vatAmount),
    vatExemptSales: numberValue(order.vatExemptSales),
    nonVatSales: numberValue(order.nonVatSales),
    discountAmount: numberValue(order.discountAmount),
    netSales: numberValue(order.netSales),
    paymentMethod: order.paymentMethod as OrderDetailView["paymentMethod"],
    cashReceived: optionalNumber(order.cashReceived),
    changeGiven: optionalNumber(order.changeGiven),
    cardPaymentType: optionalString(order.cardPaymentType),
    cardReferenceNumber: optionalString(order.cardReferenceNumber),
    orderCategory: order.orderCategory as OrderDetailView["orderCategory"],
    tableMarker: optionalString(order.tableMarker),
    refundedFromOrderId: optionalString(order.refundedFromOrderId) as Id<"orders"> | undefined,
    createdBy: String(order.createdBy) as Id<"users">,
    createdByName: "Unknown",
    createdAt: numberValue(order.createdAt),
    paidAt: optionalNumber(order.paidAt),
    paidBy: optionalString(order.paidBy) as Id<"users"> | undefined,
    items: items.map((item) => {
      const itemModifiers = modifiersByItem.get(String(item._id)) ?? [];
      const modifierTotal = itemModifiers.reduce(
        (sum, modifier) => sum + numberValue(modifier.priceAdjustment),
        0,
      );
      const isVoided = Boolean(item.isVoided);
      const productPrice = numberValue(item.productPrice);
      const quantity = numberValue(item.quantity);
      return {
        _id: String(item._id) as Id<"orderItems">,
        productId: String(item.productId) as Id<"products">,
        productName: String(item.productName ?? ""),
        productPrice,
        isVatable: item.isVatable !== false,
        quantity,
        notes: optionalString(item.notes),
        isVoided,
        isSentToKitchen:
          typeof item.isSentToKitchen === "boolean" ? item.isSentToKitchen : undefined,
        serviceType: item.serviceType as "dine_in" | "takeout" | undefined,
        lineTotal: isVoided ? 0 : (productPrice + modifierTotal) * quantity,
        modifiers: itemModifiers.map((modifier) => ({
          groupName: String(modifier.modifierGroupName ?? ""),
          optionName: String(modifier.modifierOptionName ?? ""),
          priceAdjustment: numberValue(modifier.priceAdjustment),
        })),
      };
    }),
    discounts: discounts.map((discount) => ({
      discountType: discount.discountType as OrderDetailView["discounts"][number]["discountType"],
      customerName: String(discount.customerName ?? ""),
      customerId: String(discount.customerId ?? ""),
      quantityApplied: numberValue(discount.quantityApplied),
      discountAmount: numberValue(discount.discountAmount),
    })),
    voids: voids.map((orderVoid) => ({
      _id: String(orderVoid._id) as Id<"orderVoids">,
      voidType: orderVoid.voidType as OrderDetailView["voids"][number]["voidType"],
      orderItemId: optionalString(orderVoid.orderItemId) as Id<"orderItems"> | undefined,
      reason: String(orderVoid.reason ?? ""),
      amount: numberValue(orderVoid.amount),
      approvedByName: "Unknown",
      requestedByName: "Unknown",
      createdAt: numberValue(orderVoid.createdAt),
    })),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
