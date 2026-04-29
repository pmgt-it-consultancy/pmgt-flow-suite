import { generateUUID } from "../../../../sync/idBridge";
import { syncManager } from "../../../../sync/SyncManager";
import { getDatabase, type OrderDiscount } from "../../../db";
import { recalculateOrderTotals } from "../../../orders/services/recalculateOrder";

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

  await db.write(async (writer) => {
    for (const item of params.items) {
      await writer.collections.get<OrderDiscount>("order_discounts").create((d) => {
        d._raw.id = uid();
        d.orderId = params.orderId;
        d.orderItemId = item.orderItemId;
        d.discountType = params.discountType;
        d.customerName = params.customerName;
        d.customerId = params.customerId;
        d.quantityApplied = item.quantityApplied;
        d.discountAmount = 0;
        d.vatExemptAmount = 0;
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

  await db.write(async (writer) => {
    const discount = await writer.collections
      .get<OrderDiscount>("order_discounts")
      .find(params.discountId);
    orderId = discount.orderId;
    await discount.markAsDeleted();
  });

  await recalculateOrderTotals(orderId);
  syncManager.triggerPush();
}
