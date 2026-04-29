import { Q } from "@nozbe/watermelondb";
import { generateUUID } from "../../../../sync/idBridge";
import { syncManager } from "../../../../sync/SyncManager";
import { getDatabase, type Order } from "../../../db";

function uid(): string {
  return generateUUID();
}

// ─── createDraftOrder ─────────────────────────────────────────

export async function createDraftOrder(params: {
  storeId: string;
  draftLabel?: string;
}): Promise<string> {
  const db = getDatabase();
  let orderId = "";

  await db.write(async (writer) => {
    await writer.collections.get<Order>("orders").create((o) => {
      orderId = uid();
      o._raw.id = orderId;
      o.storeId = params.storeId;
      o.orderType = "takeout";
      o.status = "draft";
      o.draftLabel = params.draftLabel || undefined;
      o.createdBy = "";
      o.createdAt = Date.now();
      o.grossSales = 0;
      o.vatableSales = 0;
      o.vatAmount = 0;
      o.vatExemptSales = 0;
      o.nonVatSales = 0;
      o.discountAmount = 0;
      o.netSales = 0;
      o.itemCount = 0;
      o.takeoutStatus = "pending";
    });
  });

  syncManager.triggerPush();
  return orderId;
}

// ─── discardDraft ─────────────────────────────────────────────

export async function discardDraft(params: { orderId: string }): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections.get<Order>("orders").find(params.orderId);
    await order.update((o) => {
      o.status = "voided";
    });
  });

  syncManager.triggerPush();
}

// ─── submitDraft ──────────────────────────────────────────────

export async function submitDraft(params: { orderId: string }): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections.get<Order>("orders").find(params.orderId);
    await order.update((o) => {
      o.status = "open";
      o.takeoutStatus = "pending";
    });
  });

  syncManager.triggerPush();
}

// ─── updateTakeoutStatus ──────────────────────────────────────

export async function updateTakeoutStatus(params: {
  orderId: string;
  status: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async (writer) => {
    const order = await writer.collections.get<Order>("orders").find(params.orderId);
    await order.update((o) => {
      o.takeoutStatus = params.status;
    });
  });

  syncManager.triggerPush();
}
