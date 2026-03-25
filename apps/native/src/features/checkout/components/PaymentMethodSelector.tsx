import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Card, Text } from "../../shared/components/ui";

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
      <Card variant="outlined">
        <Text variant="muted" size="xs" style={{ marginBottom: 12 }}>
          Choose how the customer will settle this order
        </Text>
        <XStack gap={12}>
          <TouchableOpacity
            style={{
              flex: 1,
              backgroundColor: selected === "cash" ? "#EFF6FF" : "#FFFFFF",
              borderRadius: 12,
              paddingVertical: 16,
              paddingHorizontal: 12,
              alignItems: "center",
              borderWidth: 1.5,
              borderColor: selected === "cash" ? "#0D87E1" : "#E5E7EB",
              minHeight: 76,
              justifyContent: "center",
            }}
            onPress={() => onSelect("cash")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="cash-outline"
              size={22}
              color={selected === "cash" ? "#0D87E1" : "#6B7280"}
            />
            <Text
              style={{
                marginTop: 8,
                fontWeight: "600",
                color: selected === "cash" ? "#0D87E1" : "#374151",
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
              paddingVertical: 16,
              paddingHorizontal: 12,
              alignItems: "center",
              borderWidth: 1.5,
              borderColor: selected === "card_ewallet" ? "#0D87E1" : "#E5E7EB",
              minHeight: 76,
              justifyContent: "center",
            }}
            onPress={() => onSelect("card_ewallet")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="card-outline"
              size={22}
              color={selected === "card_ewallet" ? "#0D87E1" : "#6B7280"}
            />
            <Text
              style={{
                marginTop: 8,
                fontWeight: "600",
                color: selected === "card_ewallet" ? "#0D87E1" : "#374151",
              }}
            >
              Card/E-Wallet
            </Text>
          </TouchableOpacity>
        </XStack>
      </Card>
    </YStack>
  );
};
