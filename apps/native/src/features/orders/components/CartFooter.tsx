import { Ionicons } from "@expo/vector-icons";
import { View } from "uniwind/components";
import { Button, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface CartFooterProps {
  subtotal: number;
  itemCount: number;
  onCheckout: () => void;
}

export const CartFooter = ({ subtotal, itemCount, onCheckout }: CartFooterProps) => {
  const formatCurrency = useFormatCurrency();
  const isDisabled = itemCount === 0;

  return (
    <View className="p-3 border-t border-gray-200 bg-gray-50">
      <View className="flex-row justify-between mb-3">
        <Text className="text-gray-600 font-medium text-base">Subtotal</Text>
        <Text className="text-gray-900 font-bold text-lg">{formatCurrency(subtotal)}</Text>
      </View>

      <Button
        variant="success"
        size="lg"
        disabled={isDisabled}
        onPress={onCheckout}
        className={isDisabled ? "opacity-50" : ""}
      >
        <View className="flex-row items-center">
          <Ionicons name="card-outline" size={20} color="#FFF" />
          <Text className="text-white font-semibold ml-2">Proceed to Checkout</Text>
        </View>
      </Button>
    </View>
  );
};
