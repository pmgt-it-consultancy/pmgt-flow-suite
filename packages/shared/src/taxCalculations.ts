/**
 * BIR-Compliant Tax Calculations
 *
 * Philippine tax rules:
 * - Standard VAT rate: 12% (NON-VAT stores use 0%)
 * - All prices are VAT-inclusive (for VAT-registered stores)
 * - SC/PWD discounts: 20% on VAT-exclusive price + VAT exemption
 *
 * Amounts are stored as peso values and rounded to centavo precision
 * whenever tax or discount calculations produce fractions.
 */

export const VAT_RATE = 0.12;
export const SC_PWD_DISCOUNT_RATE = 0.2;

function normalizeVatRate(vatRate: number): number {
  if (vatRate <= 0) return 0;
  return vatRate > 1 ? vatRate / 100 : vatRate;
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function calculateVatBreakdown(
  vatInclusivePrice: number,
  isVatable: boolean,
  vatRate: number = VAT_RATE,
): {
  vatExclusive: number;
  vatAmount: number;
} {
  const normalizedVatRate = normalizeVatRate(vatRate);

  if (!isVatable || normalizedVatRate === 0) {
    return {
      vatExclusive: vatInclusivePrice,
      vatAmount: 0,
    };
  }

  const vatExclusive = roundMoney(vatInclusivePrice / (1 + normalizedVatRate));
  const vatAmount = roundMoney(vatInclusivePrice - vatExclusive);

  return {
    vatExclusive,
    vatAmount,
  };
}

export function calculateScPwdDiscount(
  vatInclusivePrice: number,
  vatRate: number = VAT_RATE,
): {
  discountedPrice: number;
  discountAmount: number;
  vatExemptAmount: number;
} {
  const normalizedVatRate = normalizeVatRate(vatRate);

  if (normalizedVatRate === 0) {
    const discountAmount = roundMoney(vatInclusivePrice * SC_PWD_DISCOUNT_RATE);
    const discountedPrice = roundMoney(vatInclusivePrice - discountAmount);
    return {
      discountedPrice,
      discountAmount,
      vatExemptAmount: 0,
    };
  }

  const vatExclusive = roundMoney(vatInclusivePrice / (1 + normalizedVatRate));

  const discountAmount = roundMoney(vatExclusive * SC_PWD_DISCOUNT_RATE);
  const discountedPrice = roundMoney(vatExclusive - discountAmount);

  return {
    discountedPrice,
    discountAmount,
    vatExemptAmount: vatExclusive,
  };
}

export interface ItemCalculation {
  grossAmount: number;
  vatableAmount: number;
  vatAmount: number;
  vatExemptAmount: number;
  nonVatAmount: number;
  discountAmount: number;
  netAmount: number;
}

export function calculateItemTotals(
  unitPrice: number,
  quantity: number,
  isVatable: boolean,
  scPwdQuantity: number = 0,
  vatRate: number = VAT_RATE,
): ItemCalculation {
  const normalizedVatRate = normalizeVatRate(vatRate);
  const grossAmount = roundMoney(unitPrice * quantity);
  const regularQuantity = quantity - scPwdQuantity;

  const regularGross = roundMoney(unitPrice * regularQuantity);

  const effectivelyVatable = isVatable && normalizedVatRate > 0;
  const regularVat = effectivelyVatable
    ? calculateVatBreakdown(regularGross, true, normalizedVatRate)
    : { vatExclusive: regularGross, vatAmount: 0 };

  let _scPwdGross = 0;
  let scPwdDiscount = 0;
  let scPwdVatExempt = 0;
  let scPwdNet = 0;

  if (scPwdQuantity > 0) {
    _scPwdGross = unitPrice * scPwdQuantity;
    const scPwd = calculateScPwdDiscount(unitPrice, isVatable ? normalizedVatRate : 0);
    scPwdDiscount = roundMoney(scPwd.discountAmount * scPwdQuantity);
    scPwdVatExempt = roundMoney(scPwd.vatExemptAmount * scPwdQuantity);
    scPwdNet = roundMoney(scPwd.discountedPrice * scPwdQuantity);
  }

  const vatableAmount = effectivelyVatable ? regularVat.vatExclusive : 0;
  const vatAmount = effectivelyVatable ? regularVat.vatAmount : 0;
  const nonVatAmount = !effectivelyVatable ? regularGross : 0;
  const vatExemptAmount = scPwdVatExempt;
  const discountAmount = scPwdDiscount;

  const regularNet = roundMoney(regularGross);
  const netAmount = roundMoney(regularNet + scPwdNet);

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

export interface OrderTotals {
  grossSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  nonVatSales: number;
  discountAmount: number;
  netSales: number;
}

export function aggregateOrderTotals(items: ItemCalculation[]): OrderTotals {
  return items.reduce(
    (totals, item) => ({
      grossSales: roundMoney(totals.grossSales + item.grossAmount),
      vatableSales: roundMoney(totals.vatableSales + item.vatableAmount),
      vatAmount: roundMoney(totals.vatAmount + item.vatAmount),
      vatExemptSales: roundMoney(totals.vatExemptSales + item.vatExemptAmount),
      nonVatSales: roundMoney(totals.nonVatSales + item.nonVatAmount),
      discountAmount: roundMoney(totals.discountAmount + item.discountAmount),
      netSales: roundMoney(totals.netSales + item.netAmount),
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

export function calculateChange(netSales: number, cashReceived: number): number {
  return roundMoney(cashReceived - netSales);
}

export function formatPhpCurrency(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);
}
