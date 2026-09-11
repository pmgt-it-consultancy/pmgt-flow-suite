import { mapHistoricalOrderDetail, mapHistorySummary } from "../historyMapping";

describe("mapHistoricalOrderDetail", () => {
  it("maps a server history summary into the list contract", () => {
    expect(
      mapHistorySummary({
        _id: "order-1",
        createdAt: 1,
        status: "paid",
        orderType: "takeout",
        netSales: 100,
        itemCount: 2,
      }),
    ).toMatchObject({ _id: "order-1", orderType: "takeout", netSales: 100, itemCount: 2 });
  });

  it("maps a complete server aggregate into the existing detail view", () => {
    const detail = mapHistoricalOrderDetail({
      aggregateVersion: 2,
      aggregate: {
        order: {
          _id: "order-1",
          storeId: "store-1",
          orderType: "takeout",
          status: "paid",
          grossSales: 100,
          vatableSales: 89.29,
          vatAmount: 10.71,
          vatExemptSales: 0,
          nonVatSales: 0,
          discountAmount: 0,
          netSales: 100,
          createdBy: "user-1",
          createdAt: 1,
        },
        items: [
          {
            _id: "item-1",
            productId: "product-1",
            productName: "Coffee",
            productPrice: 100,
            quantity: 1,
            isVoided: false,
          },
        ],
        modifiers: [],
        discounts: [],
        voids: [],
        payments: [],
      },
    });

    expect(detail._id).toBe("order-1");
    expect(detail.items[0]).toMatchObject({ productName: "Coffee", lineTotal: 100 });
  });
});
