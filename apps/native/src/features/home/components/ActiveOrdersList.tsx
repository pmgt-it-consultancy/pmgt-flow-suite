import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { ScrollView } from "react-native";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface ActiveOrder {
  _id: Id<"orders">;
  orderNumber: string;
  orderType: "dine_in" | "takeout";
  tableName?: string;
  customerName?: string;
  itemCount: number;
  subtotal: number;
  createdAt: number;
}

interface ActiveOrdersListProps {
  orders: ActiveOrder[];
}

function getTimeAgo(createdAt: number): string {
  const diffMs = Date.now() - createdAt;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const ORDER_STYLES = {
  dine_in: {
    borderColor: "#0D87E1",
    iconBg: "#EFF6FF",
    iconColor: "#0D87E1",
    icon: "restaurant-outline" as const,
    label: "Dine-In",
    labelColor: "#1D4ED8",
    labelBg: "#DBEAFE",
  },
  takeout: {
    borderColor: "#EA580C",
    iconBg: "#FFF7ED",
    iconColor: "#EA580C",
    icon: "bag-handle-outline" as const,
    label: "Takeout",
    labelColor: "#C2410C",
    labelBg: "#FFEDD5",
  },
};

export const ActiveOrdersList = ({ orders }: ActiveOrdersListProps) => {
  const formatCurrency = useFormatCurrency();

  if (orders.length === 0) {
    return (
      <YStack flex={1} alignItems="center" justifyContent="center" gap={8} padding={24}>
        <YStack
          backgroundColor="#F8FAFC"
          borderRadius={16}
          width={56}
          height={56}
          alignItems="center"
          justifyContent="center"
        >
          <Ionicons name="receipt-outline" size={26} color="#CBD5E1" />
        </YStack>
        <Text style={{ color: "#94A3B8", fontSize: 14, fontWeight: "500" }}>No active orders</Text>
      </YStack>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 12, gap: 8 }}
      showsVerticalScrollIndicator={false}
    >
      {orders.map((order) => {
        const style = ORDER_STYLES[order.orderType];
        const timeAgo = getTimeAgo(order.createdAt);

        return (
          <XStack
            key={order._id}
            backgroundColor="#FFFFFF"
            borderRadius={12}
            borderLeftWidth={4}
            borderLeftColor={style.borderColor}
            borderWidth={1}
            borderColor="#F1F5F9"
            paddingVertical={12}
            paddingLeft={14}
            paddingRight={16}
            alignItems="center"
            gap={12}
          >
            {/* Icon */}
            <YStack
              backgroundColor={style.iconBg}
              borderRadius={10}
              width={38}
              height={38}
              alignItems="center"
              justifyContent="center"
            >
              <Ionicons name={style.icon} size={18} color={style.iconColor} />
            </YStack>

            {/* Order Info */}
            <YStack flex={1} gap={3}>
              <XStack alignItems="center" gap={8}>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "700",
                    color: "#0F172A",
                    letterSpacing: -0.2,
                  }}
                >
                  {order.orderNumber}
                </Text>
                <XStack
                  backgroundColor={style.labelBg}
                  borderRadius={4}
                  paddingHorizontal={6}
                  paddingVertical={1}
                >
                  <Text style={{ fontSize: 11, fontWeight: "600", color: style.labelColor }}>
                    {style.label}
                  </Text>
                </XStack>
              </XStack>
              <XStack alignItems="center" gap={6}>
                <Text style={{ fontSize: 13, color: "#94A3B8", fontWeight: "500" }}>
                  {order.itemCount} {order.itemCount === 1 ? "item" : "items"}
                </Text>
                <Text style={{ fontSize: 13, color: "#CBD5E1" }}>&middot;</Text>
                <Text style={{ fontSize: 13, color: "#94A3B8", fontWeight: "500" }}>{timeAgo}</Text>
              </XStack>
            </YStack>

            {/* Amount */}
            <Text
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: "#0F172A",
                letterSpacing: -0.2,
              }}
            >
              {formatCurrency(order.subtotal)}
            </Text>
          </XStack>
        );
      })}
    </ScrollView>
  );
};
