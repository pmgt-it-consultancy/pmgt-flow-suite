import { useCallback } from "react";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export const useFormatCurrency = () => {
  const formatCurrency = useCallback((amount: number): string => {
    return currencyFormatter.format(amount);
  }, []);

  return formatCurrency;
};
