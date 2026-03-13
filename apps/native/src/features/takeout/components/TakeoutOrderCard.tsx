import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Badge, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

type TakeoutStatus = "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";

interface TakeoutOrderCardProps {
  id: Id<"orders">;
  orderNumber: string;
  customerName?: string;
  orderStatus?: "open" | "paid" | "voided";
  takeoutStatus?: TakeoutStatus;
  netSales: number;
  itemCount: number;
  createdAt: number;
  onAdvanceStatus: (orderId: Id<"orders">, currentStatus: TakeoutStatus) => void;
  onPress?: (orderId: Id<"orders">) => void;
}

const statusConfig: Record<
  TakeoutStatus,
  {
    label: string;
    variant: "warning" | "primary" | "success" | "default" | "error";
    nextLabel?: string;
    nextIcon?: keyof typeof Ionicons.glyphMap;
    buttonColor?: string;
  }
> = {
  pending: {
    label: "Pending",
    variant: "warning",
    nextLabel: "Start Preparing",
    nextIcon: "restaurant-outline",
    buttonColor: "#0D87E1",
  },
  preparing: {
    label: "Preparing",
    variant: "primary",
    nextLabel: "Ready for Pickup",
    nextIcon: "checkmark-circle-outline",
    buttonColor: "#22C55E",
  },
  ready_for_pickup: {
    label: "Ready",
    variant: "success",
    nextLabel: "Complete",
    nextIcon: "checkmark-done-outline",
    buttonColor: "#22C55E",
  },
  completed: { label: "Completed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "error" },
};

export const TakeoutOrderCard = ({
  id,
  orderNumber,
  customerName,
  orderStatus,
  takeoutStatus = "pending",
  netSales,
  itemCount,
  createdAt,
  onAdvanceStatus,
  onPress,
}: TakeoutOrderCardProps) => {
  const formatCurrency = useFormatCurrency();
  const isVoided = orderStatus === "voided";
  const config = isVoided ? statusConfig.cancelled : statusConfig[takeoutStatus];
  const time = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <TouchableOpacity
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: "#F3F4F6",
        marginBottom: 12,
      }}
      activeOpacity={0.7}
      onPress={() => onPress?.(id)}
    >
      <XStack justifyContent="space-between" alignItems="flex-start" marginBottom={10}>
        <YStack>
          <Text style={{ fontWeight: "700", color: "#111827", fontSize: 18 }}>{orderNumber}</Text>
          {customerName ? (
            <Text variant="muted" size="sm" style={{ marginTop: 2 }}>
              {customerName}
            </Text>
          ) : null}
        </YStack>
        <Badge variant={isVoided ? "error" : config.variant} size="md">
          {isVoided ? "Voided" : config.label}
        </Badge>
      </XStack>

      <XStack alignItems="center" gap={16} marginBottom={12}>
        <Text variant="muted" size="sm">
          {time}
        </Text>
        <Text variant="muted" size="sm">
          {itemCount} items
        </Text>
        <Text style={{ fontWeight: "700", color: "#111827", fontSize: 16 }}>
          {formatCurrency(netSales)}
        </Text>
      </XStack>

      {config.nextLabel && !isVoided && (
        <TouchableOpacity
          onPress={() => onAdvanceStatus(id, takeoutStatus)}
          activeOpacity={0.8}
          style={{
            backgroundColor: config.buttonColor,
            borderRadius: 10,
            paddingVertical: 14,
            paddingHorizontal: 20,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {config.nextIcon && (
            <Ionicons name={config.nextIcon} size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
          )}
          <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 15 }}>
            {config.nextLabel}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};
