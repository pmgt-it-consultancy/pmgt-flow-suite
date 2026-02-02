import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { XStack, YStack } from "tamagui";
import { Badge, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface ActiveOrder {
  _id: Id<"orders">;
  orderNumber: string;
  orderType: "dine_in" | "takeout";
  tableName?: string;
  customerName?: string;
  itemCount: number;
  subtotal: number;
}

interface ActiveOrdersListProps {
  orders: ActiveOrder[];
}

export const ActiveOrdersList = ({ orders }: ActiveOrdersListProps) => {
  const formatCurrency = useFormatCurrency();

  if (orders.length === 0) {
    return (
      <YStack alignItems="center" paddingVertical={24}>
        <Text variant="muted" size="sm">
          No active orders
        </Text>
      </YStack>
    );
  }

  return (
    <YStack gap={8}>
      {orders.slice(0, 5).map((order) => (
        <XStack
          key={order._id}
          alignItems="center"
          justifyContent="space-between"
          backgroundColor="$white"
          borderRadius={8}
          paddingHorizontal={12}
          paddingVertical={10}
          borderWidth={1}
          borderColor="$gray100"
        >
          <XStack alignItems="center" gap={8}>
            <Badge variant={order.orderType === "dine_in" ? "primary" : "warning"} size="sm">
              {order.orderType === "dine_in" ? "Dine-In" : "Takeout"}
            </Badge>
            <Text style={{ fontWeight: "500", color: "#111827", fontSize: 14 }}>
              {order.orderNumber}
            </Text>
          </XStack>
          <XStack alignItems="center" gap={12}>
            <Text variant="muted" size="sm">
              {order.itemCount} items
            </Text>
            <Text style={{ fontWeight: "600", color: "#111827", fontSize: 14 }}>
              {formatCurrency(order.subtotal)}
            </Text>
          </XStack>
        </XStack>
      ))}
    </YStack>
  );
};
