import { useCallback } from "react";

export const useFormatCurrency = () => {
  const formatCurrency = useCallback((amount: number): string => {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      minimumFractionDigits: 2,
    }).format(amount);
  }, []);

  return formatCurrency;
};
