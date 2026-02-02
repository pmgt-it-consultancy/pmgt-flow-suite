import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";

type PaymentMethod = "cash" | "card_ewallet";

interface PaymentMethodSelectorProps {
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
}

export const PaymentMethodSelector = ({ selected, onSelect }: PaymentMethodSelectorProps) => {
  return (
    <YStack paddingHorizontal={16} paddingVertical={12}>
      <Text variant="heading" style={{ marginBottom: 12 }}>
        Payment Method
      </Text>
      <XStack gap={12}>
        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: selected === "cash" ? "#EFF6FF" : "#FFFFFF",
            borderRadius: 12,
            padding: 16,
            alignItems: "center",
            borderWidth: 2,
            borderColor: selected === "cash" ? "#0D87E1" : "#E5E7EB",
          }}
          onPress={() => onSelect("cash")}
          activeOpacity={0.7}
        >
          <Ionicons
            name="cash-outline"
            size={24}
            color={selected === "cash" ? "#0D87E1" : "#6B7280"}
          />
          <Text
            style={{
              marginTop: 8,
              fontWeight: "500",
              color: selected === "cash" ? "#0D87E1" : "#6B7280",
            }}
          >
            Cash
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: selected === "card_ewallet" ? "#EFF6FF" : "#FFFFFF",
            borderRadius: 12,
            padding: 16,
            alignItems: "center",
            borderWidth: 2,
            borderColor: selected === "card_ewallet" ? "#0D87E1" : "#E5E7EB",
          }}
          onPress={() => onSelect("card_ewallet")}
          activeOpacity={0.7}
        >
          <Ionicons
            name="card-outline"
            size={24}
            color={selected === "card_ewallet" ? "#0D87E1" : "#6B7280"}
          />
          <Text
            style={{
              marginTop: 8,
              fontWeight: "500",
              color: selected === "card_ewallet" ? "#0D87E1" : "#6B7280",
            }}
          >
            Card/E-Wallet
          </Text>
        </TouchableOpacity>
      </XStack>
    </YStack>
  );
};
