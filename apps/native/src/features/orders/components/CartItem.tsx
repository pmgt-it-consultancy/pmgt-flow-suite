import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { View } from "uniwind/components";
import { IconButton, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface CartItemProps {
  id: Id<"orderItems">;
  productName: string;
  productPrice: number;
  quantity: number;
  lineTotal: number;
  notes?: string;
  onIncrement: (id: Id<"orderItems">, currentQty: number) => void;
  onDecrement: (id: Id<"orderItems">, currentQty: number) => void;
}

export const CartItem = ({
  id,
  productName,
  productPrice,
  quantity,
  lineTotal,
  notes,
  onIncrement,
  onDecrement,
}: CartItemProps) => {
  const formatCurrency = useFormatCurrency();

  return (
    <View className="px-3 py-3 border-b border-gray-100">
      <View className="flex-row justify-between items-start mb-2">
        <View className="flex-1 mr-3">
          <Text className="text-gray-900 font-semibold text-sm" numberOfLines={1}>
            {productName}
          </Text>
          <Text className="text-gray-400 text-xs mt-0.5">{formatCurrency(productPrice)} each</Text>
          {notes && (
            <Text className="text-amber-600 text-xs mt-0.5 italic" numberOfLines={1}>
              {notes}
            </Text>
          )}
        </View>
        <Text className="text-gray-900 font-bold text-sm">{formatCurrency(lineTotal)}</Text>
      </View>

      <View className="flex-row items-center">
        <View className="flex-row items-center bg-gray-50 rounded-xl border border-gray-200">
          <IconButton
            icon="remove"
            size="md"
            variant="ghost"
            iconColor="#EF4444"
            onPress={() => onDecrement(id, quantity)}
          />
          <Text className="text-gray-900 font-bold text-base px-4 min-w-[40px] text-center">
            {quantity}
          </Text>
          <IconButton
            icon="add"
            size="md"
            variant="ghost"
            iconColor="#22C55E"
            onPress={() => onIncrement(id, quantity)}
          />
        </View>
      </View>
    </View>
  );
};
