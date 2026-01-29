import { Ionicons } from "@expo/vector-icons";
import { View } from "uniwind/components";
import { Button, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface CartFooterProps {
  subtotal: number;
  itemCount: number;
  onCheckout: () => void;
  onCancelOrder: () => void;
}

export const CartFooter = ({ subtotal, itemCount, onCheckout, onCancelOrder }: CartFooterProps) => {
  const formatCurrency = useFormatCurrency();
  const isDisabled = itemCount === 0;

  return (
    <View className="px-3 py-3 border-t border-gray-200 bg-white">
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-gray-500 font-medium text-sm">Subtotal</Text>
        <Text className="text-gray-900 font-bold text-xl">{formatCurrency(subtotal)}</Text>
      </View>

      <Button
        variant="success"
        size="lg"
        disabled={isDisabled}
        onPress={onCheckout}
        className={isDisabled ? "opacity-40" : ""}
      >
        <View className="flex-row items-center">
          <Ionicons name="card-outline" size={20} color="#FFF" />
          <Text className="text-white font-bold ml-2 text-base">Proceed to Checkout</Text>
        </View>
      </Button>

      <Button variant="destructive" size="lg" onPress={onCancelOrder} className="mt-2">
        <View className="flex-row items-center">
          <Ionicons name="close-circle-outline" size={20} color="#FFF" />
          <Text className="text-white font-bold ml-2 text-base">Cancel Order</Text>
        </View>
      </Button>
    </View>
  );
};
