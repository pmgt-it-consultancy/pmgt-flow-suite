import { XStack, YStack } from "tamagui";
import { Card, Separator, Text } from "../../shared/components/ui";
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
    <YStack paddingHorizontal={16} paddingVertical={12}>
      <Card variant="elevated">
        <XStack justifyContent="space-between" paddingVertical={8}>
          <Text variant="muted">Gross Sales</Text>
          <Text style={{ color: "#111827", fontWeight: "500" }}>{formatCurrency(grossSales)}</Text>
        </XStack>

        <XStack justifyContent="space-between" paddingVertical={8}>
          <Text variant="muted">VAT (12%)</Text>
          <Text style={{ color: "#111827", fontWeight: "500" }}>{formatCurrency(vatAmount)}</Text>
        </XStack>

        {discountAmount > 0 && (
          <XStack justifyContent="space-between" paddingVertical={8}>
            <Text style={{ color: "#22C55E" }}>Discount</Text>
            <Text style={{ color: "#22C55E", fontWeight: "500" }}>
              -{formatCurrency(discountAmount)}
            </Text>
          </XStack>
        )}

        <Separator style={{ marginVertical: 8 }} />

        <XStack justifyContent="space-between" paddingVertical={8}>
          <Text variant="heading" size="lg">
            Total Due
          </Text>
          <Text style={{ color: "#0D87E1", fontWeight: "700", fontSize: 20 }}>
            {formatCurrency(netSales)}
          </Text>
        </XStack>

        {showChange && (
          <XStack justifyContent="space-between" paddingVertical={8}>
            <Text style={{ color: "#22C55E", fontWeight: "500", fontSize: 16 }}>Change</Text>
            <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 18 }}>
              {formatCurrency(change)}
            </Text>
          </XStack>
        )}
      </Card>
    </YStack>
  );
};
