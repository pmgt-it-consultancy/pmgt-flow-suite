import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { memo } from "react";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import type { TableOrderSummary } from "../../../sync";
import { Badge, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface TableCardProps {
  id: Id<"tables">;
  name: string;
  capacity: number;
  isOccupied: boolean;
  orders: readonly TableOrderSummary[];
  totalTabs: number;
  totalItemCount: number;
  totalNetSales: number;
  onPress: (id: Id<"tables">, name: string) => void;
  onUpdatePax?: (id: Id<"tables">) => void;
}

export const TableCard = memo(
  ({
    id,
    name,
    capacity,
    isOccupied,
    orders = [],
    totalTabs = 0,
    totalItemCount = 0,
    totalNetSales = 0,
    onPress,
    onUpdatePax,
  }: TableCardProps) => {
    const formatCurrency = useFormatCurrency();

    const statusColor = isOccupied ? "#F59E0B" : "#22C55E";
    const statusIcon = isOccupied ? "restaurant" : "checkmark-circle";
    const statusLabel = isOccupied ? "OCCUPIED" : "AVAILABLE";

    const hasMultipleTabs = totalTabs > 1;
    const singleOrder = orders[0];

    return (
      <Pressable
        android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
        style={({ pressed }) => [
          {
            backgroundColor: "#FFFFFF",
            borderRadius: 12,
            padding: 16,
            flex: 1,
            maxWidth: "47%",
            margin: 8,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
            ...(isOccupied ? { borderLeftWidth: 4, borderLeftColor: "#F59E0B" } : {}),
          },
          { opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={() => onPress(id, name)}
      >
        <XStack justifyContent="space-between" alignItems="center" marginBottom={8}>
          <XStack alignItems="center" gap={8}>
            <Text variant="heading" size="lg">
              {name}
            </Text>
            {hasMultipleTabs && (
              <XStack
                backgroundColor="#DBEAFE"
                paddingHorizontal={8}
                paddingVertical={4}
                borderRadius={6}
                alignItems="center"
                gap={4}
              >
                <Ionicons name="layers" size={14} color="#0D87E1" />
                <Text size="xs" style={{ color: "#0D87E1", fontWeight: "600" }}>
                  {totalTabs}
                </Text>
              </XStack>
            )}
          </XStack>
          <Ionicons name={statusIcon as any} size={24} color={statusColor} />
        </XStack>

        <Text variant="muted" size="sm" style={{ marginBottom: 8 }}>
          Capacity: {capacity} {capacity === 1 ? "person" : "people"}
        </Text>

        {isOccupied && orders.length > 0 && (
          <YStack gap={4} marginBottom={8}>
            {hasMultipleTabs ? (
              <>
                <Text size="sm" style={{ color: "#4B5563" }}>
                  {totalTabs} {totalTabs === 1 ? "tab" : "tabs"} · {totalItemCount}{" "}
                  {totalItemCount === 1 ? "item" : "items"}
                </Text>
                <Text size="sm" style={{ color: "#0D87E1", fontWeight: "600" }}>
                  ₱{totalNetSales.toFixed(2)}
                </Text>
              </>
            ) : (
              <>
                <Text size="sm" style={{ color: "#4B5563" }}>
                  {singleOrder.tabName} · {singleOrder.itemCount}{" "}
                  {singleOrder.itemCount === 1 ? "item" : "items"}
                  {singleOrder.pax ? ` · ${singleOrder.pax} pax` : ""}
                </Text>
                <Text size="sm" style={{ color: "#0D87E1", fontWeight: "600" }}>
                  ₱{singleOrder.netSales.toFixed(2)}
                </Text>
              </>
            )}
          </YStack>
        )}

        <Badge variant={isOccupied ? "warning" : "success"} style={{ alignSelf: "flex-start" }}>
          {statusLabel}
        </Badge>
      </Pressable>
    );
  },
);
