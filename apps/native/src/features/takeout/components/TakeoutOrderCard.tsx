import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Badge, Button, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

type TakeoutStatus = "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";

interface TakeoutOrderCardProps {
  id: Id<"orders">;
  orderNumber: string;
  customerName?: string;
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
  }
> = {
  pending: { label: "Pending", variant: "warning", nextLabel: "Start Preparing" },
  preparing: { label: "Preparing", variant: "primary", nextLabel: "Ready for Pickup" },
  ready_for_pickup: { label: "Ready", variant: "success", nextLabel: "Complete" },
  completed: { label: "Completed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "error" },
};

export const TakeoutOrderCard = ({
  id,
  orderNumber,
  customerName,
  takeoutStatus = "pending",
  netSales,
  itemCount,
  createdAt,
  onAdvanceStatus,
  onPress,
}: TakeoutOrderCardProps) => {
  const formatCurrency = useFormatCurrency();
  const config = statusConfig[takeoutStatus];
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
      <XStack justifyContent="space-between" alignItems="flex-start" marginBottom={8}>
        <YStack>
          <Text style={{ fontWeight: "700", color: "#111827", fontSize: 16 }}>{orderNumber}</Text>
          {customerName ? (
            <Text variant="muted" size="sm" style={{ marginTop: 2 }}>
              {customerName}
            </Text>
          ) : null}
        </YStack>
        <Badge variant={config.variant} size="md">
          {config.label}
        </Badge>
      </XStack>

      <XStack justifyContent="space-between" alignItems="center" marginTop={8}>
        <XStack alignItems="center" gap={12}>
          <Text variant="muted" size="sm">
            {time}
          </Text>
          <Text variant="muted" size="sm">
            {itemCount} items
          </Text>
          <Text style={{ fontWeight: "600", color: "#111827", fontSize: 14 }}>
            {formatCurrency(netSales)}
          </Text>
        </XStack>

        {config.nextLabel ? (
          <Button
            size="sm"
            variant={takeoutStatus === "ready_for_pickup" ? "success" : "primary"}
            onPress={() => onAdvanceStatus(id, takeoutStatus)}
          >
            {config.nextLabel}
          </Button>
        ) : null}
      </XStack>
    </TouchableOpacity>
  );
};
