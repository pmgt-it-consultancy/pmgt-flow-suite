import { buildItemCalculations, buildLineTotalByOrderId, calculateLineTotal } from "./orderTotals";

describe("calculateLineTotal", () => {
  it("adds modifier adjustments before multiplying quantity", () => {
    expect(
      calculateLineTotal({
        item: {
          id: "item-1",
          productPrice: 25,
          quantity: 2,
        },
        modifiersByItemId: new Map([
          [
            "item-1",
            [
              {
                priceAdjustment: 10,
              },
            ],
          ],
        ]),
      }),
    ).toBe(70);
  });
});

describe("buildItemCalculations", () => {
  it("includes modifier price adjustments in order totals", () => {
    const calculations = buildItemCalculations({
      items: [
        {
          id: "item-1",
          productId: "product-1",
          productPrice: 25,
          quantity: 1,
        },
      ],
      modifiersByItemId: new Map([
        [
          "item-1",
          [
            {
              priceAdjustment: 10,
            },
          ],
        ],
      ]),
      productById: new Map([
        [
          "product-1",
          {
            isVatable: false,
          },
        ],
      ]),
      discountRecords: [],
      vatRate: 0.12,
    });

    expect(calculations).toHaveLength(1);
    expect(calculations[0].grossAmount).toBe(35);
    expect(calculations[0].netAmount).toBe(35);
  });
});

describe("buildLineTotalByOrderId", () => {
  it("groups active item totals by order and includes modifiers", () => {
    const totals = buildLineTotalByOrderId({
      items: [
        {
          id: "item-1",
          orderId: "order-1",
          productPrice: 25,
          quantity: 1,
          isVoided: false,
        },
        {
          id: "item-2",
          orderId: "order-1",
          productPrice: 100,
          quantity: 1,
          isVoided: true,
        },
      ],
      modifiersByItemId: new Map([
        [
          "item-1",
          [
            {
              priceAdjustment: 10,
            },
          ],
        ],
      ]),
    });

    expect(totals.get("order-1")).toBe(35);
  });
});
