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

  const allModifiers = await db.collections
    .get<OrderItemModifier>("order_item_modifiers")
    .query()
    .fetch();

  const modifiersByItemId = new Map<string, OrderItemModifier[]>();
  for (const m of allModifiers) {
    const list = modifiersByItemId.get(m.orderItemId);
    if (list) list.push(m);
    else modifiersByItemId.set(m.orderItemId, [m]);
  }

  const discountRecords = await db.collections
    .get<OrderDiscount>("order_discounts")
    .query(Q.where("order_id", orderId))
    .fetch();

  const allProducts = await db.collections.get<Product>("products").query().fetch();
  const productById = new Map<string, Product>();
  for (const p of allProducts) productById.set(p.id, p);

  const store = await db.collections.get<Store>("stores").find(order.storeId);
  const vatRate = store?.vatRate ?? 0.12;

  // Calculate per-item tax breakdown
  const itemCalcs: ItemCalculation[] = [];
  for (const item of lineItems) {
    const product = productById.get(item.productId);
    const isVatable = product?.isVatable ?? false;

    // Count SC/PWD discounts applied to this item
    const itemDiscounts = discountRecords.filter((d) => d.orderItemId === item.id);
    const scPwdQuantity = itemDiscounts.reduce((sum, d) => sum + d.quantityApplied, 0);

    const calc = calculateItemTotals(
      item.productPrice,
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

  await db.write(async (writer) => {
    const orderToPatch = await writer.collections.get<Order>("orders").find(orderId);
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
