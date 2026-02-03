/**
 * BIR-Compliant Tax Calculations
 *
 * Philippine tax rules:
 * - Standard VAT rate: 12% (NON-VAT stores use 0%)
 * - All prices are VAT-inclusive (for VAT-registered stores)
 * - SC/PWD discounts: 20% on VAT-exclusive price + VAT exemption
 *
 * Amounts are stored in centavos (smallest currency unit) to avoid
 * floating point precision issues.
 */

export const VAT_RATE = 0.12;
export const SC_PWD_DISCOUNT_RATE = 0.2;

/**
 * Calculate VAT breakdown from a VAT-inclusive price
 *
 * For NON-VAT stores (vatRate = 0):
 * - No VAT is extracted from the price
 * - vatAmount is always 0
 * - vatExclusive equals the full price
 */
export function calculateVatBreakdown(
  vatInclusivePrice: number,
  isVatable: boolean,
  vatRate: number = VAT_RATE,
): {
  vatExclusive: number;
  vatAmount: number;
} {
  // If non-vatable item OR zero VAT rate (NON-VAT store), no VAT extraction
  if (!isVatable || vatRate === 0) {
    return {
      vatExclusive: vatInclusivePrice,
      vatAmount: 0,
    };
  }

  // VAT-inclusive formula: price = base + (base * vatRate) = base * (1 + vatRate)
  // So base = price / (1 + vatRate)
  const vatExclusive = Math.round(vatInclusivePrice / (1 + vatRate));
  const vatAmount = vatInclusivePrice - vatExclusive;

  return {
    vatExclusive,
    vatAmount,
  };
}

/**
 * Calculate SC/PWD discount
 * SC/PWD transactions are VAT-EXEMPT (not just discounted)
 * The 20% discount is applied to the VAT-exclusive price
 *
 * For NON-VAT stores (vatRate = 0):
 * - 20% discount is applied directly to the price (no VAT to remove)
 * - vatExemptAmount is 0 (no VAT exemption since there's no VAT)
 */
export function calculateScPwdDiscount(
  vatInclusivePrice: number,
  vatRate: number = VAT_RATE,
): {
  discountedPrice: number;
  discountAmount: number;
  vatExemptAmount: number;
} {
  // For NON-VAT stores, apply 20% discount directly to the price
  if (vatRate === 0) {
    const discountAmount = Math.round(vatInclusivePrice * SC_PWD_DISCOUNT_RATE);
    const discountedPrice = vatInclusivePrice - discountAmount;
    return {
      discountedPrice,
      discountAmount,
      vatExemptAmount: 0, // No VAT exemption for NON-VAT stores
    };
  }

  // Remove VAT first
  const vatExclusive = Math.round(vatInclusivePrice / (1 + vatRate));

  // Apply 20% discount on VAT-exclusive price
  const discountAmount = Math.round(vatExclusive * SC_PWD_DISCOUNT_RATE);
  const discountedPrice = vatExclusive - discountAmount;

  return {
    discountedPrice,
    discountAmount,
    vatExemptAmount: vatExclusive, // Full VAT-exclusive amount is VAT-exempt
  };
}

/**
 * Order item calculation result
 */
export interface ItemCalculation {
  grossAmount: number; // VAT-inclusive total before discounts
  vatableAmount: number; // Amount subject to VAT
  vatAmount: number; // VAT portion
  vatExemptAmount: number; // VAT-exempt amount (from SC/PWD)
  nonVatAmount: number; // Non-vatable items
  discountAmount: number; // Total discounts
  netAmount: number; // Final amount to collect
}

/**
 * Calculate item totals
 *
 * For NON-VAT stores (vatRate = 0):
 * - grossSales = price * quantity (same as VAT stores)
 * - vatableSales = 0 (no VAT extraction)
 * - vatAmount = 0
 * - nonVatSales = grossSales (all sales are non-VAT)
 * - SC/PWD discount: 20% of price, vatExemptAmount = 0
 */
export function calculateItemTotals(
  unitPrice: number,
  quantity: number,
  isVatable: boolean,
  scPwdQuantity: number = 0,
  vatRate: number = VAT_RATE,
): ItemCalculation {
  const grossAmount = unitPrice * quantity;
  const regularQuantity = quantity - scPwdQuantity;

  // Calculate regular (non-discounted) portion
  const regularGross = unitPrice * regularQuantity;

  // For NON-VAT stores (vatRate = 0), treat all items as non-vatable for VAT purposes
  const effectivelyVatable = isVatable && vatRate > 0;
  const regularVat = effectivelyVatable
    ? calculateVatBreakdown(regularGross, true, vatRate)
    : { vatExclusive: regularGross, vatAmount: 0 };

  // Calculate SC/PWD portion
  let _scPwdGross = 0;
  let scPwdDiscount = 0;
  let scPwdVatExempt = 0;
  let scPwdNet = 0;

  if (scPwdQuantity > 0) {
    _scPwdGross = unitPrice * scPwdQuantity;
    const scPwd = calculateScPwdDiscount(unitPrice, vatRate);
    scPwdDiscount = scPwd.discountAmount * scPwdQuantity;
    scPwdVatExempt = scPwd.vatExemptAmount * scPwdQuantity;
    scPwdNet = scPwd.discountedPrice * scPwdQuantity;
  }

  // Combine calculations
  // For NON-VAT stores: vatable items go to nonVatAmount, not vatableAmount
  const vatableAmount = effectivelyVatable ? regularVat.vatExclusive : 0;
  const vatAmount = effectivelyVatable ? regularVat.vatAmount : 0;
  // nonVatAmount includes: (1) non-vatable items, (2) all items for NON-VAT stores
  const nonVatAmount = !effectivelyVatable ? regularGross : 0;
  const vatExemptAmount = scPwdVatExempt;
  const discountAmount = scPwdDiscount;

  // Net = regular portion + SC/PWD discounted portion
  const regularNet = regularGross;
  const netAmount = regularNet + scPwdNet;

  return {
    grossAmount,
    vatableAmount,
    vatAmount,
    vatExemptAmount,
    nonVatAmount,
    discountAmount,
    netAmount,
  };
}

/**
 * Order totals calculation result
 */
export interface OrderTotals {
  grossSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  nonVatSales: number;
  discountAmount: number;
  netSales: number;
}

/**
 * Aggregate order totals from multiple items
 */
export function aggregateOrderTotals(items: ItemCalculation[]): OrderTotals {
  return items.reduce(
    (totals, item) => ({
      grossSales: totals.grossSales + item.grossAmount,
      vatableSales: totals.vatableSales + item.vatableAmount,
      vatAmount: totals.vatAmount + item.vatAmount,
      vatExemptSales: totals.vatExemptSales + item.vatExemptAmount,
      nonVatSales: totals.nonVatSales + item.nonVatAmount,
      discountAmount: totals.discountAmount + item.discountAmount,
      netSales: totals.netSales + item.netAmount,
    }),
    {
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
    },
  );
}

/**
 * Calculate change for cash payment
 */
export function calculateChange(netSales: number, cashReceived: number): number {
  return cashReceived - netSales;
}

/**
 * Format amount from centavos to peso string
 */
export function formatPeso(centavos: number): string {
  const pesos = centavos / 100;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(pesos);
}
