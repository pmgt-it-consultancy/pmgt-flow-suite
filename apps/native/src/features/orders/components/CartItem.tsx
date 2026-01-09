import React from "react";
import { View } from "uniwind/components";
import { Ionicons } from "@expo/vector-icons";
import { Text, IconButton } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import { Id } from "@packages/backend/convex/_generated/dataModel";

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
      <View className="mb-2">
        <Text className="text-gray-900 font-medium" numberOfLines={1}>
          {productName}
        </Text>
        <Text variant="muted" size="xs">
          {formatCurrency(productPrice)} each
        </Text>
        {notes && (
          <Text variant="muted" size="xs" className="italic" numberOfLines={1}>
            Note: {notes}
          </Text>
        )}
      </View>

      <View className="flex-row justify-between items-center">
        <View className="flex-row items-center bg-gray-100 rounded-lg">
          <IconButton
            icon="remove"
            size="sm"
            variant="ghost"
            iconColor="#EF4444"
            onPress={() => onDecrement(id, quantity)}
          />
          <Text className="text-gray-900 font-semibold px-3">
            {quantity}
          </Text>
          <IconButton
            icon="add"
            size="sm"
            variant="ghost"
            iconColor="#22C55E"
            onPress={() => onIncrement(id, quantity)}
          />
        </View>
        <Text className="text-gray-900 font-semibold">
          {formatCurrency(lineTotal)}
        </Text>
      </View>
    </View>
  );
};
