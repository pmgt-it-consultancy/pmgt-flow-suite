import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity, View } from "uniwind/components";
import { Button, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface CartFooterProps {
  subtotal: number;
  itemCount: number;
  hasUnsentItems: boolean;
  hasSentItems: boolean;
  isDraftMode: boolean;
  onSendToKitchen: () => void;
  onCloseTable: () => void;
  onViewBill: () => void;
  onCancelOrder: () => void;
}

export const CartFooter = ({
  subtotal,
  itemCount,
  hasUnsentItems,
  hasSentItems,
  isDraftMode,
  onSendToKitchen,
  onCloseTable,
  onViewBill,
  onCancelOrder,
}: CartFooterProps) => {
  const formatCurrency = useFormatCurrency();

  const canSendToKitchen = hasUnsentItems;
  const canCloseTable = !isDraftMode && itemCount > 0;
  const canViewBill = !isDraftMode && itemCount > 0;
  const canCancel = !hasSentItems;

  return (
    <View className="px-3 py-3 border-t border-gray-200 bg-white">
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-gray-500 font-medium text-sm">Subtotal</Text>
        <Text className="text-gray-900 font-bold text-xl">{formatCurrency(subtotal)}</Text>
      </View>

      <Button
        variant="success"
        size="lg"
        disabled={!canSendToKitchen}
        onPress={onSendToKitchen}
        className={!canSendToKitchen ? "opacity-40" : ""}
      >
        <View className="flex-row items-center">
          <Ionicons name="restaurant-outline" size={20} color="#FFF" />
          <Text className="text-white font-bold ml-2 text-base">Send to Kitchen</Text>
        </View>
      </Button>

      {canCloseTable && (
        <Button variant="primary" size="lg" onPress={onCloseTable} className="mt-2">
          <View className="flex-row items-center">
            <Ionicons name="card-outline" size={20} color="#FFF" />
            <Text className="text-white font-bold ml-2 text-base">Close Table</Text>
          </View>
        </Button>
      )}

      {canViewBill && (
        <Button variant="outline" size="lg" onPress={onViewBill} className="mt-2">
          <View className="flex-row items-center">
            <Ionicons name="receipt-outline" size={20} color="#374151" />
            <Text className="text-gray-700 font-bold ml-2 text-base">View Bill</Text>
          </View>
        </Button>
      )}

      {canCancel && (
        <TouchableOpacity onPress={onCancelOrder} className="mt-3 items-center py-1">
          <Text className="text-red-500 font-medium text-sm">Cancel Order</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
