import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity, View } from "uniwind/components";
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
      className="bg-white rounded-xl p-4 border border-gray-100 mb-3"
      activeOpacity={0.7}
      onPress={() => onPress?.(id)}
    >
      <View className="flex-row justify-between items-start mb-2">
        <View>
          <Text className="font-bold text-gray-900 text-base">{orderNumber}</Text>
          {customerName ? (
            <Text variant="muted" size="sm" className="mt-0.5">
              {customerName}
            </Text>
          ) : null}
        </View>
        <Badge variant={config.variant} size="md">
          {config.label}
        </Badge>
      </View>

      <View className="flex-row justify-between items-center mt-2">
        <View className="flex-row items-center gap-3">
          <Text variant="muted" size="sm">
            {time}
          </Text>
          <Text variant="muted" size="sm">
            {itemCount} items
          </Text>
          <Text className="font-semibold text-gray-900 text-sm">{formatCurrency(netSales)}</Text>
        </View>

        {config.nextLabel ? (
          <Button
            size="sm"
            variant={takeoutStatus === "ready_for_pickup" ? "success" : "primary"}
            onPress={() => onAdvanceStatus(id, takeoutStatus)}
          >
            {config.nextLabel}
          </Button>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};
