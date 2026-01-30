import { describe, expect, it } from "vitest";
import {
  aggregateOrderTotals,
  calculateChange,
  calculateItemTotals,
  calculateScPwdDiscount,
  calculateVatBreakdown,
  formatPeso,
  SC_PWD_DISCOUNT_RATE,
  VAT_RATE,
} from "./taxCalculations";

describe("calculateVatBreakdown", () => {
  it("should split vatable price into VAT-exclusive and VAT amount", () => {
    // 11200 centavos (₱112.00) VAT-inclusive
    const result = calculateVatBreakdown(11200, true);
    // base = 11200 / 1.12 = 10000
    expect(result.vatExclusive).toBe(10000);
    expect(result.vatAmount).toBe(1200);
  });

  it("should return full amount as VAT-exclusive when non-vatable", () => {
    const result = calculateVatBreakdown(10000, false);
    expect(result.vatExclusive).toBe(10000);
    expect(result.vatAmount).toBe(0);
  });

  it("should handle rounding for non-round amounts", () => {
    // 10000 / 1.12 = 8928.571... → rounds to 8929
    const result = calculateVatBreakdown(10000, true);
    expect(result.vatExclusive).toBe(8929);
    expect(result.vatAmount).toBe(10000 - 8929);
  });

  it("should handle zero", () => {
    const result = calculateVatBreakdown(0, true);
    expect(result.vatExclusive).toBe(0);
    expect(result.vatAmount).toBe(0);
  });
});

describe("calculateScPwdDiscount", () => {
  it("should apply 20% discount on VAT-exclusive price", () => {
    // ₱112.00 (11200 centavos) VAT-inclusive
    // VAT-exclusive = 11200 / 1.12 = 10000
    // 20% discount = 2000
    // Discounted = 10000 - 2000 = 8000
    const result = calculateScPwdDiscount(11200);
    expect(result.discountedPrice).toBe(8000);
    expect(result.discountAmount).toBe(2000);
    expect(result.vatExemptAmount).toBe(10000);
  });

  it("should handle small amounts with rounding", () => {
    // 100 centavos → VAT-exclusive = round(100/1.12) = 89
    // discount = round(89 * 0.2) = 18
    // discounted = 89 - 18 = 71
    const result = calculateScPwdDiscount(100);
    expect(result.vatExemptAmount).toBe(89);
    expect(result.discountAmount).toBe(18);
    expect(result.discountedPrice).toBe(71);
  });
});

describe("calculateItemTotals", () => {
  it("should calculate totals for regular vatable items", () => {
    const result = calculateItemTotals(11200, 2, true, 0);
    expect(result.grossAmount).toBe(22400);
    // VAT-exclusive of 22400 = round(22400/1.12) = 20000
    expect(result.vatableAmount).toBe(20000);
    expect(result.vatAmount).toBe(2400);
    expect(result.vatExemptAmount).toBe(0);
    expect(result.nonVatAmount).toBe(0);
    expect(result.discountAmount).toBe(0);
    expect(result.netAmount).toBe(22400);
  });

  it("should calculate totals for non-vatable items", () => {
    const result = calculateItemTotals(5000, 3, false, 0);
    expect(result.grossAmount).toBe(15000);
    expect(result.vatableAmount).toBe(0);
    expect(result.vatAmount).toBe(0);
    expect(result.nonVatAmount).toBe(15000);
    expect(result.netAmount).toBe(15000);
  });

  it("should handle mixed regular + SC/PWD quantities", () => {
    // 3 items at 11200, 1 SC/PWD
    const result = calculateItemTotals(11200, 3, true, 1);
    expect(result.grossAmount).toBe(33600);
    // SC/PWD: discountedPrice = 8000, discount = 2000, vatExempt = 10000
    expect(result.discountAmount).toBe(2000);
    expect(result.vatExemptAmount).toBe(10000);
    // Net = regularGross(2*11200=22400) + scPwdNet(8000) = 30400
    expect(result.netAmount).toBe(30400);
  });

  it("should handle zero quantity", () => {
    const result = calculateItemTotals(11200, 0, true, 0);
    expect(result.grossAmount).toBe(0);
    expect(result.netAmount).toBe(0);
  });
});

describe("aggregateOrderTotals", () => {
  it("should sum all fields across multiple items", () => {
    const items = [calculateItemTotals(11200, 2, true, 0), calculateItemTotals(5000, 1, false, 0)];
    const totals = aggregateOrderTotals(items);
    expect(totals.grossSales).toBe(22400 + 5000);
    expect(totals.nonVatSales).toBe(5000);
    expect(totals.netSales).toBe(22400 + 5000);
  });

  it("should return zeros for empty array", () => {
    const totals = aggregateOrderTotals([]);
    expect(totals.grossSales).toBe(0);
    expect(totals.vatableSales).toBe(0);
    expect(totals.vatAmount).toBe(0);
    expect(totals.vatExemptSales).toBe(0);
    expect(totals.nonVatSales).toBe(0);
    expect(totals.discountAmount).toBe(0);
    expect(totals.netSales).toBe(0);
  });
});

describe("calculateChange", () => {
  it("should return correct change", () => {
    expect(calculateChange(15000, 20000)).toBe(5000);
  });

  it("should return zero when exact amount", () => {
    expect(calculateChange(15000, 15000)).toBe(0);
  });

  it("should return negative when insufficient", () => {
    expect(calculateChange(15000, 10000)).toBe(-5000);
  });
});

describe("formatPeso", () => {
  it("should format centavos to PHP currency string", () => {
    const result = formatPeso(15000);
    // Intl format for PHP: ₱150.00
    expect(result).toContain("150.00");
  });

  it("should format zero", () => {
    const result = formatPeso(0);
    expect(result).toContain("0.00");
  });
});
