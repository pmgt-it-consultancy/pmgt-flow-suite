import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { memo } from "react";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { Badge, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

type TakeoutStatus = "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";

interface TakeoutOrderCardProps {
  id: Id<"orders">;
  orderNumber?: string;
  customerName?: string;
  orderStatus?: "draft" | "open" | "paid" | "voided";
  takeoutStatus?: TakeoutStatus;
  netSales: number;
  itemCount: number;
  createdAt: number;
  refundedFromOrderId?: Id<"orders">;
  onAdvanceStatus: (orderId: Id<"orders">, currentStatus: TakeoutStatus) => void;
  onPress?: (orderId: Id<"orders">) => void;
  onAddItems?: (orderId: Id<"orders">) => void;
  onTakePayment?: (orderId: Id<"orders">) => void;
  disableAdvance?: boolean;
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

export const TakeoutOrderCard = memo(
  ({
    id,
    orderNumber,
    customerName,
    orderStatus,
    takeoutStatus = "pending",
    netSales,
    itemCount,
    createdAt,
    refundedFromOrderId,
    onAdvanceStatus,
    onPress,
    onAddItems,
    onTakePayment,
    disableAdvance = false,
  }: TakeoutOrderCardProps) => {
    const formatCurrency = useFormatCurrency();
    const isVoided = orderStatus === "voided";
    const isOpen = orderStatus === "open";
    const isPaid = orderStatus === "paid";
    const config = isVoided ? statusConfig.cancelled : statusConfig[takeoutStatus];
    const time = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const paymentBadge = isVoided
      ? { label: "Voided", variant: "error" as const }
      : isPaid
        ? { label: "Paid", variant: "success" as const }
        : { label: "Unpaid", variant: "warning" as const };
    const canAdvanceWorkflow = isPaid && config.nextLabel && !isVoided;
    const canResumeOrder = isOpen && !isVoided;
    const isAdvanceOrder =
      isOpen && (takeoutStatus === "preparing" || takeoutStatus === "ready_for_pickup");
    const primaryActionLabel = isAdvanceOrder
      ? "Take Payment"
      : canResumeOrder && takeoutStatus === "ready_for_pickup"
        ? "Resume & Take Payment"
        : "Resume Order";
    const helperText = isVoided
      ? "Voided order record"
      : isAdvanceOrder
        ? "Ticket sent. Advance or collect payment below."
        : canResumeOrder
          ? "Open order. Resume to edit or take payment."
          : isPaid && config.nextLabel
            ? "Paid order ready for the next kitchen step."
            : "Past order — open to reprint the receipt.";
    const showDetailsRow = !isOpen;

    return (
      <YStack
        backgroundColor={isAdvanceOrder ? "#EFF6FF" : canResumeOrder ? "#FFFBEB" : "#FFFFFF"}
        borderRadius={12}
        padding={16}
        borderWidth={1}
        borderColor={isAdvanceOrder ? "#93C5FD" : canResumeOrder ? "#FCD34D" : "#F3F4F6"}
        marginBottom={12}
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
          <YStack gap={6} alignItems="flex-end">
            <Badge variant={isVoided ? "error" : config.variant} size="md">
              {isVoided ? "Voided" : config.label}
            </Badge>
            {refundedFromOrderId && (
              <Badge variant="warning" size="sm">
                Refunded
              </Badge>
            )}
            {!isVoided && !refundedFromOrderId && (
              <Badge variant={paymentBadge.variant} size="sm">
                {paymentBadge.label}
              </Badge>
            )}
          </YStack>
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

        <Text variant="muted" size="xs" style={{ marginBottom: 12 }}>
          {helperText}
        </Text>

        {canResumeOrder && !isAdvanceOrder && (
          <Pressable
            android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
            onPress={() => onPress?.(id)}
            style={({ pressed }) => [
              {
                backgroundColor: "#F59E0B",
                borderRadius: 10,
                paddingVertical: 14,
                paddingHorizontal: 20,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              },
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="create-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 15 }} numberOfLines={1}>
              {primaryActionLabel}
            </Text>
          </Pressable>
        )}

        {isAdvanceOrder && (
          <XStack gap={10}>
            <Pressable
              android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
              onPress={() => onAddItems?.(id)}
              style={({ pressed }) => [
                {
                  flex: 1,
                  backgroundColor: "#F59E0B",
                  borderRadius: 10,
                  paddingVertical: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons
                name="add-circle-outline"
                size={18}
                color="#FFFFFF"
                style={{ marginRight: 6 }}
              />
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 15 }}>Add Items</Text>
            </Pressable>
            <Pressable
              android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
              onPress={() => onTakePayment?.(id)}
              style={({ pressed }) => [
                {
                  flex: 1,
                  backgroundColor: "#0D87E1",
                  borderRadius: 10,
                  paddingVertical: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="card-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 15 }}>
                Take Payment
              </Text>
            </Pressable>
          </XStack>
        )}

        {canAdvanceWorkflow && (
          <Pressable
            android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
            onPress={() => {
              if (!disableAdvance) {
                onAdvanceStatus(id, takeoutStatus);
              }
            }}
            disabled={disableAdvance}
            style={({ pressed }) => [
              {
                backgroundColor: disableAdvance ? "#9CA3AF" : config.buttonColor,
                borderRadius: 10,
                paddingVertical: 14,
                paddingHorizontal: 20,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                opacity: disableAdvance ? 0.7 : 1,
              },
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            {config.nextIcon && !disableAdvance ? (
              <Ionicons
                name={config.nextIcon}
                size={20}
                color="#FFFFFF"
                style={{ marginRight: 8 }}
              />
            ) : null}
            <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 15 }}>
              {disableAdvance ? "Awaiting Payment" : config.nextLabel}
            </Text>
          </Pressable>
        )}

        {showDetailsRow && (
          <Pressable
            android_ripple={{ color: "rgba(0,0,0,0.08)", borderless: false }}
            onPress={() => onPress?.(id)}
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "#F8FAFC",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#E2E8F0",
                paddingVertical: 12,
                paddingHorizontal: 16,
                marginTop: canAdvanceWorkflow ? 10 : 0,
              },
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <XStack alignItems="center" gap={8}>
              <Ionicons
                name={canAdvanceWorkflow ? "receipt-outline" : "document-text-outline"}
                size={18}
                color="#475569"
              />
              <Text style={{ color: "#334155", fontWeight: "600", fontSize: 14 }}>
                {canAdvanceWorkflow ? "View Receipt" : "View Details"}
              </Text>
            </XStack>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </Pressable>
        )}
      </YStack>
    );
  },
);
