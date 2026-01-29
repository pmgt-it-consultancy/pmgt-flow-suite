import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity, View } from "uniwind/components";
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
      <View className="items-center py-6">
        <Text variant="muted" size="sm">
          No active orders
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-2">
      {orders.slice(0, 5).map((order) => (
        <View
          key={order._id}
          className="flex-row items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-gray-100"
        >
          <View className="flex-row items-center gap-2">
            <Badge variant={order.orderType === "dine_in" ? "primary" : "warning"} size="sm">
              {order.orderType === "dine_in" ? "Dine-In" : "Takeout"}
            </Badge>
            <Text className="font-medium text-gray-900 text-sm">{order.orderNumber}</Text>
          </View>
          <View className="flex-row items-center gap-3">
            <Text variant="muted" size="sm">
              {order.itemCount} items
            </Text>
            <Text className="font-semibold text-gray-900 text-sm">
              {formatCurrency(order.subtotal)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
};
