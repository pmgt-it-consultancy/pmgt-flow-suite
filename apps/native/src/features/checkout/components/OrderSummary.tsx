import { XStack, YStack } from "tamagui";
import { Card, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface OrderItem {
  _id: string;
  productName: string;
  quantity: number;
  lineTotal: number;
}

interface OrderSummaryProps {
  items: OrderItem[];
}

export const OrderSummary = ({ items }: OrderSummaryProps) => {
  const formatCurrency = useFormatCurrency();

  return (
    <YStack paddingHorizontal={16} paddingVertical={12}>
      <Text variant="heading" style={{ marginBottom: 12 }}>
        Order Summary
      </Text>
      <Card variant="elevated">
        {items.map((item) => (
          <XStack
            key={item._id}
            justifyContent="space-between"
            paddingVertical={8}
            borderBottomWidth={1}
            borderColor="#F3F4F6"
          >
            <Text style={{ color: "#374151", flex: 1 }}>
              {item.quantity}x {item.productName}
            </Text>
            <Text style={{ color: "#111827", fontWeight: "500" }}>
              {formatCurrency(item.lineTotal)}
            </Text>
          </XStack>
        ))}
      </Card>
    </YStack>
  );
};
