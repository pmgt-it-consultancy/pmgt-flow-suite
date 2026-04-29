import { Ionicons } from "@expo/vector-icons";
import { memo, useCallback } from "react";
import { FlatList } from "react-native";
import { XStack, YStack } from "tamagui";
import type { ActiveOrderSummary } from "../../../sync";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface ActiveOrdersListProps {
  orders: readonly ActiveOrderSummary[];
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
    borderColor: "#BFDBFE",
    stripe: "#0D87E1",
    iconBg: "#E8F3FE",
    iconColor: "#0D87E1",
    icon: "restaurant-outline" as const,
    label: "Dine-In",
    labelColor: "#1D4ED8",
    labelBg: "#DBEAFE",
  },
  takeout: {
    borderColor: "#FED7AA",
    stripe: "#EA580C",
    iconBg: "#FFF1E7",
    iconColor: "#EA580C",
    icon: "bag-handle-outline" as const,
    label: "Takeout",
    labelColor: "#C2410C",
    labelBg: "#FFEDD5",
  },
};

const ActiveOrderItem = memo(({ order }: { order: ActiveOrderSummary }) => {
  const formatCurrency = useFormatCurrency();
  const style = ORDER_STYLES[order.orderType];
  const timeAgo = getTimeAgo(order.createdAt);
  const destination =
    order.orderType === "dine_in"
      ? order.tableName || "Dining floor"
      : order.customerName || "Takeout queue";

  return (
    <XStack
      backgroundColor="#FFFFFF"
      borderRadius={16}
      borderWidth={1}
      borderColor={style.borderColor}
      overflow="hidden"
      alignItems="stretch"
    >
      <YStack width={6} backgroundColor={style.stripe} />

      <XStack
        flex={1}
        paddingVertical={14}
        paddingLeft={14}
        paddingRight={16}
        gap={12}
        alignItems="center"
      >
        <YStack
          backgroundColor={style.iconBg}
          borderRadius={14}
          width={46}
          height={46}
          alignItems="center"
          justifyContent="center"
        >
          <Ionicons name={style.icon} size={20} color={style.iconColor} />
        </YStack>

        <YStack flex={1} gap={7}>
          <XStack justifyContent="space-between" alignItems="center">
            <XStack alignItems="center" gap={8}>
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 17,
                  fontWeight: "800",
                  color: "#0F172A",
                  letterSpacing: -0.3,
                }}
              >
                {order.orderNumber}
              </Text>
              <XStack
                backgroundColor={style.labelBg}
                borderRadius={999}
                paddingHorizontal={8}
                paddingVertical={3}
              >
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 11, fontWeight: "700", color: style.labelColor }}
                >
                  {style.label}
                </Text>
              </XStack>
            </XStack>

            <Text
              numberOfLines={1}
              style={{
                fontSize: 17,
                fontWeight: "800",
                color: "#0F172A",
                letterSpacing: -0.3,
              }}
            >
              {formatCurrency(order.subtotal)}
            </Text>
          </XStack>

          <XStack alignItems="center" justifyContent="space-between">
            <YStack gap={3}>
              <Text numberOfLines={1} style={{ fontSize: 13, color: "#475569", fontWeight: "700" }}>
                {destination}
              </Text>
              <XStack alignItems="center" gap={7} flexWrap="nowrap">
                <MetricPill
                  icon="cube-outline"
                  label={`${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}`}
                />
                <MetricPill icon="time-outline" label={timeAgo} />
              </XStack>
            </YStack>

            <YStack
              backgroundColor="#F8FBFD"
              borderRadius={12}
              paddingHorizontal={10}
              paddingVertical={8}
              alignItems="center"
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 10,
                  fontWeight: "700",
                  color: "#94A3B8",
                  textTransform: "uppercase",
                }}
              >
                Status
              </Text>
              <Text
                numberOfLines={1}
                style={{ fontSize: 13, fontWeight: "800", color: "#334155", marginTop: 2 }}
              >
                Open
              </Text>
            </YStack>
          </XStack>
        </YStack>
      </XStack>
    </XStack>
  );
});

const emptyComponent = (
  <YStack flex={1} alignItems="center" justifyContent="center" gap={10} padding={24}>
    <YStack
      backgroundColor="#F8FBFD"
      borderRadius={20}
      width={64}
      height={64}
      alignItems="center"
      justifyContent="center"
    >
      <Ionicons name="receipt-outline" size={28} color="#B6C3D1" />
    </YStack>
    <Text numberOfLines={1} style={{ color: "#5F7387", fontSize: 16, fontWeight: "700" }}>
      No active orders
    </Text>
    <Text numberOfLines={1} style={{ color: "#94A3B8", fontSize: 13, fontWeight: "500" }}>
      New tickets will appear here as soon as service starts moving.
    </Text>
  </YStack>
);

export const ActiveOrdersList = ({ orders }: ActiveOrdersListProps) => {
  const renderItem = useCallback(
    ({ item }: { item: ActiveOrderSummary }) => <ActiveOrderItem order={item} />,
    [],
  );

  const keyExtractor = useCallback((item: ActiveOrderSummary) => item._id, []);

  return (
    <FlatList
      data={orders}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={{ padding: 14, gap: 10 }}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={emptyComponent}
    />
  );
};

function MetricPill({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <XStack
      backgroundColor="#F8FBFD"
      borderRadius={999}
      paddingHorizontal={8}
      paddingVertical={4}
      alignItems="center"
      gap={5}
    >
      <Ionicons name={icon} size={12} color="#64748B" />
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: "#64748B" }}>
        {label}
      </Text>
    </XStack>
  );
}
