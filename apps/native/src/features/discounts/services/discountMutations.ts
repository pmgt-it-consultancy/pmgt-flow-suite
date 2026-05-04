import { Q } from "@nozbe/watermelondb";
import { calculateScPwdDiscount } from "@packages/shared";
import {
  getDatabase,
  type Order,
  type OrderDiscount,
  type OrderItem,
  type OrderItemModifier,
  type Product,
  type Store,
} from "../../../db";
import { generateUUID } from "../../../sync/idBridge";
import { syncManager } from "../../../sync/SyncManager";
import { recalculateOrderTotals } from "../../orders/services/recalculateOrder";

function uid(): string {
  return generateUUID();
}

export async function applyBulkScPwdDiscount(params: {
  orderId: string;
  items: Array<{
    orderItemId: string;
    quantityApplied: number;
  }>;
  discountType: "senior_citizen" | "pwd";
  customerName: string;
  customerId: string;
  managerId: string;
}): Promise<void> {
  const db = getDatabase();

  // Resolve order → store → vatRate (mirrors backend: discounts.ts:166-167).
  // Watermelon's find() throws if the record doesn't exist, so order/store
  // are always defined past this point.
  const order = await db.get<Order>("orders").find(params.orderId);
  const store = await db.get<Store>("stores").find(order.storeId);

  // Non-VAT stores set vatRate = 0; calculateScPwdDiscount handles that
  // case explicitly (20% on the full price, vatExemptAmount = 0).
  // The 0.12 fallback is only for legacy stores where vatRate was never
  // persisted — matches backend behavior in discounts.ts:87,167.
  const storeVatRate = store.vatRate ?? 0.12;

  // Pre-compute discountAmount/vatExemptAmount for every row OUTSIDE the
  // write block. orderDiscounts push is append-only on the server
  // (sync.ts:987), so the row's value at insert time is what the server
  // stores permanently — we cannot patch it later via recalculateOrderTotals.
  const computed = await Promise.all(
    params.items.map(async (item) => {
      const orderItem = await db.get<OrderItem>("order_items").find(item.orderItemId);
      const product = await db.get<Product>("products").find(orderItem.productId);

      // Include modifier price adjustments in effective unit price
      // (mirrors backend: discounts.ts:204-210).
      const modifiers = await db.collections
        .get<OrderItemModifier>("order_item_modifiers")
        .query(Q.where("order_item_id", item.orderItemId))
        .fetch();
      const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
      const effectivePrice = orderItem.productPrice + modifierTotal;

      // Pass 0 when the product isn't vatable OR the store is non-VAT.
      // In both cases SC/PWD still get the 20% discount, but with no VAT
      // exemption portion (there's no VAT being charged to exempt).
      const effectiveVatRate = product.isVatable ? storeVatRate : 0;
      const scPwd = calculateScPwdDiscount(effectivePrice, effectiveVatRate);

      return {
        ...item,
        discountAmount: scPwd.discountAmount * item.quantityApplied,
        vatExemptAmount: scPwd.vatExemptAmount * item.quantityApplied,
      };
    }),
  );

  await db.write(async () => {
    for (const item of computed) {
      await db.get<OrderDiscount>("order_discounts").create((d) => {
        d._raw.id = uid();
        d.orderId = params.orderId;
        d.orderItemId = item.orderItemId;
        d.discountType = params.discountType;
        d.customerName = params.customerName;
        d.customerId = params.customerId;
        d.quantityApplied = item.quantityApplied;
        d.discountAmount = item.discountAmount;
        d.vatExemptAmount = item.vatExemptAmount;
        d.approvedBy = params.managerId;
        d.createdAt = Date.now();
      });
    }
  });

  await recalculateOrderTotals(params.orderId);
  syncManager.triggerPush();
}

export async function removeDiscount(params: {
  discountId: string;
  managerId: string;
}): Promise<void> {
  const db = getDatabase();

  let orderId = "";

  await db.write(async () => {
    const discount = await db.get<OrderDiscount>("order_discounts").find(params.discountId);
    orderId = discount.orderId;
    await discount.markAsDeleted();
  });

  await recalculateOrderTotals(orderId);
  syncManager.triggerPush();
}
