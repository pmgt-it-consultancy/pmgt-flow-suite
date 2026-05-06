import {
  aggregateOrderTotals,
  calculateItemTotals,
  type ItemCalculation,
  type OrderTotals,
} from "@packages/shared";

export interface TotalOrderItem {
  id: string;
  productId: string;
  productPrice: number;
  quantity: number;
}

export interface TotalOrderItemModifier {
  priceAdjustment: number;
}

export interface TotalProduct {
  isVatable: boolean;
}

export interface TotalOrderDiscount {
  orderItemId?: string;
  quantityApplied: number;
}

export interface TotalOrderSummaryItem {
  id: string;
  orderId: string;
  productPrice: number;
  quantity: number;
  isVoided: boolean;
}

export interface TotalLineItem {
  id: string;
  productPrice: number;
  quantity: number;
}

export interface CheckoutTotalItem {
  id: string;
  productPrice: number;
  quantity: number;
  isVatable: boolean;
  modifiers?: TotalOrderItemModifier[];
}

export interface CheckoutTotalDiscount {
  orderItemId?: string;
  quantityApplied: number;
  discountAmount: number;
}

export function calculateLineTotal({
  item,
  modifiersByItemId,
}: {
  item: TotalLineItem;
  modifiersByItemId: Map<string, TotalOrderItemModifier[]>;
}): number {
  const modifierTotal =
    modifiersByItemId.get(item.id)?.reduce((sum, modifier) => sum + modifier.priceAdjustment, 0) ??
    0;
  return (item.productPrice + modifierTotal) * item.quantity;
}

export function buildCheckoutTotals({
  items,
  discounts,
  vatRate,
}: {
  items: CheckoutTotalItem[];
  discounts: CheckoutTotalDiscount[];
  vatRate: number;
}): OrderTotals {
  const itemCalculations = items.map((item) => {
    const modifierTotal =
      item.modifiers?.reduce((sum, modifier) => sum + modifier.priceAdjustment, 0) ?? 0;
    const effectivePrice = item.productPrice + modifierTotal;
    const discountedQuantity = discounts
      .filter((discount) => discount.orderItemId === item.id)
      .reduce((sum, discount) => sum + discount.quantityApplied, 0);

    return calculateItemTotals(
      effectivePrice,
      item.quantity,
      item.isVatable,
      discountedQuantity,
      vatRate,
    );
  });

  const totals = aggregateOrderTotals(itemCalculations);
  const globalDiscountAmount = discounts
    .filter((discount) => !discount.orderItemId)
    .reduce((sum, discount) => sum + discount.discountAmount, 0);

  if (globalDiscountAmount <= 0) return totals;

  return {
    ...totals,
    discountAmount: totals.discountAmount + globalDiscountAmount,
    netSales: Math.max(0, totals.netSales - globalDiscountAmount),
  };
}

export function buildItemCalculations({
  items,
  modifiersByItemId,
  productById,
  discountRecords,
  vatRate,
}: {
  items: TotalOrderItem[];
  modifiersByItemId: Map<string, TotalOrderItemModifier[]>;
  productById: Map<string, TotalProduct>;
  discountRecords: TotalOrderDiscount[];
  vatRate: number;
}): ItemCalculation[] {
  return items.map((item) => {
    const product = productById.get(item.productId);
    const isVatable = product?.isVatable ?? false;
    const modifierTotal =
      modifiersByItemId
        .get(item.id)
        ?.reduce((sum, modifier) => sum + modifier.priceAdjustment, 0) ?? 0;
    const effectivePrice = item.productPrice + modifierTotal;

    const itemDiscounts = discountRecords.filter((discount) => discount.orderItemId === item.id);
    const scPwdQuantity = itemDiscounts.reduce(
      (sum, discount) => sum + discount.quantityApplied,
      0,
    );

    return calculateItemTotals(effectivePrice, item.quantity, isVatable, scPwdQuantity, vatRate);
  });
}

export function buildLineTotalByOrderId({
  items,
  modifiersByItemId,
}: {
  items: TotalOrderSummaryItem[];
  modifiersByItemId: Map<string, TotalOrderItemModifier[]>;
}): Map<string, number> {
  const totals = new Map<string, number>();

  for (const item of items) {
    if (item.isVoided) continue;

    const lineTotal = calculateLineTotal({ item, modifiersByItemId });
    totals.set(item.orderId, (totals.get(item.orderId) ?? 0) + lineTotal);
  }

  return totals;
}
