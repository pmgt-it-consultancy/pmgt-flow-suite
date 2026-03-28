import { XStack, YStack } from "tamagui";
import { Badge, Card, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface OrderItem {
  _id: string;
  productName: string;
  isVatable: boolean;
  quantity: number;
  lineTotal: number;
  serviceType?: "dine_in" | "takeout";
}

interface OrderSummaryProps {
  items: OrderItem[];
  orderDefaultServiceType?: "dine_in" | "takeout";
}

export const OrderSummary = ({ items, orderDefaultServiceType }: OrderSummaryProps) => {
  const formatCurrency = useFormatCurrency();
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <YStack paddingHorizontal={16} paddingVertical={12}>
      <XStack justifyContent="space-between" alignItems="center" marginBottom={12}>
        <YStack>
          <Text variant="heading">Order Summary</Text>
          <Text variant="muted" size="xs" style={{ marginTop: 2 }}>
            Review items before taking payment
          </Text>
        </YStack>
        <YStack
          backgroundColor="#FFFFFF"
          borderRadius={999}
          paddingHorizontal={12}
          paddingVertical={6}
          borderWidth={1}
          borderColor="#E5E7EB"
        >
          <Text style={{ color: "#6B7280", fontWeight: "700", fontSize: 12 }}>
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </Text>
        </YStack>
      </XStack>

      <Card variant="outlined">
        {items.map((item, index) => (
          <XStack
            key={item._id}
            justifyContent="space-between"
            alignItems="center"
            paddingVertical={10}
            borderBottomWidth={index === items.length - 1 ? 0 : 1}
            borderColor="#F3F4F6"
          >
            <YStack flex={1} marginRight={12}>
              <XStack alignItems="center" gap={8} flexWrap="wrap">
                <Text style={{ color: "#111827", fontWeight: "600" }}>{item.productName}</Text>
                {!item.isVatable && <Badge variant="warning">NON-VAT</Badge>}
                {(() => {
                  const itemType = item.serviceType ?? orderDefaultServiceType ?? "dine_in";
                  const label = itemType === "takeout" ? "TAKEOUT" : "DINE IN";
                  return (
                    <Badge variant={itemType === "takeout" ? "warning" : "default"}>{label}</Badge>
                  );
                })()}
              </XStack>
              <Text variant="muted" size="xs" style={{ marginTop: 2 }}>
                Qty {item.quantity}
              </Text>
            </YStack>
            <Text style={{ color: "#111827", fontWeight: "600" }}>
              {formatCurrency(item.lineTotal)}
            </Text>
          </XStack>
        ))}
      </Card>
    </YStack>
  );
};
