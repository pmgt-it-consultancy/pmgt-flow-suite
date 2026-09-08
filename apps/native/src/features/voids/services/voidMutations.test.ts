import { type Database, Q } from "@nozbe/watermelondb";
import type { Order, OrderItem, OrderItemModifier, Product, Store } from "../../../db/models";
import { createTestDatabase } from "../../../db/testing/createTestDatabase";
import { voidPaidOrderRefund } from "./voidMutations";

let mockDatabase: Database;
jest.mock("../../../db/database", () => ({ getDatabase: () => mockDatabase }));
// Native device identity is a system boundary; sync itself is left intact.
jest.mock("../../../auth/deviceId", () => ({ getOrCreateDeviceId: async () => "test-device" }));

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it("refunds selected items while retaining remaining modifier charges without reading unrelated modifiers", async () => {
  jest.useFakeTimers();
  mockDatabase = createTestDatabase();
  await mockDatabase.write(async () => {
    await mockDatabase.batch(
      mockDatabase.get<Store>("stores").prepareCreate((s) => {
        s._raw.id = "s";
        s.vatRate = 0.12;
      }),
      mockDatabase.get<Product>("products").prepareCreate((p) => {
        p._raw.id = "p";
        p.isVatable = false;
      }),
      mockDatabase.get<Order>("orders").prepareCreate((o) => {
        o._raw.id = "order";
        o.storeId = "s";
        o.status = "paid";
        o.orderType = "takeout";
        o.netSales = 45;
      }),
      ...["refund", "keep"].map((id) =>
        mockDatabase.get<OrderItem>("order_items").prepareCreate((i) => {
          i._raw.id = id;
          i.orderId = "order";
          i.productId = "p";
          i.productPrice = 20;
          i.quantity = 1;
          i.isVoided = false;
        }),
      ),
      mockDatabase.get<OrderItemModifier>("order_item_modifiers").prepareCreate((m) => {
        m._raw.id = "mod";
        m.orderItemId = "keep";
        m.priceAdjustment = 5;
      }),
      mockDatabase.get<OrderItemModifier>("order_item_modifiers").prepareCreate((m) => {
        m._raw.id = "unrelated";
        m.orderItemId = "old-item";
        m.priceAdjustment = 999;
      }),
    );
  });
  // Observe adapter payload size, not method invocation count: unrelated models
  // must not cross the storage boundary during this cashier operation.
  const originalQuery = mockDatabase.adapter.underlyingAdapter.query.bind(
    mockDatabase.adapter.underlyingAdapter,
  );
  let modifierRows = 0;
  jest
    .spyOn(mockDatabase.adapter.underlyingAdapter, "query")
    .mockImplementation((query, callback) =>
      originalQuery(query, (result) => {
        if (query.table === "order_item_modifiers" && "value" in result)
          modifierRows += result.value.length;
        callback(result);
      }),
    );
  const result = await voidPaidOrderRefund({
    orderId: "order",
    refundedItemIds: ["refund"],
    reason: "Return",
    refundMethod: "cash",
    managerId: "manager",
  });
  expect(result.refundAmount).toBe(20);
  const replacement = await mockDatabase.get<Order>("orders").find(result.replacementOrderId!);
  expect(replacement.netSales).toBe(25);
  expect(
    await mockDatabase
      .get("order_payments")
      .query(Q.where("order_id", replacement.id))
      .fetchCount(),
  ).toBe(1);
  expect(modifierRows).toBe(2); // one original retained modifier plus its replacement copy
});
