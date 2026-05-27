import { Q } from "@nozbe/watermelondb";
import { aggregateOrderTotals, calculateItemTotals, type ItemCalculation } from "@packages/shared";
import {
  getDatabase,
  type Order,
  type OrderDiscount,
  type OrderItem,
  type OrderItemModifier,
  type Product,
  type Store,
} from "../../../db";

/**
 * Recomputes order totals (grossSales, vatableSales, vatAmount, etc.)
 * from the current line items, modifiers, and discounts. Writes the
 * result back to the orders row.
 *
 * Call after any mutation that changes line items or discount records.
 */
export async function recalculateOrderTotals(orderId: string): Promise<void> {
  const db = getDatabase();

  const order = await db.collections.get<Order>("orders").find(orderId);

  const lineItems = await db.collections
    .get<OrderItem>("order_items")
    .query(Q.where("order_id", orderId), Q.where("is_voided", false))
    .fetch();

  const lineItemIds = [...new Set(lineItems.map((item) => item.id))];
  const modifiers =
    lineItemIds.length > 0
      ? await db.collections
          .get<OrderItemModifier>("order_item_modifiers")
          .query(Q.where("order_item_id", Q.oneOf(lineItemIds)))
          .fetch()
      : [];

  const modifiersByItemId = new Map<string, OrderItemModifier[]>();
  for (const m of modifiers) {
    const list = modifiersByItemId.get(m.orderItemId);
    if (list) list.push(m);
    else modifiersByItemId.set(m.orderItemId, [m]);
  }

  const discountRecords = await db.collections
    .get<OrderDiscount>("order_discounts")
    .query(Q.where("order_id", orderId))
    .fetch();

  const productIds = [...new Set(lineItems.map((item) => item.productId))];
  const products =
    productIds.length > 0
      ? await db.collections
          .get<Product>("products")
          .query(Q.where("id", Q.oneOf(productIds)))
          .fetch()
      : [];
  const productById = new Map<string, Product>();
  for (const p of products) productById.set(p.id, p);

  const store = await db.collections.get<Store>("stores").find(order.storeId);
  const vatRate = store?.vatRate ?? 0.12;
  const activeLineItemIds = new Set(lineItemIds);

  // Calculate per-item tax breakdown
  const itemCalcs: ItemCalculation[] = [];
  const discountRecalculations: Array<{
    discount: OrderDiscount;
    discountAmount: number;
    vatExemptAmount: number;
  }> = [];

  for (const item of lineItems) {
    const product = productById.get(item.productId);
    const isVatable = product?.isVatable ?? false;
    const modifierTotal =
      modifiersByItemId.get(item.id)?.reduce((sum, m) => sum + m.priceAdjustment, 0) ?? 0;
    const effectiveUnitPrice = item.productPrice + modifierTotal;

    // Count SC/PWD discounts applied to this item
    const itemDiscounts = discountRecords.filter((d) => d.orderItemId === item.id);
    const scPwdQuantity = itemDiscounts.reduce((sum, d) => sum + d.quantityApplied, 0);

    for (const discount of itemDiscounts) {
      if (discount.discountType !== "senior_citizen" && discount.discountType !== "pwd") continue;

      const discountCalc = calculateItemTotals(
        effectiveUnitPrice,
        discount.quantityApplied,
        isVatable,
        discount.quantityApplied,
        vatRate,
      );
      discountRecalculations.push({
        discount,
        discountAmount: discountCalc.discountAmount,
        vatExemptAmount: discountCalc.vatExemptAmount,
      });
    }

    const calc = calculateItemTotals(
      effectiveUnitPrice,
      item.quantity,
      isVatable,
      scPwdQuantity,
      vatRate,
    );

    itemCalcs.push(calc);
  }

  // Add manual/promo discounts (those without orderItemId) to discount totals
  const globalDiscountAmount = discountRecords
    .filter((d) => !d.orderItemId)
    .reduce((sum, d) => sum + d.discountAmount, 0);

  const totals = aggregateOrderTotals(itemCalcs);
  totals.discountAmount += globalDiscountAmount;
  totals.netSales -= globalDiscountAmount;

  for (const discount of discountRecords) {
    if (discount.orderItemId && !activeLineItemIds.has(discount.orderItemId)) {
      discountRecalculations.push({
        discount,
        discountAmount: 0,
        vatExemptAmount: 0,
      });
    }
  }

  await db.write(async () => {
    for (const { discount, discountAmount, vatExemptAmount } of discountRecalculations) {
      await discount.update((d) => {
        d.discountAmount = discountAmount;
        d.vatExemptAmount = vatExemptAmount;
      });
    }

    const orderToPatch = await db.get<Order>("orders").find(orderId);
    await orderToPatch.update((o) => {
      o.grossSales = totals.grossSales;
      o.vatableSales = totals.vatableSales;
      o.vatAmount = totals.vatAmount;
      o.vatExemptSales = totals.vatExemptSales;
      o.nonVatSales = totals.nonVatSales;
      o.discountAmount = totals.discountAmount;
      o.netSales = totals.netSales;
    });
  });
}
