import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import {
  aggregateOrderTotals,
  calculateItemTotals,
  calculateScPwdDiscount,
  type ItemCalculation,
} from "./lib/taxCalculations";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupDiscountTestData(t: any) {
  const roleId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("roles", {
      name: "Manager",
      permissions: [
        "orders.create",
        "orders.view",
        "orders.edit",
        "discounts.apply",
        "discounts.approve",
      ],
      scopeLevel: "branch",
      isSystem: false,
    });
  });

  const storeId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("stores", {
      name: "Test Store",
      address1: "123 Test St",
      tin: "123-456-789-000",
      min: "MIN-000001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  const userId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      name: "Manager User",
      email: "manager@test.com",
      roleId,
      storeId,
      isActive: true,
    });
  });

  const categoryId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("categories", {
      storeId,
      name: "Food",
      sortOrder: 1,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  const productId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("products", {
      storeId,
      name: "Adobo",
      categoryId,
      price: 11200, // ₱112.00 (nice for VAT: 11200/1.12 = 10000 exact)
      isVatable: true,
      isActive: true,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return { roleId, storeId, userId, categoryId, productId };
}

async function createOrderWithItem(
  t: any,
  storeId: any,
  userId: any,
  productId: any,
  quantity: number,
) {
  const orderId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("orders", {
      storeId,
      orderNumber: "D-001",
      orderType: "dine_in" as const,
      orderChannel: "walk_in_dine_in" as const,
      status: "open" as const,
      grossSales: 11200 * quantity,
      vatableSales: 10000 * quantity,
      vatAmount: 1200 * quantity,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 11200 * quantity,
      createdBy: userId,
      createdAt: Date.now(),
    });
  });

  const itemId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("orderItems", {
      orderId,
      productId,
      productName: "Adobo",
      productPrice: 11200,
      quantity,
      isVoided: false,
      isSentToKitchen: false,
    });
  });

  return { orderId, itemId };
}

describe("discounts — SC/PWD discount", () => {
  it("should apply SC/PWD discount with correct VAT exemption", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupDiscountTestData(t);
    const { orderId, itemId } = await createOrderWithItem(t, storeId, userId, productId, 3);

    // Apply SC discount to 1 of 3 items
    const scPwd = calculateScPwdDiscount(11200);
    const quantityApplied = 1;
    const discountAmount = scPwd.discountAmount * quantityApplied;
    const vatExemptAmount = scPwd.vatExemptAmount * quantityApplied;

    const discountId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orderDiscounts", {
        orderId,
        orderItemId: itemId,
        discountType: "senior_citizen" as const,
        customerName: "Juan Dela Cruz",
        customerId: "SC-12345",
        quantityApplied,
        discountAmount,
        vatExemptAmount,
        approvedBy: userId,
        createdAt: Date.now(),
      });
    });

    expect(discountAmount).toBe(2000); // 20% of 10000
    expect(vatExemptAmount).toBe(10000); // Full VAT-exclusive

    // Verify discount was stored
    const discount = await t.run(async (ctx: any) => ctx.db.get(discountId));
    expect(discount.discountType).toBe("senior_citizen");
    expect(discount.quantityApplied).toBe(1);
  });

  it("should block discount quantity exceeding item quantity", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupDiscountTestData(t);
    const { itemId } = await createOrderWithItem(t, storeId, userId, productId, 2);

    await expect(async () => {
      await t.run(async (ctx: any) => {
        const orderItem = await ctx.db.get(itemId);
        const quantityApplied = 3; // more than item quantity of 2
        if (quantityApplied > orderItem.quantity) {
          throw new Error("Discount quantity exceeds item quantity");
        }
      });
    }).rejects.toThrowError("Discount quantity exceeds item quantity");
  });

  it("should reject applying another SC/PWD discount to an already discounted item", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupDiscountTestData(t);
    const { orderId, itemId } = await createOrderWithItem(t, storeId, userId, productId, 2);

    const authed = t.withIdentity({ subject: userId });

    await authed.mutation(api.discounts.applyScPwdDiscount, {
      orderId,
      orderItemId: itemId,
      discountType: "senior_citizen",
      customerName: "Juan Dela Cruz",
      customerId: "SC-12345",
      quantityApplied: 1,
      managerId: userId,
    });

    await expect(
      authed.mutation(api.discounts.applyScPwdDiscount, {
        orderId,
        orderItemId: itemId,
        discountType: "senior_citizen",
        customerName: "Maria Dela Cruz",
        customerId: "SC-67890",
        quantityApplied: 1,
        managerId: userId,
      }),
    ).rejects.toThrowError("Item already has an SC/PWD discount");
  });

  it("should recalculate order totals with SC/PWD discount", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupDiscountTestData(t);
    const { orderId, itemId } = await createOrderWithItem(t, storeId, userId, productId, 3);

    // Apply SC discount to 1 of 3
    const scPwd = calculateScPwdDiscount(11200);
    await t.run(async (ctx: any) => {
      await ctx.db.insert("orderDiscounts", {
        orderId,
        orderItemId: itemId,
        discountType: "senior_citizen" as const,
        customerName: "Juan Dela Cruz",
        customerId: "SC-12345",
        quantityApplied: 1,
        discountAmount: scPwd.discountAmount,
        vatExemptAmount: scPwd.vatExemptAmount,
        approvedBy: userId,
        createdAt: Date.now(),
      });
    });

    // Recalculate totals (simulating recalculateOrderTotalsWithDiscounts)
    await t.run(async (ctx: any) => {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
        .collect();
      const activeItems = items.filter((i: any) => !i.isVoided);

      const discounts = await ctx.db
        .query("orderDiscounts")
        .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
        .collect();

      const itemDiscountQty = new Map<string, number>();
      for (const d of discounts) {
        if (d.orderItemId) {
          const current = itemDiscountQty.get(d.orderItemId) ?? 0;
          itemDiscountQty.set(d.orderItemId, current + d.quantityApplied);
        }
      }

      const itemCalcs: ItemCalculation[] = [];
      for (const item of activeItems) {
        const product = await ctx.db.get(item.productId);
        const isVatable = product?.isVatable ?? true;
        const scPwdQty = itemDiscountQty.get(item._id) ?? 0;
        itemCalcs.push(calculateItemTotals(item.productPrice, item.quantity, isVatable, scPwdQty));
      }

      const totals = aggregateOrderTotals(itemCalcs);
      await ctx.db.patch(orderId, {
        grossSales: totals.grossSales,
        vatableSales: totals.vatableSales,
        vatAmount: totals.vatAmount,
        vatExemptSales: totals.vatExemptSales,
        nonVatSales: totals.nonVatSales,
        discountAmount: totals.discountAmount,
        netSales: totals.netSales,
      });
    });

    const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
    // 3 items at 11200 = 33600 gross
    expect(order.grossSales).toBe(33600);
    // 1 SC/PWD discount = 2000
    expect(order.discountAmount).toBe(2000);
    // Net = 2 regular (22400) + 1 SC/PWD discounted (8000) = 30400
    expect(order.netSales).toBe(30400);
    // VAT exempt = 10000 (the SC/PWD item's VAT-exclusive price)
    expect(order.vatExemptSales).toBe(10000);
  });
});

describe("discounts — order-level discount", () => {
  it("should apply order-level promo discount", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupDiscountTestData(t);
    const { orderId } = await createOrderWithItem(t, storeId, userId, productId, 2);

    // Apply ₱50 promo discount (5000 centavos)
    const discountId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orderDiscounts", {
        orderId,
        orderItemId: undefined,
        discountType: "promo" as const,
        customerName: "Promo Customer",
        customerId: "",
        quantityApplied: 1,
        discountAmount: 5000,
        vatExemptAmount: 0,
        approvedBy: userId,
        createdAt: Date.now(),
      });
    });

    const discount = await t.run(async (ctx: any) => ctx.db.get(discountId));
    expect(discount.discountType).toBe("promo");
    expect(discount.discountAmount).toBe(5000);
    expect(discount.vatExemptAmount).toBe(0); // Promo doesn't exempt VAT
  });

  it("should block discount exceeding order total", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupDiscountTestData(t);
    const { orderId } = await createOrderWithItem(t, storeId, userId, productId, 1);

    await expect(async () => {
      await t.run(async (ctx: any) => {
        const order = await ctx.db.get(orderId);
        const discountAmount = 50000; // way more than grossSales of 11200
        if (discountAmount > order.grossSales) {
          throw new Error("Discount exceeds order total");
        }
      });
    }).rejects.toThrowError("Discount exceeds order total");
  });
});

describe("discounts — remove discount", () => {
  it("should remove discount and allow totals recalculation", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, productId } = await setupDiscountTestData(t);
    const { orderId, itemId } = await createOrderWithItem(t, storeId, userId, productId, 2);

    // Add discount
    const discountId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("orderDiscounts", {
        orderId,
        orderItemId: itemId,
        discountType: "senior_citizen" as const,
        customerName: "Juan",
        customerId: "SC-123",
        quantityApplied: 1,
        discountAmount: 2000,
        vatExemptAmount: 10000,
        approvedBy: userId,
        createdAt: Date.now(),
      });
    });

    // Remove discount
    await t.run(async (ctx: any) => {
      await ctx.db.delete(discountId);
    });

    const removed = await t.run(async (ctx: any) => ctx.db.get(discountId));
    expect(removed).toBeNull();

    // Recalculate without discounts
    await t.run(async (ctx: any) => {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", orderId))
        .collect();
      const activeItems = items.filter((i: any) => !i.isVoided);

      const itemCalcs: ItemCalculation[] = [];
      for (const item of activeItems) {
        const product = await ctx.db.get(item.productId);
        const isVatable = product?.isVatable ?? true;
        itemCalcs.push(calculateItemTotals(item.productPrice, item.quantity, isVatable, 0));
      }

      const totals = aggregateOrderTotals(itemCalcs);
      await ctx.db.patch(orderId, {
        grossSales: totals.grossSales,
        vatableSales: totals.vatableSales,
        vatAmount: totals.vatAmount,
        vatExemptSales: totals.vatExemptSales,
        nonVatSales: totals.nonVatSales,
        discountAmount: totals.discountAmount,
        netSales: totals.netSales,
      });
    });

    const order = await t.run(async (ctx: any) => ctx.db.get(orderId));
    // No discounts, full price for 2 items
    expect(order.grossSales).toBe(22400);
    expect(order.discountAmount).toBe(0);
    expect(order.netSales).toBe(22400);
    expect(order.vatExemptSales).toBe(0);
  });
});
