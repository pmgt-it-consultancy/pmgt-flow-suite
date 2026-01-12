import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity, View } from "uniwind/components";
import { Text } from "../../shared/components/ui";

type PaymentMethod = "cash" | "card_ewallet";

interface PaymentMethodSelectorProps {
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
}

export const PaymentMethodSelector = ({ selected, onSelect }: PaymentMethodSelectorProps) => {
  return (
    <View className="px-4 py-3">
      <Text variant="heading" className="mb-3">
        Payment Method
      </Text>
      <View className="flex-row gap-3">
        <TouchableOpacity
          className={`flex-1 bg-white rounded-xl p-4 items-center border-2 ${
            selected === "cash" ? "border-blue-500 bg-blue-50" : "border-gray-200"
          }`}
          onPress={() => onSelect("cash")}
          activeOpacity={0.7}
        >
          <Ionicons
            name="cash-outline"
            size={24}
            color={selected === "cash" ? "#0D87E1" : "#6B7280"}
          />
          <Text
            className={`mt-2 font-medium ${
              selected === "cash" ? "text-blue-500" : "text-gray-500"
            }`}
          >
            Cash
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`flex-1 bg-white rounded-xl p-4 items-center border-2 ${
            selected === "card_ewallet" ? "border-blue-500 bg-blue-50" : "border-gray-200"
          }`}
          onPress={() => onSelect("card_ewallet")}
          activeOpacity={0.7}
        >
          <Ionicons
            name="card-outline"
            size={24}
            color={selected === "card_ewallet" ? "#0D87E1" : "#6B7280"}
          />
          <Text
            className={`mt-2 font-medium ${
              selected === "card_ewallet" ? "text-blue-500" : "text-gray-500"
            }`}
          >
            Card/E-Wallet
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
