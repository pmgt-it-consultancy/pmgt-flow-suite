/**
 * BIR-Compliant Tax Calculations
 *
 * Philippine tax rules:
 * - Standard VAT rate: 12%
 * - All prices are VAT-inclusive
 * - SC/PWD discounts: 20% on VAT-exclusive price + VAT exemption
 *
 * Amounts are stored in centavos (smallest currency unit) to avoid
 * floating point precision issues.
 */

export const VAT_RATE = 0.12;
export const SC_PWD_DISCOUNT_RATE = 0.20;

/**
 * Calculate VAT breakdown from a VAT-inclusive price
 */
export function calculateVatBreakdown(
  vatInclusivePrice: number,
  isVatable: boolean
): {
  vatExclusive: number;
  vatAmount: number;
} {
  if (!isVatable) {
    return {
      vatExclusive: vatInclusivePrice,
      vatAmount: 0,
    };
  }

  // VAT-inclusive formula: price = base + (base * 0.12) = base * 1.12
  // So base = price / 1.12
  const vatExclusive = Math.round(vatInclusivePrice / (1 + VAT_RATE));
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
 */
export function calculateScPwdDiscount(vatInclusivePrice: number): {
  discountedPrice: number;
  discountAmount: number;
  vatExemptAmount: number;
} {
  // Remove VAT first
  const vatExclusive = Math.round(vatInclusivePrice / (1 + VAT_RATE));

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
 */
export function calculateItemTotals(
  unitPrice: number,
  quantity: number,
  isVatable: boolean,
  scPwdQuantity: number = 0
): ItemCalculation {
  const grossAmount = unitPrice * quantity;
  const regularQuantity = quantity - scPwdQuantity;

  // Calculate regular (non-discounted) portion
  const regularGross = unitPrice * regularQuantity;
  const regularVat = isVatable ? calculateVatBreakdown(regularGross, true) : { vatExclusive: regularGross, vatAmount: 0 };

  // Calculate SC/PWD portion
  let scPwdGross = 0;
  let scPwdDiscount = 0;
  let scPwdVatExempt = 0;
  let scPwdNet = 0;

  if (scPwdQuantity > 0) {
    scPwdGross = unitPrice * scPwdQuantity;
    const scPwd = calculateScPwdDiscount(unitPrice);
    scPwdDiscount = scPwd.discountAmount * scPwdQuantity;
    scPwdVatExempt = scPwd.vatExemptAmount * scPwdQuantity;
    scPwdNet = scPwd.discountedPrice * scPwdQuantity;
  }

  // Combine calculations
  const vatableAmount = isVatable ? regularVat.vatExclusive : 0;
  const vatAmount = isVatable ? regularVat.vatAmount : 0;
  const nonVatAmount = !isVatable ? regularGross : 0;
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
export function aggregateOrderTotals(
  items: ItemCalculation[]
): OrderTotals {
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
    }
  );
}

/**
 * Calculate change for cash payment
 */
export function calculateChange(
  netSales: number,
  cashReceived: number
): number {
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
