import React from "react";
import { View } from "uniwind/components";
import { Text, Card, Separator } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface TotalsSummaryProps {
  grossSales: number;
  vatAmount: number;
  discountAmount: number;
  netSales: number;
  change?: number;
  showChange?: boolean;
}

export const TotalsSummary = ({
  grossSales,
  vatAmount,
  discountAmount,
  netSales,
  change = 0,
  showChange = false,
}: TotalsSummaryProps) => {
  const formatCurrency = useFormatCurrency();

  return (
    <View className="px-4 py-3">
      <Card variant="elevated">
        <View className="flex-row justify-between py-2">
          <Text variant="muted">Gross Sales</Text>
          <Text className="text-gray-900 font-medium">
            {formatCurrency(grossSales)}
          </Text>
        </View>

        <View className="flex-row justify-between py-2">
          <Text variant="muted">VAT (12%)</Text>
          <Text className="text-gray-900 font-medium">
            {formatCurrency(vatAmount)}
          </Text>
        </View>

        {discountAmount > 0 && (
          <View className="flex-row justify-between py-2">
            <Text className="text-green-500">Discount</Text>
            <Text className="text-green-500 font-medium">
              -{formatCurrency(discountAmount)}
            </Text>
          </View>
        )}

        <Separator className="my-2" />

        <View className="flex-row justify-between py-2">
          <Text variant="heading" size="lg">
            Total Due
          </Text>
          <Text className="text-blue-500 font-bold text-xl">
            {formatCurrency(netSales)}
          </Text>
        </View>

        {showChange && (
          <View className="flex-row justify-between py-2">
            <Text className="text-green-500 font-medium text-base">
              Change
            </Text>
            <Text className="text-green-500 font-bold text-lg">
              {formatCurrency(change)}
            </Text>
          </View>
        )}
      </Card>
    </View>
  );
};
