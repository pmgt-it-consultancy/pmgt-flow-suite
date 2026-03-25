import { describe, expect, it } from "vitest";
import {
  aggregateOrderTotals,
  calculateChange,
  calculateItemTotals,
  calculateScPwdDiscount,
  calculateVatBreakdown,
  formatPhpCurrency,
  SC_PWD_DISCOUNT_RATE,
  VAT_RATE,
} from "./taxCalculations";

describe("calculateVatBreakdown", () => {
  it("should split vatable price into VAT-exclusive and VAT amount", () => {
    // ₱11,200.00 VAT-inclusive
    const result = calculateVatBreakdown(11200, true);
    // base = 11200 / 1.12 = 10000.00
    expect(result.vatExclusive).toBe(10000);
    expect(result.vatAmount).toBe(1200);
  });

  it("should return full amount as VAT-exclusive when non-vatable", () => {
    const result = calculateVatBreakdown(10000, false);
    expect(result.vatExclusive).toBe(10000);
    expect(result.vatAmount).toBe(0);
  });

  it("should handle rounding for non-round amounts", () => {
    // 10000 / 1.12 = 8928.571... → rounds to 8928.57
    const result = calculateVatBreakdown(10000, true);
    expect(result.vatExclusive).toBe(8928.57);
    expect(result.vatAmount).toBe(1071.43);
  });

  it("should handle zero", () => {
    const result = calculateVatBreakdown(0, true);
    expect(result.vatExclusive).toBe(0);
    expect(result.vatAmount).toBe(0);
  });

  // NON-VAT store tests (vatRate = 0)
  it("should return zero VAT when vatRate is 0 (NON-VAT store)", () => {
    // ₱10,000.00, vatable item, but NON-VAT store
    const result = calculateVatBreakdown(10000, true, 0);
    expect(result.vatExclusive).toBe(10000); // No VAT extracted
    expect(result.vatAmount).toBe(0);
  });

  it("should return zero VAT for non-vatable items in NON-VAT store", () => {
    const result = calculateVatBreakdown(10000, false, 0);
    expect(result.vatExclusive).toBe(10000);
    expect(result.vatAmount).toBe(0);
  });
});

describe("calculateScPwdDiscount", () => {
  it("should apply 20% discount on VAT-exclusive price", () => {
    // ₱11,200.00 VAT-inclusive
    // VAT-exclusive = 11200 / 1.12 = 10000.00
    // 20% discount = 2000.00
    // Discounted = 10000.00 - 2000.00 = 8000.00
    const result = calculateScPwdDiscount(11200);
    expect(result.discountedPrice).toBe(8000);
    expect(result.discountAmount).toBe(2000);
    expect(result.vatExemptAmount).toBe(10000);
  });

  it("should handle small amounts with rounding", () => {
    // ₱100.00 → VAT-exclusive = 89.29
    // discount = 17.86
    // discounted = 71.43
    const result = calculateScPwdDiscount(100);
    expect(result.vatExemptAmount).toBe(89.29);
    expect(result.discountAmount).toBe(17.86);
    expect(result.discountedPrice).toBe(71.43);
  });

  // NON-VAT store tests (vatRate = 0)
  it("should apply 20% discount directly to price for NON-VAT store", () => {
    // ₱10,000.00, NON-VAT store
    // 20% discount = 2000.00
    // Discounted = 8000.00
    const result = calculateScPwdDiscount(10000, 0);
    expect(result.discountedPrice).toBe(8000);
    expect(result.discountAmount).toBe(2000);
    expect(result.vatExemptAmount).toBe(0); // No VAT exemption for NON-VAT stores
  });

  it("should handle rounding in NON-VAT store SC/PWD discount", () => {
    // ₱11,200.00, NON-VAT store
    // 20% discount = 2240.00
    // Discounted = 8960.00
    const result = calculateScPwdDiscount(11200, 0);
    expect(result.discountAmount).toBe(2240);
    expect(result.discountedPrice).toBe(8960);
    expect(result.vatExemptAmount).toBe(0);
  });

  it("should keep centavo precision for peso inputs", () => {
    const result = calculateScPwdDiscount(1000, 0.12);
    expect(result.vatExemptAmount).toBe(892.86);
    expect(result.discountAmount).toBe(178.57);
    expect(result.discountedPrice).toBe(714.29);
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

  it("should apply SC/PWD as a direct 20% discount for non-vatable items", () => {
    const result = calculateItemTotals(10000, 1, false, 1);
    expect(result.grossAmount).toBe(10000);
    expect(result.vatableAmount).toBe(0);
    expect(result.vatAmount).toBe(0);
    expect(result.vatExemptAmount).toBe(0);
    expect(result.discountAmount).toBe(2000);
    expect(result.netAmount).toBe(8000);
  });

  it("should normalize whole-number VAT percentages when calculating discounted totals", () => {
    const result = calculateItemTotals(1000, 1, true, 1, 12);
    expect(result.grossAmount).toBe(1000);
    expect(result.vatableAmount).toBe(0);
    expect(result.vatAmount).toBe(0);
    expect(result.vatExemptAmount).toBe(892.86);
    expect(result.discountAmount).toBe(178.57);
    expect(result.netAmount).toBe(714.29);
  });

  // NON-VAT store tests (vatRate = 0)
  it("should calculate totals for NON-VAT store - vatable items become nonVatSales", () => {
    // Vatable item in NON-VAT store
    const result = calculateItemTotals(10000, 2, true, 0, 0);
    expect(result.grossAmount).toBe(20000);
    expect(result.vatableAmount).toBe(0); // No VAT extraction
    expect(result.vatAmount).toBe(0);
    expect(result.nonVatAmount).toBe(20000); // All goes to nonVatSales
    expect(result.vatExemptAmount).toBe(0);
    expect(result.discountAmount).toBe(0);
    expect(result.netAmount).toBe(20000);
  });

  it("should calculate totals for NON-VAT store - non-vatable items", () => {
    const result = calculateItemTotals(5000, 3, false, 0, 0);
    expect(result.grossAmount).toBe(15000);
    expect(result.vatableAmount).toBe(0);
    expect(result.vatAmount).toBe(0);
    expect(result.nonVatAmount).toBe(15000);
    expect(result.netAmount).toBe(15000);
  });

  it("should handle SC/PWD discount in NON-VAT store", () => {
    // 3 items at 10000, 1 SC/PWD, NON-VAT store
    const result = calculateItemTotals(10000, 3, true, 1, 0);
    expect(result.grossAmount).toBe(30000);
    // SC/PWD in NON-VAT: discount = 10000 * 0.2 = 2000, discountedPrice = 8000
    expect(result.discountAmount).toBe(2000);
    expect(result.vatExemptAmount).toBe(0); // No VAT exemption for NON-VAT stores
    // Net = regularGross(2*10000=20000) + scPwdNet(8000) = 28000
    expect(result.netAmount).toBe(28000);
    // nonVatAmount = regularGross only (SC/PWD portion handled separately)
    expect(result.nonVatAmount).toBe(20000);
  });

  it("should handle all SC/PWD quantity in NON-VAT store", () => {
    // 2 items, all 2 are SC/PWD
    const result = calculateItemTotals(10000, 2, true, 2, 0);
    expect(result.grossAmount).toBe(20000);
    // SC/PWD discount = 2000 * 2 = 4000
    expect(result.discountAmount).toBe(4000);
    expect(result.vatExemptAmount).toBe(0);
    // Net = 0 (no regular) + scPwdNet(8000 * 2) = 16000
    expect(result.netAmount).toBe(16000);
    // nonVatAmount = 0 (all quantity is SC/PWD)
    expect(result.nonVatAmount).toBe(0);
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

  // NON-VAT store aggregation test
  it("should aggregate totals correctly for NON-VAT store", () => {
    // All items in NON-VAT store: vatRate = 0
    const items = [
      calculateItemTotals(10000, 2, true, 0, 0), // "vatable" item but NON-VAT store
      calculateItemTotals(5000, 1, false, 0, 0), // non-vatable item
    ];
    const totals = aggregateOrderTotals(items);
    expect(totals.grossSales).toBe(20000 + 5000);
    expect(totals.vatableSales).toBe(0); // No VAT in NON-VAT store
    expect(totals.vatAmount).toBe(0);
    expect(totals.nonVatSales).toBe(20000 + 5000); // Everything is nonVatSales
    expect(totals.netSales).toBe(25000);
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

describe("formatPhpCurrency", () => {
  it("should format a peso amount to PHP currency string", () => {
    const result = formatPhpCurrency(15000);
    expect(result).toContain("15,000.00");
  });

  it("should format zero", () => {
    const result = formatPhpCurrency(0);
    expect(result).toContain("0.00");
  });
});
