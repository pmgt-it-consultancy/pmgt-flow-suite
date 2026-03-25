import { XStack, YStack } from "tamagui";
import { Card, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface ProductSaleItem {
  productId: string;
  productName: string;
  categoryName: string;
  quantitySold: number;
  grossAmount: number;
  voidedQuantity: number;
  voidedAmount: number;
}

interface ItemBreakdownCardProps {
  productSales: ProductSaleItem[] | undefined;
  isLoading: boolean;
}

export const ItemBreakdownCard = ({ productSales, isLoading }: ItemBreakdownCardProps) => {
  const formatCurrency = useFormatCurrency();

  if (isLoading) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <Text variant="muted">Loading item breakdown...</Text>
      </Card>
    );
  }

  if (!productSales || productSales.length === 0) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <Text variant="muted">No items sold for this date.</Text>
      </Card>
    );
  }

  const sorted = [...productSales].sort((a, b) => b.quantitySold - a.quantitySold);
  const totalQty = sorted.reduce((sum, item) => sum + item.quantitySold, 0);
  const totalAmount = sorted.reduce((sum, item) => sum + item.grossAmount, 0);

  return (
    <YStack gap={8}>
      <XStack justifyContent="space-between" alignItems="center">
        <Text variant="heading" size="base">
          Items Sold
        </Text>
        <Text variant="muted" size="sm">
          {sorted.length} product(s)
        </Text>
      </XStack>

      <YStack
        backgroundColor="$white"
        borderRadius={12}
        borderWidth={1}
        borderColor="$gray200"
        overflow="hidden"
      >
        {/* Header row */}
        <XStack
          paddingVertical={10}
          paddingHorizontal={14}
          backgroundColor="#F9FAFB"
          borderBottomWidth={1}
          borderColor="$gray200"
        >
          <Text variant="muted" size="sm" style={{ flex: 1 }}>
            Product
          </Text>
          <Text variant="muted" size="sm" style={{ width: 50, textAlign: "right" }}>
            Qty
          </Text>
          <Text variant="muted" size="sm" style={{ width: 90, textAlign: "right" }}>
            Amount
          </Text>
        </XStack>

        {/* Product rows — plain .map(), NOT FlatList */}
        {sorted.map((item) => (
          <YStack key={item.productId}>
            <XStack
              paddingVertical={10}
              paddingHorizontal={14}
              borderBottomWidth={1}
              borderColor="#F3F4F6"
              alignItems="center"
            >
              <YStack style={{ flex: 1 }}>
                <Text size="sm" style={{ fontWeight: "500" }}>
                  {item.productName}
                </Text>
                <Text variant="muted" size="xs">
                  {item.categoryName}
                </Text>
              </YStack>
              <Text size="sm" style={{ width: 50, textAlign: "right", fontWeight: "600" }}>
                {item.quantitySold}
              </Text>
              <Text size="sm" style={{ width: 90, textAlign: "right", fontWeight: "600" }}>
                {formatCurrency(item.grossAmount)}
              </Text>
            </XStack>

            {/* Voided info row */}
            {item.voidedQuantity > 0 && (
              <XStack
                paddingVertical={6}
                paddingHorizontal={14}
                backgroundColor="#FEF2F2"
                borderBottomWidth={1}
                borderColor="#F3F4F6"
              >
                <Text size="xs" style={{ flex: 1, color: "#DC2626" }}>
                  Voided
                </Text>
                <Text size="xs" style={{ width: 50, textAlign: "right", color: "#DC2626" }}>
                  {item.voidedQuantity}
                </Text>
                <Text size="xs" style={{ width: 90, textAlign: "right", color: "#DC2626" }}>
                  -{formatCurrency(item.voidedAmount)}
                </Text>
              </XStack>
            )}
          </YStack>
        ))}

        {/* Totals row */}
        <XStack
          paddingVertical={12}
          paddingHorizontal={14}
          backgroundColor="#F9FAFB"
          borderTopWidth={1}
          borderColor="$gray200"
        >
          <Text size="sm" style={{ flex: 1, fontWeight: "700" }}>
            Total
          </Text>
          <Text size="sm" style={{ width: 50, textAlign: "right", fontWeight: "700" }}>
            {totalQty}
          </Text>
          <Text size="sm" style={{ width: 90, textAlign: "right", fontWeight: "700" }}>
            {formatCurrency(totalAmount)}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
};
