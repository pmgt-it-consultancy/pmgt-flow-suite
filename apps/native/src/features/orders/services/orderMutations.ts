import { Q } from "@nozbe/watermelondb";
import {
  getDatabase,
  type Order,
  type OrderItem,
  type OrderItemModifier,
  type Product,
  type TableModel,
} from "../../../db";
import { generateUUID } from "../../../sync/idBridge";
import { syncManager } from "../../../sync/SyncManager";
import { getNextOrderNumber } from "./orderNumber";
import { recalculateOrderTotals } from "./recalculateOrder";

function uid(): string {
  return generateUUID();
}

// ─── createOrder ──────────────────────────────────────────────
// Returns: the new order's UUID id

export async function createOrder(params: {
  storeId: string;
  orderType: "dine_in" | "takeout";
  tableId?: string;
  customerName?: string;
  pax?: number;
  requestId?: string;
}): Promise<string> {
  const db = getDatabase();

  if (params.requestId) {
    const existing = await db.collections
      .get<Order>("orders")
      .query(Q.where("request_id", params.requestId))
      .fetch();
    if (existing.length > 0) return existing[0].id;
  }

  const orderNumber = await getNextOrderNumber(params.storeId, params.orderType);

  let orderId = "";

  await db.write(async () => {
    const order = await db.get<Order>("orders").create((o) => {
      o._raw.id = uid();
      orderId = o._raw.id;
      o.storeId = params.storeId;
      o.orderNumber = orderNumber;
      o.orderType = params.orderType;
      o.tableId = params.tableId || undefined;
      o.customerName = params.customerName || undefined;
      o.pax = params.pax ?? 1;
      o.status = "open";
      o.createdBy = "";
      o.createdAt = Date.now();
      o.requestId = params.requestId || undefined;
      o.grossSales = 0;
      o.vatableSales = 0;
      o.vatAmount = 0;
      o.vatExemptSales = 0;
      o.nonVatSales = 0;
      o.discountAmount = 0;
      o.netSales = 0;
      o.itemCount = 0;
    });

    if (params.tableId) {
      const table = await db.get<TableModel>("tables").find(params.tableId);
      await table.update((t) => {
        t.status = "occupied";
      });
    }
  });

  syncManager.triggerPush();
  return orderId;
}

// ─── addItemToOrder ───────────────────────────────────────────

export async function addItemToOrder(params: {
  orderId: string;
  productId: string;
  quantity: number;
  notes?: string;
  modifiers?: Array<{
    modifierGroupName: string;
    modifierOptionName: string;
    priceAdjustment: number;
  }>;
  customPrice?: number;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async () => {
    const product = await db.get<Product>("products").find(params.productId);

    const basePrice = params.customPrice ?? product.price;

    const orderItem = await db.get<OrderItem>("order_items").create((oi) => {
      oi._raw.id = uid();
      oi.orderId = params.orderId;
      oi.productId = params.productId;
      oi.productName = product.name;
      oi.productPrice = basePrice;
      oi.quantity = params.quantity;
      oi.notes = params.notes || undefined;
      oi.isVoided = false;
      oi.serviceType = undefined;
      oi.isSentToKitchen = false;
    });

    if (params.modifiers) {
      for (const mod of params.modifiers) {
        await db.get<OrderItemModifier>("order_item_modifiers").create((oim) => {
          oim._raw.id = uid();
          oim.orderItemId = orderItem.id;
          oim.modifierGroupName = mod.modifierGroupName;
          oim.modifierOptionName = mod.modifierOptionName;
          oim.priceAdjustment = mod.priceAdjustment;
        });
      }
    }

    const order = await db.get<Order>("orders").find(params.orderId);
    await order.update((o) => {
      o.itemCount = (o.itemCount ?? 0) + params.quantity;
    });
  });

  await recalculateOrderTotals(params.orderId);
  syncManager.triggerPush();
}

// ─── removeItemFromOrder ──────────────────────────────────────

export async function removeItemFromOrder(params: {
  orderItemId: string;
  voidReason?: string;
}): Promise<void> {
  const db = getDatabase();
  let orderId = "";

  await db.write(async () => {
    const item = await db.get<OrderItem>("order_items").find(params.orderItemId);

    orderId = item.orderId;

    await item.update((oi) => {
      oi.isVoided = true;
      oi.voidReason = params.voidReason || undefined;
      oi.voidedAt = Date.now();
    });

    const order = await db.get<Order>("orders").find(orderId);
    await order.update((o) => {
      o.itemCount = Math.max(0, (o.itemCount ?? 0) - item.quantity);
    });
  });

  await recalculateOrderTotals(orderId);
  syncManager.triggerPush();
}

// ─── updateItemQuantity ───────────────────────────────────────

export async function updateItemQuantity(params: {
  orderItemId: string;
  quantity: number;
}): Promise<void> {
  const db = getDatabase();
  let orderId = "";

  await db.write(async () => {
    const item = await db.get<OrderItem>("order_items").find(params.orderItemId);

    const oldQty = item.quantity;
    orderId = item.orderId;

    await item.update((oi) => {
      oi.quantity = params.quantity;
    });

    const order = await db.get<Order>("orders").find(orderId);
    await order.update((o) => {
      o.itemCount = (o.itemCount ?? 0) - oldQty + params.quantity;
    });
  });

  await recalculateOrderTotals(orderId);
  syncManager.triggerPush();
}

// ─── updateItemServiceType ────────────────────────────────────

export async function updateItemServiceType(params: {
  orderItemId: string;
  serviceType: "dine_in" | "takeout";
}): Promise<void> {
  const db = getDatabase();

  await db.write(async () => {
    const item = await db.get<OrderItem>("order_items").find(params.orderItemId);
    await item.update((oi) => {
      oi.serviceType = params.serviceType;
    });
  });

  syncManager.triggerPush();
}

// ─── updateOrderPax ───────────────────────────────────────────

export async function updateOrderPax(params: { orderId: string; pax: number }): Promise<void> {
  const db = getDatabase();

  await db.write(async () => {
    const order = await db.get<Order>("orders").find(params.orderId);
    await order.update((o) => {
      o.pax = params.pax;
    });
  });

  syncManager.triggerPush();
}

// ─── updateTabName ────────────────────────────────────────────

export async function updateTabName(params: { orderId: string; tabName: string }): Promise<void> {
  const db = getDatabase();

  await db.write(async () => {
    const order = await db.get<Order>("orders").find(params.orderId);
    await order.update((o) => {
      o.tabName = params.tabName;
    });
  });

  syncManager.triggerPush();
}

// ─── updateCustomerName ───────────────────────────────────────

export async function updateCustomerName(params: {
  orderId: string;
  customerName?: string;
  orderCategory?: "dine_in" | "takeout";
  tableMarker?: string;
}): Promise<void> {
  const db = getDatabase();

  await db.write(async () => {
    const order = await db.get<Order>("orders").find(params.orderId);
    await order.update((o) => {
      if (params.customerName !== undefined) o.customerName = params.customerName || undefined;
      if (params.orderCategory !== undefined) o.orderCategory = params.orderCategory;
      if (params.tableMarker !== undefined) o.tableMarker = params.tableMarker || undefined;
    });
  });

  syncManager.triggerPush();
}

// ─── sendToKitchen ────────────────────────────────────────────

export async function sendToKitchen(params: { orderId: string }): Promise<void> {
  const db = getDatabase();

  await db.write(async () => {
    const items = await db
      .get<OrderItem>("order_items")
      .query(
        Q.where("order_id", params.orderId),
        Q.where("is_voided", false),
        Q.where("is_sent_to_kitchen", false),
      )
      .fetch();

    for (const item of items) {
      await item.update((oi) => {
        oi.isSentToKitchen = true;
      });
    }
  });

  syncManager.triggerPush();
}

// ─── createAndSendToKitchen ───────────────────────────────────

type DraftItem = {
  productId: string;
  quantity: number;
  notes?: string;
  modifiers?: Array<{
    modifierGroupName: string;
    modifierOptionName: string;
    priceAdjustment: number;
  }>;
  customPrice?: number;
};

export async function createAndSendToKitchen(params: {
  storeId: string;
  tableId: string;
  pax: number;
  items: DraftItem[];
  tabNumber?: number;
  tabName?: string;
}): Promise<{
  orderId: string;
  orderNumber: string;
  sentItemIds: string[];
}> {
  const db = getDatabase();
  const orderId = uid();
  const orderNumber = await getNextOrderNumber(params.storeId, "dine_in");
  const sentItemIds: string[] = [];

  await db.write(async () => {
    await db.get<Order>("orders").create((o) => {
      o._raw.id = orderId;
      o.storeId = params.storeId;
      o.orderNumber = orderNumber;
      o.orderType = "dine_in";
      o.tableId = params.tableId;
      o.pax = params.pax;
      o.tabNumber = params.tabNumber;
      o.tabName = params.tabName;
      o.status = "open";
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
    });

    for (const d of params.items) {
      const product = await db.get<Product>("products").find(d.productId);

      const basePrice = d.customPrice ?? product.price;
      const oiId = uid();
      sentItemIds.push(oiId);

      await db.get<OrderItem>("order_items").create((oi) => {
        oi._raw.id = oiId;
        oi.orderId = orderId;
        oi.productId = d.productId;
        oi.productName = product.name;
        oi.productPrice = basePrice;
        oi.quantity = d.quantity;
        oi.notes = d.notes || undefined;
        oi.isVoided = false;
        oi.isSentToKitchen = true;
      });

      if (d.modifiers) {
        for (const mod of d.modifiers) {
          await db.get<OrderItemModifier>("order_item_modifiers").create((oim) => {
            oim._raw.id = uid();
            oim.orderItemId = oiId;
            oim.modifierGroupName = mod.modifierGroupName;
            oim.modifierOptionName = mod.modifierOptionName;
            oim.priceAdjustment = mod.priceAdjustment;
          });
        }
      }
    }

    const table = await db.get<TableModel>("tables").find(params.tableId);
    await table.update((t) => {
      t.status = "occupied";
    });
  });

  await recalculateOrderTotals(orderId);

  await db.write(async () => {
    const order = await db.get<Order>("orders").find(orderId);
    const totalQty = params.items.reduce((s, d) => s + d.quantity, 0);
    await order.update((o) => {
      o.itemCount = totalQty;
    });
  });

  syncManager.triggerPush();

  return { orderId, orderNumber, sentItemIds };
}
