import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Badge, Text } from "../../shared/components/ui";

interface OrderItem {
  _id: Id<"orders">;
  orderNumber: string;
  orderType: "dine_in" | "takeout";
  status: "open" | "paid" | "voided";
  netSales: number;
  createdAt: number;
  paymentMethod?: "cash" | "card_ewallet";
}

interface OrderSelectionItemProps {
  order: OrderItem;
  isSelected: boolean;
  onToggle: (orderId: Id<"orders">) => void;
  formatCurrency: (amount: number) => string;
}

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const OrderSelectionItem = React.memo(
  ({ order, isSelected, onToggle, formatCurrency }: OrderSelectionItemProps) => {
    const isVoided = order.status === "voided";

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onToggle(order._id)}
        style={[
          styles.container,
          isSelected && styles.containerSelected,
          isVoided && styles.containerVoided,
        ]}
      >
        <XStack alignItems="center" gap={12} flex={1}>
          {/* Checkbox */}
          <Ionicons
            name={isSelected ? "checkbox" : "square-outline"}
            size={24}
            color={isSelected ? "#0D87E1" : "#9CA3AF"}
          />

          {/* Order info */}
          <YStack flex={1} gap={2}>
            <XStack alignItems="center" gap={8}>
              <Text style={styles.orderNumber}>#{order.orderNumber}</Text>
              <Badge variant={order.orderType === "dine_in" ? "default" : "warning"} size="sm">
                {order.orderType === "dine_in" ? "Dine-In" : "Takeout"}
              </Badge>
              {isVoided && (
                <Badge variant="error" size="sm">
                  VOIDED
                </Badge>
              )}
            </XStack>
            <XStack alignItems="center" gap={8}>
              <Text variant="muted" size="xs">
                {formatTime(order.createdAt)}
              </Text>
              {order.paymentMethod && (
                <Text variant="muted" size="xs">
                  {order.paymentMethod === "cash" ? "Cash" : "Card"}
                </Text>
              )}
            </XStack>
          </YStack>

          {/* Amount */}
          <Text style={[styles.amount, isVoided && styles.amountVoided]}>
            {formatCurrency(order.netSales)}
          </Text>
        </XStack>
      </TouchableOpacity>
    );
  },
);

OrderSelectionItem.displayName = "OrderSelectionItem";

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 8,
  },
  containerSelected: {
    backgroundColor: "#EFF6FF",
    borderColor: "#93C5FD",
  },
  containerVoided: {
    opacity: 0.6,
  },
  orderNumber: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  amount: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  amountVoided: {
    textDecorationLine: "line-through",
    color: "#9CA3AF",
  },
});
