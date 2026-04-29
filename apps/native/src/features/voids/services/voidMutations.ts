import { Q } from "@nozbe/watermelondb";
import {
  type AuditLog,
  getDatabase,
  type Order,
  type OrderDiscount,
  type OrderItem,
  type OrderItemModifier,
  type OrderPayment,
  type OrderVoid,
  type TableModel,
} from "../../../db";
import { generateUUID } from "../../../sync/idBridge";
import { syncManager } from "../../../sync/SyncManager";
import { getNextOrderNumber } from "../../orders/services/orderNumber";
import { recalculateOrderTotals } from "../../orders/services/recalculateOrder";

function uid(): string {
  return generateUUID();
}

type AuditWriter = (params: {
  storeId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  userId: string;
}) => Promise<void>;

const writeAuditLog: AuditWriter = async ({
  storeId,
  action,
  entityType,
  entityId,
  details,
  userId,
}) => {
  const db = getDatabase();
  await db.get<AuditLog>("audit_logs").create((row) => {
    row._raw.id = uid();
    row.storeId = storeId;
    row.action = action;
    row.entityType = entityType;
    row.entityId = entityId;
    row.details = JSON.stringify(details);
    row.userId = userId;
    row.createdAt = Date.now();
  });
};

// ─── voidOrder ──────────────────────────────────────────────────────
//
// Handles full voids for both `open` and `paid` orders. For paid orders,
// the void is recorded with voidType="refund" and the table (if any) is
// released. Manager PIN is assumed to have been verified upstream by
// ManagerPinModal — this just writes locally and triggers sync.

export async function voidOrder(params: {
  orderId: string;
  reason: string;
  managerId: string;
  refundMethod?: "cash" | "card_ewallet";
}): Promise<{ voidId: string }> {
  const db = getDatabase();
  let voidId = "";

  await db.write(async () => {
    const order = await db.get<Order>("orders").find(params.orderId);
    if (order.status === "voided") throw new Error("Order is already voided");

    const wasPaid = order.status === "paid";

    voidId = uid();
    await db.get<OrderVoid>("order_voids").create((ov) => {
      ov._raw.id = voidId;
      ov.orderId = params.orderId;
      ov.voidType = wasPaid ? "refund" : "full_order";
      ov.reason = params.reason;
      ov.approvedBy = params.managerId;
      ov.requestedBy = params.managerId;
      ov.amount = order.netSales;
      ov.createdAt = Date.now();
      if (wasPaid && params.refundMethod) {
        ov.refundMethod = params.refundMethod;
      }
    });

    await order.update((o) => {
      o.status = "voided";
      if (o.orderType === "takeout") {
        o.takeoutStatus = "cancelled";
      }
    });

    if (order.tableId) {
      const otherOpen = await db
        .get<Order>("orders")
        .query(Q.where("table_id", order.tableId), Q.where("status", "open"))
        .fetch();

      if (otherOpen.length === 0) {
        const table = await db.get<TableModel>("tables").find(order.tableId);
        await table.update((t) => {
          t.status = "available";
          t.currentOrderId = undefined;
        });
      }
    }

    await writeAuditLog({
      storeId: order.storeId,
      action: wasPaid ? "void_paid_order" : "void_order",
      entityType: "order",
      entityId: params.orderId,
      details: {
        orderNumber: order.orderNumber,
        originalAmount: order.netSales,
        reason: params.reason,
        refundMethod: wasPaid ? params.refundMethod : undefined,
      },
      userId: params.managerId,
    });
  });

  syncManager.triggerPush();
  return { voidId };
}

// ─── voidOrderItem ───────────────────────────────────────────────────
//
// Voids a single item from an open order, creates an audit-grade void
// record (in addition to the per-item is_voided flag set by
// removeItemFromOrder). Used by ManagerPinModal-gated flows.

export async function voidOrderItem(params: {
  orderItemId: string;
  reason: string;
  managerId: string;
}): Promise<{ voidId: string }> {
  const db = getDatabase();
  let voidId = "";
  let orderId = "";

  await db.write(async () => {
    const item = await db.get<OrderItem>("order_items").find(params.orderItemId);
    if (item.isVoided) throw new Error("Item is already voided");

    const order = await db.get<Order>("orders").find(item.orderId);
    if (order.status !== "open") {
      throw new Error("Cannot void items in a closed order");
    }

    orderId = item.orderId;
    const voidAmount = item.productPrice * item.quantity;

    await item.update((oi) => {
      oi.isVoided = true;
      oi.voidedBy = params.managerId;
      oi.voidedAt = Date.now();
      oi.voidReason = params.reason;
    });

    voidId = uid();
    await db.get<OrderVoid>("order_voids").create((ov) => {
      ov._raw.id = voidId;
      ov.orderId = item.orderId;
      ov.voidType = "item";
      ov.orderItemId = params.orderItemId;
      ov.reason = params.reason;
      ov.approvedBy = params.managerId;
      ov.requestedBy = params.managerId;
      ov.amount = voidAmount;
      ov.createdAt = Date.now();
    });

    await order.update((o) => {
      o.itemCount = Math.max(0, (o.itemCount ?? 0) - item.quantity);
    });

    await writeAuditLog({
      storeId: order.storeId,
      action: "void_item",
      entityType: "orderItem",
      entityId: params.orderItemId,
      details: {
        orderId: item.orderId,
        orderNumber: order.orderNumber,
        productName: item.productName,
        quantity: item.quantity,
        amount: voidAmount,
        reason: params.reason,
      },
      userId: params.managerId,
    });
  });

  await recalculateOrderTotals(orderId);
  syncManager.triggerPush();
  return { voidId };
}

// ─── voidPaidOrderRefund ─────────────────────────────────────────────
//
// Partial refund of a paid order. Marks selected items as voided, voids
// the original order, and (if items remain) creates a replacement paid
// order so the customer can keep paying for what they're actually taking
// home. Mirrors voidPaidOrderInternal in
// packages/backend/convex/helpers/voidsHelpers.ts.

export async function voidPaidOrderRefund(params: {
  orderId: string;
  refundedItemIds: string[];
  reason: string;
  refundMethod: "cash" | "card_ewallet";
  managerId: string;
}): Promise<{
  voidId: string;
  replacementOrderId?: string;
  refundAmount: number;
}> {
  if (params.refundedItemIds.length === 0) {
    throw new Error("No items selected for refund");
  }

  const db = getDatabase();
  const refundedSet = new Set(params.refundedItemIds);
  const now = Date.now();

  let voidId = "";
  let replacementOrderId: string | undefined;
  let refundAmount = 0;

  // Snapshot for replacement order construction (read outside writer for
  // ordering — order number gen uses writer internally).
  const order = await db.get<Order>("orders").find(params.orderId);
  if (order.status !== "paid") throw new Error("Can only refund paid orders");

  const allItems = await db
    .get<OrderItem>("order_items")
    .query(Q.where("order_id", params.orderId))
    .fetch();
  const activeItems = allItems.filter((i) => !i.isVoided);
  for (const id of params.refundedItemIds) {
    if (!activeItems.find((i) => i.id === id)) {
      throw new Error(`Item ${id} not found or already voided`);
    }
  }

  const remainingItems = activeItems.filter((i) => !refundedSet.has(i.id));

  // Reserve the new order number BEFORE entering the writer (this method
  // opens its own writer internally). Skip if no items remain.
  let newOrderNumber: string | undefined;
  if (remainingItems.length > 0) {
    newOrderNumber = await getNextOrderNumber(
      order.storeId,
      order.orderType as "dine_in" | "takeout",
    );
  }

  // Pre-fetch modifiers and discounts (read-only — outside writer is fine)
  const allMods = await db.get<OrderItemModifier>("order_item_modifiers").query().fetch();
  const modsByItemId = new Map<string, OrderItemModifier[]>();
  for (const m of allMods) {
    const list = modsByItemId.get(m.orderItemId) ?? [];
    list.push(m);
    modsByItemId.set(m.orderItemId, list);
  }

  const originalDiscounts = await db
    .get<OrderDiscount>("order_discounts")
    .query(Q.where("order_id", params.orderId))
    .fetch();

  await db.write(async () => {
    if (remainingItems.length > 0 && newOrderNumber) {
      replacementOrderId = uid();
      const newOrderId = replacementOrderId;
      await db.get<Order>("orders").create((o) => {
        o._raw.id = newOrderId;
        o.storeId = order.storeId;
        o.orderNumber = newOrderNumber;
        o.orderType = order.orderType;
        o.orderChannel = order.orderChannel;
        o.tableId = order.tableId;
        o.tableNameSnapshot = order.tableNameSnapshot;
        o.customerName = order.customerName;
        o.orderCategory = order.orderCategory;
        o.tableMarker = order.tableMarker;
        o.pax = order.pax;
        o.status = "paid";
        o.takeoutStatus = order.takeoutStatus;
        o.grossSales = 0;
        o.vatableSales = 0;
        o.vatAmount = 0;
        o.vatExemptSales = 0;
        o.nonVatSales = 0;
        o.discountAmount = 0;
        o.netSales = 0;
        o.createdBy = params.managerId;
        o.createdAt = now;
        o.paidAt = now;
        o.paidBy = params.managerId;
        o.refundedFromOrderId = params.orderId;
      });

      const oldItemToNewItemId = new Map<string, string>();
      for (const item of remainingItems) {
        const newItemId = uid();
        oldItemToNewItemId.set(item.id, newItemId);
        await db.get<OrderItem>("order_items").create((oi) => {
          oi._raw.id = newItemId;
          oi.orderId = newOrderId;
          oi.productId = item.productId;
          oi.productName = item.productName;
          oi.productPrice = item.productPrice;
          oi.quantity = item.quantity;
          oi.notes = item.notes;
          oi.serviceType = item.serviceType;
          oi.isVoided = false;
          oi.isSentToKitchen = item.isSentToKitchen;
        });

        const itemMods = modsByItemId.get(item.id) ?? [];
        for (const mod of itemMods) {
          await db.get<OrderItemModifier>("order_item_modifiers").create((oim) => {
            oim._raw.id = uid();
            oim.orderItemId = newItemId;
            oim.modifierGroupName = mod.modifierGroupName;
            oim.modifierOptionName = mod.modifierOptionName;
            oim.priceAdjustment = mod.priceAdjustment;
          });
        }
      }

      for (const d of originalDiscounts) {
        if (d.orderItemId) {
          const newItemId = oldItemToNewItemId.get(d.orderItemId);
          if (!newItemId) continue;
          await db.get<OrderDiscount>("order_discounts").create((od) => {
            od._raw.id = uid();
            od.orderId = newOrderId;
            od.orderItemId = newItemId;
            od.discountType = d.discountType;
            od.customerName = d.customerName;
            od.customerId = d.customerId;
            od.quantityApplied = d.quantityApplied;
            od.discountAmount = d.discountAmount;
            od.vatExemptAmount = d.vatExemptAmount;
            od.approvedBy = d.approvedBy;
            od.createdAt = now;
          });
        } else {
          await db.get<OrderDiscount>("order_discounts").create((od) => {
            od._raw.id = uid();
            od.orderId = newOrderId;
            od.discountType = d.discountType;
            od.customerName = d.customerName;
            od.customerId = d.customerId;
            od.quantityApplied = d.quantityApplied;
            od.discountAmount = d.discountAmount;
            od.vatExemptAmount = d.vatExemptAmount;
            od.approvedBy = d.approvedBy;
            od.createdAt = now;
          });
        }
      }
    }

    const originalOrder = await db.get<Order>("orders").find(params.orderId);
    await originalOrder.update((o) => {
      o.status = "voided";
    });

    voidId = uid();
    await db.get<OrderVoid>("order_voids").create((ov) => {
      ov._raw.id = voidId;
      ov.orderId = params.orderId;
      ov.voidType = "refund";
      ov.reason = params.reason;
      ov.approvedBy = params.managerId;
      ov.requestedBy = params.managerId;
      ov.amount = order.netSales;
      ov.createdAt = now;
      ov.refundMethod = params.refundMethod;
      if (replacementOrderId) {
        ov.replacementOrderId = replacementOrderId;
      }
    });
  });

  if (replacementOrderId) {
    await recalculateOrderTotals(replacementOrderId);

    const replacementOrder = await db.get<Order>("orders").find(replacementOrderId);
    refundAmount = order.netSales - replacementOrder.netSales;

    await db.write(async () => {
      await db.get<OrderPayment>("order_payments").create((op) => {
        op._raw.id = uid();
        op.orderId = replacementOrderId!;
        op.storeId = order.storeId;
        op.paymentMethod = "cash";
        op.amount = replacementOrder.netSales;
        op.createdAt = now;
        op.createdBy = params.managerId;
      });

      // Update the void record's amount to the actual refund delta
      const voidRecord = await db.get<OrderVoid>("order_voids").find(voidId);
      await voidRecord.update((ov) => {
        ov.amount = refundAmount;
      });
    });
  } else {
    refundAmount = order.netSales;
  }

  const refundedItemSnapshots = activeItems
    .filter((i) => refundedSet.has(i.id))
    .map((i) => ({ name: i.productName, quantity: i.quantity, price: i.productPrice }));

  await db.write(async () => {
    await writeAuditLog({
      storeId: order.storeId,
      action: "refund_order",
      entityType: "order",
      entityId: params.orderId,
      details: {
        orderNumber: order.orderNumber,
        refundedItems: refundedItemSnapshots,
        refundAmount,
        refundMethod: params.refundMethod,
        replacementOrderId,
        reason: params.reason,
      },
      userId: params.managerId,
    });
  });

  syncManager.triggerPush();
  return { voidId, replacementOrderId, refundAmount };
}
