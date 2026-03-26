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

interface CategoryGroup {
  categoryName: string;
  items: ProductSaleItem[];
  subtotalQty: number;
  subtotalAmount: number;
}

interface ItemBreakdownCardProps {
  productSales: ProductSaleItem[] | undefined;
  isLoading: boolean;
}

function groupByCategory(productSales: ProductSaleItem[]): CategoryGroup[] {
  const map = new Map<string, ProductSaleItem[]>();

  for (const item of productSales) {
    const key = item.categoryName;
    const existing = map.get(key);
    if (existing) {
      existing.push(item);
    } else {
      map.set(key, [item]);
    }
  }

  const groups: CategoryGroup[] = [];
  for (const [categoryName, items] of map.entries()) {
    const sortedItems = [...items].sort((a, b) => b.quantitySold - a.quantitySold);
    const subtotalQty = sortedItems.reduce((sum, item) => sum + item.quantitySold, 0);
    const subtotalAmount = sortedItems.reduce((sum, item) => sum + item.grossAmount, 0);
    groups.push({ categoryName, items: sortedItems, subtotalQty, subtotalAmount });
  }

  return groups.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
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

  const groups = groupByCategory(productSales);
  const totalQty = productSales.reduce((sum, item) => sum + item.quantitySold, 0);
  const totalAmount = productSales.reduce((sum, item) => sum + item.grossAmount, 0);

  return (
    <YStack gap={8}>
      <XStack justifyContent="space-between" alignItems="center">
        <Text variant="heading" size="base">
          Items Sold
        </Text>
        <Text variant="muted" size="sm">
          {productSales.length} product(s)
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

        {/* Category groups — plain .map(), NOT FlatList */}
        {groups.map((group) => (
          <YStack key={group.categoryName}>
            {/* Category header */}
            <XStack
              paddingVertical={8}
              paddingHorizontal={14}
              backgroundColor="#EFF6FF"
              borderBottomWidth={1}
              borderColor="$gray200"
            >
              <Text size="sm" style={{ flex: 1, fontWeight: "700", color: "#1E40AF" }}>
                {group.categoryName}
              </Text>
            </XStack>

            {/* Product rows within category */}
            {group.items.map((item) => (
              <YStack key={item.productId}>
                <XStack
                  paddingVertical={10}
                  paddingHorizontal={14}
                  borderBottomWidth={1}
                  borderColor="#F3F4F6"
                  alignItems="center"
                >
                  <Text size="sm" style={{ flex: 1, fontWeight: "500" }}>
                    {item.productName}
                  </Text>
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

            {/* Category subtotal row */}
            <XStack
              paddingVertical={8}
              paddingHorizontal={14}
              backgroundColor="#F0F9FF"
              borderBottomWidth={1}
              borderColor="$gray200"
            >
              <Text size="xs" style={{ flex: 1, fontWeight: "600", color: "#0369A1" }}>
                {group.categoryName} Subtotal
              </Text>
              <Text
                size="xs"
                style={{ width: 50, textAlign: "right", fontWeight: "600", color: "#0369A1" }}
              >
                {group.subtotalQty}
              </Text>
              <Text
                size="xs"
                style={{ width: 90, textAlign: "right", fontWeight: "600", color: "#0369A1" }}
              >
                {formatCurrency(group.subtotalAmount)}
              </Text>
            </XStack>
          </YStack>
        ))}

        {/* Grand total row */}
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
