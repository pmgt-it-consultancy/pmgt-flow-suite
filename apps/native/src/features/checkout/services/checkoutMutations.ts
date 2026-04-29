import { Q } from "@nozbe/watermelondb";
import { generateUUID } from "../../../../sync/idBridge";
import { syncManager } from "../../../../sync/SyncManager";
import {
  getDatabase,
  type Order,
  type OrderPayment,
  type OrderVoid,
  type TableModel,
} from "../../../db";

function uid(): string {
  return generateUUID();
}

// ─── processPayment ───────────────────────────────────────────

export async function processPayment(params: {
  orderId: string;
  payments: Array<{
    paymentMethod: "cash" | "card_ewallet";
    amount: number;
    cashReceived?: number;
    changeGiven?: number;
    cardPaymentType?: string;
    cardReferenceNumber?: string;
  }>;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections.get<Order>("orders").find(params.orderId);

    for (const p of params.payments) {
      await writer.collections.get<OrderPayment>("order_payments").create((op) => {
        op._raw.id = uid();
        op.orderId = params.orderId;
        op.storeId = order.storeId;
        op.paymentMethod = p.paymentMethod;
        op.amount = p.amount;
        op.cashReceived = p.cashReceived || undefined;
        op.changeGiven = p.changeGiven || undefined;
        op.cardPaymentType = p.cardPaymentType || undefined;
        op.cardReferenceNumber = p.cardReferenceNumber || undefined;
        op.createdAt = Date.now();
        op.createdBy = "";
      });
    }

    const primaryPayment = params.payments[0];
    await order.update((o) => {
      o.status = "paid";
      o.paymentMethod = primaryPayment.paymentMethod;
      o.cashReceived = primaryPayment.cashReceived || undefined;
      o.changeGiven = primaryPayment.changeGiven || undefined;
      o.cardPaymentType = primaryPayment.cardPaymentType || undefined;
      o.cardReferenceNumber = primaryPayment.cardReferenceNumber || undefined;
      o.paidAt = Date.now();
      o.paidBy = "";
    });

    if (order.tableId) {
      const otherOpen = await writer.collections
        .get<Order>("orders")
        .query(Q.where("table_id", order.tableId), Q.where("status", "open"))
        .fetch();

      if (otherOpen.length === 0) {
        const table = await writer.collections.get<TableModel>("tables").find(order.tableId);
        await table.update((t) => {
          t.status = "available";
        });
      }
    }
  });

  syncManager.triggerPush();
}

// ─── cancelOrder ──────────────────────────────────────────────

export async function cancelOrder(params: { orderId: string }): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections.get<Order>("orders").find(params.orderId);

    await order.update((o) => {
      o.status = "voided";
    });

    await writer.collections.get<OrderVoid>("order_voids").create((ov) => {
      ov._raw.id = uid();
      ov.orderId = params.orderId;
      ov.voidType = "order";
      ov.reason = "Order cancelled by cashier";
      ov.approvedBy = "";
      ov.requestedBy = "";
      ov.amount = order.netSales;
      ov.createdAt = Date.now();
    });

    if (order.tableId) {
      const otherOpen = await writer.collections
        .get<Order>("orders")
        .query(Q.where("table_id", order.tableId), Q.where("status", "open"))
        .fetch();

      if (otherOpen.length === 0) {
        const table = await writer.collections.get<TableModel>("tables").find(order.tableId);
        await table.update((t) => {
          t.status = "available";
        });
      }
    }
  });

  syncManager.triggerPush();
}
