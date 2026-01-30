import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity, View } from "uniwind/components";
import { IconButton, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface CartItemModifier {
  groupName: string;
  optionName: string;
  priceAdjustment: number;
}

interface CartItemProps {
  id: Id<"orderItems">;
  productName: string;
  productPrice: number;
  quantity: number;
  lineTotal: number;
  notes?: string;
  modifiers?: CartItemModifier[];
  isSentToKitchen: boolean;
  onIncrement: (id: Id<"orderItems">, currentQty: number) => void;
  onDecrement: (id: Id<"orderItems">, currentQty: number) => void;
  onVoidItem?: (id: Id<"orderItems">) => void;
}

export const CartItem = ({
  id,
  productName,
  productPrice,
  quantity,
  lineTotal,
  notes,
  modifiers,
  isSentToKitchen,
  onIncrement,
  onDecrement,
  onVoidItem,
}: CartItemProps) => {
  const formatCurrency = useFormatCurrency();

  return (
    <View className="px-3 py-3 border-b border-gray-100">
      <View className="flex-row justify-between items-start mb-2">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center">
            <Text className="text-gray-900 font-semibold text-sm" numberOfLines={1}>
              {productName}
            </Text>
            {isSentToKitchen && (
              <Ionicons
                name="checkmark-circle"
                size={14}
                color="#22C55E"
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
          <Text className="text-gray-400 text-xs mt-0.5">{formatCurrency(productPrice)} each</Text>
          {modifiers && modifiers.length > 0 && (
            <View className="mt-0.5">
              {modifiers.map((mod, idx) => (
                <Text key={idx} className="text-gray-500 text-xs">
                  {mod.optionName}
                  {mod.priceAdjustment > 0 ? ` (+${formatCurrency(mod.priceAdjustment)})` : ""}
                </Text>
              ))}
            </View>
          )}
          {notes && (
            <Text className="text-amber-600 text-xs mt-0.5 italic" numberOfLines={1}>
              {notes}
            </Text>
          )}
        </View>
        <Text className="text-gray-900 font-bold text-sm">{formatCurrency(lineTotal)}</Text>
      </View>

      <View className="flex-row items-center justify-between">
        {isSentToKitchen ? (
          <>
            <Text className="text-gray-500 text-sm">Qty: {quantity}</Text>
            {onVoidItem && (
              <TouchableOpacity onPress={() => onVoidItem(id)} className="px-2 py-1">
                <Text className="text-red-500 font-medium text-xs">Void</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
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
        )}
      </View>
    </View>
  );
};
