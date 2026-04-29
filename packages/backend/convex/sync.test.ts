import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupSyncTestData(t: any) {
  const roleId = await t.run(async (ctx: any) =>
    ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["orders.create", "orders.view", "orders.edit"],
      scopeLevel: "branch",
      isSystem: false,
      updatedAt: Date.now(),
      clientId: "role-client-id",
    }),
  );

  const storeId = await t.run(async (ctx: any) =>
    ctx.db.insert("stores", {
      name: "Test Store",
      address1: "123 Test St",
      tin: "123-456-789-000",
      min: "MIN-000001",
      vatRate: 12,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      clientId: "store-client-id",
    }),
  );

  const userId = await t.run(async (ctx: any) =>
    ctx.db.insert("users", {
      name: "Test User",
      email: "test@test.com",
      roleId,
      storeId,
      isActive: true,
      updatedAt: Date.now(),
      clientId: "user-client-id",
    }),
  );

  return { roleId, storeId, userId };
}

describe("sync pull", () => {
  it("deduplicates legacy _id fallback rows when a later document has the same clientId", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupSyncTestData(t);
    const now = Date.now();

    const legacyOrderId = await t.run(async (ctx: any) =>
      ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-001",
        orderType: "takeout",
        status: "draft",
        grossSales: 1001,
        vatableSales: 0.89,
        vatAmount: 0.11,
        vatExemptSales: 0,
        nonVatSales: 1000,
        discountAmount: 0,
        netSales: 1001,
        createdBy: userId,
        createdAt: now,
      }),
    );

    await t.run(async (ctx: any) =>
      ctx.db.insert("orders", {
        storeId,
        orderType: "takeout",
        status: "voided",
        grossSales: 1001,
        vatableSales: 0.89,
        vatAmount: 0.11,
        vatExemptSales: 0,
        nonVatSales: 1000,
        discountAmount: 0,
        netSales: 1001,
        createdBy: userId,
        createdAt: now,
        updatedAt: now + 10,
        clientId: legacyOrderId,
        originDeviceId: "tablet-a",
      }),
    );

    const result = await t.query(internal.sync.syncPullCore, { storeId, lastPulledAt: 0 });
    const pulledOrders = result.changes.orders.created.filter(
      (row: any) => row.id === legacyOrderId,
    );

    expect(pulledOrders).toHaveLength(1);
    expect(pulledOrders[0].server_id).not.toBe(legacyOrderId);
    expect(pulledOrders[0].status).toBe("voided");
  });
});

describe("sync push", () => {
  it("updates a legacy row addressed by Convex id instead of inserting a duplicate clientId", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupSyncTestData(t);
    const now = Date.now();

    const legacyOrderId = await t.run(async (ctx: any) =>
      ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-001",
        orderType: "takeout",
        status: "open",
        grossSales: 1001,
        vatableSales: 0.89,
        vatAmount: 0.11,
        vatExemptSales: 0,
        nonVatSales: 1000,
        discountAmount: 0,
        netSales: 1001,
        createdBy: userId,
        createdAt: now,
      }),
    );

    const response = await t.mutation(internal.sync.syncPushCore, {
      storeId,
      userId,
      deviceId: "tablet-a",
      payload: {
        lastPulledAt: now,
        clientMutationId: "legacy-order-update-1",
        changes: {
          orders: {
            created: [],
            updated: [
              {
                id: legacyOrderId,
                orderType: "takeout",
                status: "voided",
                grossSales: 1001,
                vatableSales: 0.89,
                vatAmount: 0.11,
                vatExemptSales: 0,
                nonVatSales: 1000,
                discountAmount: 0,
                netSales: 1001,
                createdAt: now,
              },
            ],
          },
        },
      },
    });

    expect(response).toEqual({ success: true });
    const matchingOrders = await t.run(async (ctx: any) => {
      const orders = await ctx.db.query("orders").collect();
      return orders.filter(
        (order: any) => order._id === legacyOrderId || order.clientId === legacyOrderId,
      );
    });

    expect(matchingOrders).toHaveLength(1);
    expect(matchingOrders[0]._id).toBe(legacyOrderId);
    expect(matchingOrders[0].clientId).toBe(legacyOrderId);
    expect(matchingOrders[0].status).toBe("voided");
  });

  it("resolves order item FKs when parent rows are addressed by legacy Convex ids", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupSyncTestData(t);
    const now = Date.now();

    const categoryId = await t.run(async (ctx: any) =>
      ctx.db.insert("categories", {
        storeId,
        name: "Food",
        sortOrder: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const productId = await t.run(async (ctx: any) =>
      ctx.db.insert("products", {
        storeId,
        name: "Burger",
        categoryId,
        price: 200,
        isVatable: true,
        isActive: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const orderId = await t.run(async (ctx: any) =>
      ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-001",
        orderType: "takeout",
        status: "open",
        grossSales: 0,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 0,
        createdBy: userId,
        createdAt: now,
      }),
    );

    const response = await t.mutation(internal.sync.syncPushCore, {
      storeId,
      userId,
      deviceId: "tablet-a",
      payload: {
        lastPulledAt: now,
        clientMutationId: "legacy-fk-order-item-1",
        changes: {
          orderItems: {
            created: [
              {
                id: "order-item-client-id",
                orderId,
                productId,
                productName: "Burger",
                productPrice: 200,
                quantity: 1,
                isVoided: false,
              },
            ],
            updated: [],
          },
        },
      },
    });

    expect(response).toEqual({ success: true });
    const items = await t.run(async (ctx: any) => ctx.db.query("orderItems").collect());

    expect(items).toHaveLength(1);
    expect(items[0].orderId).toBe(orderId);
    expect(items[0].productId).toBe(productId);
  });

  it("accepts idempotent paid-order replays so Watermelon can clear retried pushes", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupSyncTestData(t);
    const now = Date.now();

    await t.run(async (ctx: any) =>
      ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-001",
        orderType: "takeout",
        status: "paid",
        grossSales: 1212,
        vatableSales: 178.58,
        vatAmount: 21.42,
        vatExemptSales: 0,
        nonVatSales: 1012,
        discountAmount: 0,
        netSales: 1212,
        paymentMethod: "cash",
        cashReceived: 1212,
        createdBy: userId,
        createdAt: now,
        paidAt: now + 1,
        paidBy: userId,
        updatedAt: now + 2,
        clientId: "paid-order-client-id",
        originDeviceId: "tablet-a",
      }),
    );

    const response = await t.mutation(internal.sync.syncPushCore, {
      storeId,
      userId,
      deviceId: "tablet-a",
      payload: {
        lastPulledAt: now,
        clientMutationId: "paid-order-replay-1",
        changes: {
          orders: {
            created: [],
            updated: [
              {
                id: "paid-order-client-id",
                orderType: "takeout",
                status: "paid",
                grossSales: 1212,
                vatableSales: 178.58,
                vatAmount: 21.42,
                vatExemptSales: 0,
                nonVatSales: 1012,
                discountAmount: 0,
                netSales: 1212,
                paymentMethod: "cash",
                cashReceived: 1212,
                createdAt: now,
                paidAt: now + 1,
                paidBy: userId,
              },
            ],
          },
        },
      },
    });

    expect(response).toEqual({ success: true });
  });

  it("deletes pushed order discounts by sync id", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupSyncTestData(t);
    const now = Date.now();

    const orderId = await t.run(async (ctx: any) =>
      ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-001",
        orderType: "takeout",
        status: "open",
        grossSales: 200,
        vatableSales: 178.57,
        vatAmount: 21.43,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 20,
        netSales: 180,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        clientId: "discount-order-client-id",
      }),
    );

    await t.run(async (ctx: any) =>
      ctx.db.insert("orderDiscounts", {
        orderId,
        storeId,
        discountType: "manual",
        customerName: "Promo",
        customerId: "N/A",
        quantityApplied: 1,
        discountAmount: 20,
        vatExemptAmount: 0,
        approvedBy: userId,
        createdAt: now,
        updatedAt: now,
        clientId: "discount-client-id",
      }),
    );

    const response = await t.mutation(internal.sync.syncPushCore, {
      storeId,
      userId,
      deviceId: "tablet-a",
      payload: {
        lastPulledAt: now,
        clientMutationId: "discount-delete-1",
        changes: {
          orderDiscounts: {
            created: [],
            updated: [],
            deleted: ["discount-client-id"],
          },
        },
      },
    });

    expect(response).toEqual({ success: true });
    const discounts = await t.run(async (ctx: any) => ctx.db.query("orderDiscounts").collect());
    expect(discounts).toHaveLength(0);
  });

  it("applies tablet table occupancy updates after resolving current order", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupSyncTestData(t);
    const now = Date.now();

    const tableId = await t.run(async (ctx: any) =>
      ctx.db.insert("tables", {
        storeId,
        name: "Table 1",
        capacity: 4,
        status: "available",
        sortOrder: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        clientId: "table-client-id",
      }),
    );

    const orderId = "new-order-client-id";
    const response = await t.mutation(internal.sync.syncPushCore, {
      storeId,
      userId,
      deviceId: "tablet-a",
      payload: {
        lastPulledAt: now,
        clientMutationId: "table-occupancy-1",
        changes: {
          orders: {
            created: [
              {
                id: orderId,
                orderNumber: "D-001",
                orderType: "dine_in",
                orderChannel: "walk_in_dine_in",
                tableId: "table-client-id",
                status: "open",
                grossSales: 0,
                vatableSales: 0,
                vatAmount: 0,
                vatExemptSales: 0,
                nonVatSales: 0,
                discountAmount: 0,
                netSales: 0,
                createdAt: now,
              },
            ],
            updated: [],
          },
          tables: {
            created: [],
            updated: [
              {
                id: "table-client-id",
                status: "occupied",
                currentOrderId: orderId,
              },
            ],
          },
        },
      },
    });

    expect(response).toEqual({ success: true });
    const table = await t.run(async (ctx: any) => ctx.db.get(tableId));
    const order = await t.run(async (ctx: any) =>
      ctx.db
        .query("orders")
        .withIndex("by_clientId", (q: any) => q.eq("clientId", orderId))
        .first(),
    );

    expect(table?.status).toBe("occupied");
    expect(table?.currentOrderId).toBe(order?._id);
  });

  it("allows cross-device paid takeout workflow status updates without rewriting financial fields", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupSyncTestData(t);
    const now = Date.now();

    await t.run(async (ctx: any) =>
      ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-A001",
        orderType: "takeout",
        takeoutStatus: "preparing",
        status: "paid",
        grossSales: 500,
        vatableSales: 446.43,
        vatAmount: 53.57,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 500,
        paymentMethod: "cash",
        cashReceived: 500,
        createdBy: userId,
        createdAt: now,
        paidAt: now + 1,
        paidBy: userId,
        updatedAt: now + 2,
        clientId: "paid-takeout-client-id",
        originDeviceId: "tablet-a",
      }),
    );

    const response = await t.mutation(internal.sync.syncPushCore, {
      storeId,
      userId,
      deviceId: "tablet-b",
      payload: {
        lastPulledAt: now,
        clientMutationId: "paid-takeout-status-b",
        changes: {
          orders: {
            created: [],
            updated: [
              {
                id: "paid-takeout-client-id",
                orderType: "takeout",
                takeoutStatus: "completed",
                status: "paid",
                grossSales: 9999,
                vatableSales: 9999,
                vatAmount: 9999,
                vatExemptSales: 0,
                nonVatSales: 0,
                discountAmount: 0,
                netSales: 9999,
                createdAt: now,
              },
            ],
          },
        },
      },
    });

    expect(response).toEqual({ success: true });
    const order = await t.run(async (ctx: any) =>
      ctx.db
        .query("orders")
        .withIndex("by_clientId", (q: any) => q.eq("clientId", "paid-takeout-client-id"))
        .first(),
    );

    expect(order?.takeoutStatus).toBe("completed");
    expect(order?.netSales).toBe(500);
    expect(order?.grossSales).toBe(500);
  });

  it("preserves pushed manager actors instead of collapsing to the sync user", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupSyncTestData(t);
    const now = Date.now();

    const managerId = await t.run(async (ctx: any) =>
      ctx.db.insert("users", {
        name: "Approving Manager",
        email: "manager@test.com",
        storeId,
        isActive: true,
        updatedAt: now,
        clientId: "manager-client-id",
      }),
    );

    const orderId = await t.run(async (ctx: any) =>
      ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-A001",
        orderType: "takeout",
        status: "open",
        grossSales: 500,
        vatableSales: 446.43,
        vatAmount: 53.57,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 500,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        clientId: "actor-order-client-id",
      }),
    );

    const response = await t.mutation(internal.sync.syncPushCore, {
      storeId,
      userId,
      deviceId: "tablet-a",
      payload: {
        lastPulledAt: now,
        clientMutationId: "actor-preserve-1",
        changes: {
          orderVoids: {
            created: [
              {
                id: "void-client-id",
                orderId: "actor-order-client-id",
                voidType: "full_order",
                reason: "Customer cancelled",
                approvedBy: "manager-client-id",
                requestedBy: "manager-client-id",
                amount: 500,
                createdAt: now + 1,
              },
            ],
            updated: [],
          },
          auditLogs: {
            created: [
              {
                id: "audit-client-id",
                storeId,
                action: "void_order",
                entityType: "order",
                entityId: orderId,
                details: "{}",
                userId: "manager-client-id",
                createdAt: now + 1,
              },
            ],
            updated: [],
          },
        },
      },
    });

    expect(response).toEqual({ success: true });
    const voidRecord = await t.run(async (ctx: any) => ctx.db.query("orderVoids").first());
    const auditLog = await t.run(async (ctx: any) => ctx.db.query("auditLogs").first());

    expect(voidRecord?.approvedBy).toBe(managerId);
    expect(voidRecord?.requestedBy).toBe(managerId);
    expect(auditLog?.userId).toBe(managerId);
  });

  it("reassigns duplicate incoming order numbers using the device code", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupSyncTestData(t);
    const now = Date.now();

    await t.run(async (ctx: any) => {
      await ctx.db.insert("syncDevices", {
        deviceId: "tablet-b",
        storeId,
        deviceCode: "B",
        registeredAt: now,
        lastSeenAt: now,
      });
      await ctx.db.insert("orders", {
        storeId,
        orderNumber: "T-X001",
        orderType: "takeout",
        status: "open",
        grossSales: 0,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 0,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        clientId: "existing-order-client-id",
      });
    });

    const response = await t.mutation(internal.sync.syncPushCore, {
      storeId,
      userId,
      deviceId: "tablet-b",
      payload: {
        lastPulledAt: now,
        clientMutationId: "order-number-conflict-1",
        changes: {
          orders: {
            created: [
              {
                id: "new-conflict-order-client-id",
                orderNumber: "T-X001",
                orderType: "takeout",
                status: "open",
                grossSales: 0,
                vatableSales: 0,
                vatAmount: 0,
                vatExemptSales: 0,
                nonVatSales: 0,
                discountAmount: 0,
                netSales: 0,
                createdAt: now,
              },
            ],
            updated: [],
          },
        },
      },
    });

    expect(response).toEqual({ success: true });
    const newOrder = await t.run(async (ctx: any) =>
      ctx.db
        .query("orders")
        .withIndex("by_clientId", (q: any) => q.eq("clientId", "new-conflict-order-client-id"))
        .first(),
    );

    expect(newOrder?.orderNumber).toBe("T-B001");
  });
});
