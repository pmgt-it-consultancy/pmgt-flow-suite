import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Badge, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface TableCardProps {
  id: Id<"tables">;
  name: string;
  capacity: number;
  isOccupied: boolean;
  itemCount?: number;
  total?: number;
  pax?: number;
  onPress: (id: Id<"tables">, name: string) => void;
  onUpdatePax?: (id: Id<"tables">) => void;
}

export const TableCard = ({
  id,
  name,
  capacity,
  isOccupied,
  itemCount,
  total,
  pax,
  onPress,
  onUpdatePax,
}: TableCardProps) => {
  const formatCurrency = useFormatCurrency();

  const statusColor = isOccupied ? "#F59E0B" : "#22C55E";
  const statusIcon = isOccupied ? "restaurant" : "checkmark-circle";
  const statusLabel = isOccupied ? "OCCUPIED" : "AVAILABLE";

  return (
    <TouchableOpacity
      style={{
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
      }}
      onPress={() => onPress(id, name)}
      activeOpacity={0.7}
    >
      <XStack justifyContent="space-between" alignItems="center" marginBottom={8}>
        <Text variant="heading" size="lg">
          {name}
        </Text>
        <Ionicons name={statusIcon as any} size={24} color={statusColor} />
      </XStack>

      <Text variant="muted" size="sm" style={{ marginBottom: 8 }}>
        Capacity: {capacity} {capacity === 1 ? "person" : "people"}
      </Text>

      {isOccupied && itemCount !== undefined && (
        <XStack justifyContent="space-between" marginBottom={8}>
          <Text size="sm" style={{ color: "#4B5563" }}>
            {itemCount} item(s){pax ? ` · ${pax} pax` : ""}
          </Text>
          <Text size="sm" style={{ color: "#0D87E1", fontWeight: "600" }}>
            {formatCurrency(total ?? 0)}
          </Text>
        </XStack>
      )}

      <Badge variant={isOccupied ? "warning" : "success"} style={{ alignSelf: "flex-start" }}>
        {statusLabel}
      </Badge>
    </TouchableOpacity>
  );
};
