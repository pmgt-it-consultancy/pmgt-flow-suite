import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity, View } from "uniwind/components";
import { Badge, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface TableCardProps {
  id: Id<"tables">;
  name: string;
  capacity: number;
  isOccupied: boolean;
  itemCount?: number;
  total?: number;
  onPress: (id: Id<"tables">, name: string) => void;
}

export const TableCard = ({
  id,
  name,
  capacity,
  isOccupied,
  itemCount,
  total,
  onPress,
}: TableCardProps) => {
  const formatCurrency = useFormatCurrency();

  const statusColor = isOccupied ? "#F59E0B" : "#22C55E";
  const statusIcon = isOccupied ? "restaurant" : "checkmark-circle";
  const statusLabel = isOccupied ? "OCCUPIED" : "AVAILABLE";

  return (
    <TouchableOpacity
      className={`bg-white rounded-xl p-4 flex-1 max-w-[47%] m-2 shadow-sm ${isOccupied ? "border-l-4 border-amber-500" : ""}`}
      onPress={() => onPress(id, name)}
      activeOpacity={0.7}
    >
      <View className="flex-row justify-between items-center mb-2">
        <Text variant="heading" size="lg">
          {name}
        </Text>
        <Ionicons name={statusIcon as any} size={24} color={statusColor} />
      </View>

      <Text variant="muted" size="sm" className="mb-2">
        Capacity: {capacity} {capacity === 1 ? "person" : "people"}
      </Text>

      {isOccupied && itemCount !== undefined && (
        <View className="flex-row justify-between mb-2">
          <Text size="sm" className="text-gray-600">
            {itemCount} item(s)
          </Text>
          <Text size="sm" className="text-blue-500 font-semibold">
            {formatCurrency(total ?? 0)}
          </Text>
        </View>
      )}

      <Badge variant={isOccupied ? "warning" : "success"} className="self-start">
        {statusLabel}
      </Badge>
    </TouchableOpacity>
  );
};
