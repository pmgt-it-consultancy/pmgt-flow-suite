import type { Database } from "@nozbe/watermelondb";
import type {
  Order,
  OrderDiscount,
  OrderItem,
  Product,
  Store,
  TableModel,
} from "../../../db/models";
import { createTestDatabase } from "../../../db/testing/createTestDatabase";
import {
  addItemToOrder,
  createAndSendToKitchen,
  removeItemFromOrder,
  updateItemQuantity,
} from "./orderMutations";

let mockDatabase: Database;
jest.mock("../../../db/database", () => ({ getDatabase: () => mockDatabase }));
jest.mock("../../../auth/deviceId", () => ({ getOrCreateDeviceId: async () => "test-device" }));
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});
beforeEach(async () => {
  jest.useFakeTimers();
  mockDatabase = createTestDatabase();
  await mockDatabase.write(() =>
    mockDatabase.batch(
      mockDatabase.get<Store>("stores").prepareCreate((s) => {
        s._raw.id = "s";
        s.vatRate = 0.12;
      }),
      mockDatabase.get<Product>("products").prepareCreate((p) => {
        p._raw.id = "p";
        p.price = 20;
        p.name = "Tea";
        p.isVatable = false;
      }),
      mockDatabase.get<Order>("orders").prepareCreate((o) => {
        o._raw.id = "o";
        o.storeId = "s";
        o.status = "open";
        o.itemCount = 0;
      }),
      mockDatabase.get<TableModel>("tables").prepareCreate((t) => {
        t._raw.id = "t";
        t.status = "available";
      }),
    ),
  );
});
it("commits a line with its modifiers together and retains quantity/void totals", async () => {
  const batches: string[][] = [];
  const adapter = mockDatabase.adapter.underlyingAdapter;
  const batch = adapter.batch.bind(adapter);
  jest.spyOn(adapter, "batch").mockImplementation((ops, callback) => {
    batches.push(ops.map((op) => op[1]));
    batch(ops, callback);
  });
  await addItemToOrder({
    orderId: "o",
    productId: "p",
    quantity: 2,
    modifiers: [{ modifierGroupName: "Size", modifierOptionName: "Large", priceAdjustment: 5 }],
  });
  const order = await mockDatabase.get<Order>("orders").find("o");
  const [item] = await mockDatabase.get<OrderItem>("order_items").query().fetch();
  expect(order.netSales).toBe(50);
  expect(order.itemCount).toBe(2);
  expect(batches[0]).toEqual(["order_items", "order_item_modifiers", "orders"]);
  expect(batches).toHaveLength(2); // line transaction + recalculated totals
  await updateItemQuantity({ orderItemId: item.id, quantity: 3 });
  expect(order.netSales).toBe(75);
  expect(order.itemCount).toBe(3);
  await removeItemFromOrder({ orderItemId: item.id });
  expect(order.netSales).toBe(0);
  expect(order.itemCount).toBe(0);
});
it("rejects a missing product without creating a partial line", async () => {
  await expect(
    addItemToOrder({ orderId: "o", productId: "missing", quantity: 1 }),
  ).rejects.toThrow();
  expect(await mockDatabase.get("order_items").query().fetchCount()).toBe(0);
  expect((await mockDatabase.get<Order>("orders").find("o")).itemCount).toBe(0);
});
it.each([
  "senior_citizen",
  "pwd",
])("preserves VAT and %s discounts through quantity changes and voids", async (discountType) => {
  const product = await mockDatabase.get<Product>("products").find("p");
  await mockDatabase.write(() =>
    product.update((p) => {
      p.price = 100;
      p.isVatable = true;
    }),
  );
  await addItemToOrder({
    orderId: "o",
    productId: "p",
    quantity: 2,
    modifiers: [{ modifierGroupName: "Extra", modifierOptionName: "Milk", priceAdjustment: 12 }],
  });
  const [item] = await mockDatabase.get<OrderItem>("order_items").query().fetch();
  const discount = await mockDatabase.write(() =>
    mockDatabase.get<OrderDiscount>("order_discounts").create((d) => {
      d.orderId = "o";
      d.orderItemId = item.id;
      d.discountType = discountType;
      d.quantityApplied = 1;
    }),
  );
  await updateItemQuantity({ orderItemId: item.id, quantity: 3 });
  const order = await mockDatabase.get<Order>("orders").find("o");
  // Two regular VAT-inclusive units (112 each) plus one exempt discounted unit (80).
  expect(order.netSales).toBe(304);
  expect(order.vatAmount).toBe(24);
  expect(order.discountAmount).toBe(20);
  expect(order.itemCount).toBe(3);
  expect(discount.discountAmount).toBe(20);
  await removeItemFromOrder({ orderItemId: item.id });
  expect(order.netSales).toBe(0);
  expect(order.vatAmount).toBe(0);
  expect(order.discountAmount).toBe(0);
  expect(order.itemCount).toBe(0);
  expect(discount.discountAmount).toBe(0);
});
it("does not leave a partial kitchen order when a draft contains a missing product", async () => {
  await expect(
    createAndSendToKitchen({
      storeId: "s",
      tableId: "t",
      pax: 2,
      items: [
        { productId: "p", quantity: 1 },
        { productId: "missing", quantity: 1 },
      ],
    }),
  ).rejects.toThrow();
  expect(await mockDatabase.get("orders").query().fetchCount()).toBe(1);
  expect(await mockDatabase.get("order_items").query().fetchCount()).toBe(0);
});
it("sends a complete draft with modifier-inclusive totals and the table occupied", async () => {
  const result = await createAndSendToKitchen({
    storeId: "s",
    tableId: "t",
    pax: 2,
    items: [
      {
        productId: "p",
        quantity: 2,
        modifiers: [{ modifierGroupName: "Size", modifierOptionName: "Large", priceAdjustment: 5 }],
      },
    ],
  });
  const order = await mockDatabase.get<Order>("orders").find(result.orderId);
  expect(order.netSales).toBe(50);
  expect(order.itemCount).toBe(2);
  expect(result.sentItemIds).toHaveLength(1);
  expect(
    (await mockDatabase.get<OrderItem>("order_items").find(result.sentItemIds[0])).isSentToKitchen,
  ).toBe(true);
  expect((await mockDatabase.get<TableModel>("tables").find("t")).status).toBe("occupied");
});
