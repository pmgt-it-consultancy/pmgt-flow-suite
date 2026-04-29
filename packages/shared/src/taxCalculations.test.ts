import { describe, expect, it } from "vitest";
import {
  aggregateOrderTotals,
  calculateChange,
  calculateItemTotals,
  calculateScPwdDiscount,
  calculateVatBreakdown,
  type ItemCalculation,
} from "./taxCalculations";

describe("calculateVatBreakdown", () => {
  it("extracts 12% VAT from a VAT-inclusive price", () => {
    const result = calculateVatBreakdown(112, true);
    expect(result.vatExclusive).toBe(100);
    expect(result.vatAmount).toBe(12);
  });

  it("returns no VAT for non-vatable items", () => {
    const result = calculateVatBreakdown(112, false);
    expect(result.vatExclusive).toBe(112);
    expect(result.vatAmount).toBe(0);
  });

  it("handles rounded edge case (VAT-inclusive 100)", () => {
    const result = calculateVatBreakdown(100, true);
    expect(result.vatExclusive).toBe(89.29);
    expect(result.vatAmount).toBe(10.71);
  });

  it("returns no VAT for zero vatRate", () => {
    const result = calculateVatBreakdown(112, true, 0);
    expect(result.vatExclusive).toBe(112);
    expect(result.vatAmount).toBe(0);
  });
});

describe("calculateScPwdDiscount", () => {
  it("gives 20% discount on VAT-exclusive price + VAT exemption", () => {
    const result = calculateScPwdDiscount(112);
    expect(result.discountAmount).toBe(20);
    expect(result.discountedPrice).toBe(80);
    expect(result.vatExemptAmount).toBe(100);
  });

  it("handles zero VAT rate (NON-VAT store)", () => {
    const result = calculateScPwdDiscount(100, 0);
    expect(result.discountAmount).toBe(20);
    expect(result.discountedPrice).toBe(80);
    expect(result.vatExemptAmount).toBe(0);
  });

  it("handles small amounts correctly", () => {
    const result = calculateScPwdDiscount(50, 0.12);
    expect(result.discountedPrice).toBe(35.71);
  });
});

describe("calculateItemTotals", () => {
  it("calculates regular vatable item", () => {
    const result = calculateItemTotals(112, 2, true);
    expect(result.grossAmount).toBe(224);
    expect(result.vatableAmount).toBe(200);
    expect(result.vatAmount).toBe(24);
    expect(result.netAmount).toBe(224);
  });

  it("calculates non-vatable item", () => {
    const result = calculateItemTotals(50, 3, false);
    expect(result.grossAmount).toBe(150);
    expect(result.vatableAmount).toBe(0);
    expect(result.vatAmount).toBe(0);
    expect(result.nonVatAmount).toBe(150);
    expect(result.netAmount).toBe(150);
  });

  it("includes SC/PWD discount portion", () => {
    const result = calculateItemTotals(112, 2, true, 1, 0.12);
    expect(result.discountAmount).toBe(20);
    expect(result.vatExemptAmount).toBe(100);
    expect(result.grossAmount).toBe(224);
  });

  it("handles NON-VAT store items", () => {
    const result = calculateItemTotals(100, 2, true, 0, 0);
    expect(result.vatableAmount).toBe(0);
    expect(result.nonVatAmount).toBe(200);
    expect(result.vatAmount).toBe(0);
  });
});

describe("aggregateOrderTotals", () => {
  it("aggregates multiple items correctly", () => {
    const items: ItemCalculation[] = [
      {
        grossAmount: 224,
        vatableAmount: 200,
        vatAmount: 24,
        vatExemptAmount: 100,
        nonVatAmount: 0,
        discountAmount: 20,
        netAmount: 180,
      },
      {
        grossAmount: 150,
        vatableAmount: 0,
        vatAmount: 0,
        vatExemptAmount: 0,
        nonVatAmount: 150,
        discountAmount: 0,
        netAmount: 150,
      },
    ];
    const result = aggregateOrderTotals(items);
    expect(result.grossSales).toBe(374);
    expect(result.vatableSales).toBe(200);
    expect(result.vatAmount).toBe(24);
    expect(result.vatExemptSales).toBe(100);
    expect(result.nonVatSales).toBe(150);
    expect(result.discountAmount).toBe(20);
    expect(result.netSales).toBe(330);
  });

  it("returns zeros for empty items", () => {
    const result = aggregateOrderTotals([]);
    expect(result.grossSales).toBe(0);
    expect(result.netSales).toBe(0);
  });
});

describe("calculateChange", () => {
  it("returns positive change for overpayment", () => {
    expect(calculateChange(350, 500)).toBe(150);
  });

  it("returns negative for underpayment", () => {
    expect(calculateChange(350, 300)).toBe(-50);
  });
});
