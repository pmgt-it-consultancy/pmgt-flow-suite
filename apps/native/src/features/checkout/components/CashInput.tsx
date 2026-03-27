import { Ionicons } from "@expo/vector-icons";
import { TextInput, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Card, Text } from "../../shared/components/ui";

const QUICK_AMOUNTS = [50, 100, 200, 500, 1000, 2000];

interface CashInputProps {
  value: string;
  totalAmount: number;
  onChange: (value: string) => void;
}

export const CashInput = ({ value, totalAmount, onChange }: CashInputProps) => {
  const currentValue = parseFloat(value) || 0;

  const handleQuickAdd = (amount: number) => {
    const newValue = currentValue + amount;
    onChange(newValue.toString());
  };

  const handleExactAmount = () => {
    onChange(totalAmount.toFixed(2).replace(/\.00$/, ""));
  };

  const handleClear = () => {
    onChange("");
  };

  return (
    <YStack paddingHorizontal={16} paddingVertical={12}>
      <Text variant="heading" style={{ marginBottom: 12 }}>
        Cash Received
      </Text>

      <Card variant="outlined">
        <Text variant="muted" size="xs" style={{ marginBottom: 12 }}>
          Tap quick amounts to add, or type directly
        </Text>

        <XStack
          alignItems="center"
          backgroundColor="#F9FAFB"
          borderRadius={12}
          paddingHorizontal={16}
          borderWidth={1}
          borderColor={currentValue >= totalAmount && currentValue > 0 ? "#22C55E" : "#E5E7EB"}
        >
          <Text style={{ color: "#6B7280", fontWeight: "600", fontSize: 24 }}>₱</Text>
          <TextInput
            style={{
              flex: 1,
              padding: 16,
              fontWeight: "700",
              fontSize: 24,
              color: currentValue >= totalAmount && currentValue > 0 ? "#16A34A" : "#111827",
            }}
            placeholder="0.00"
            placeholderTextColor="#9CA3AF"
            value={value}
            onChangeText={onChange}
            keyboardType="numeric"
          />
          {value !== "" && (
            <TouchableOpacity
              onPress={handleClear}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.6}
            >
              <Ionicons name="close-circle" size={22} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </XStack>

        <XStack gap={10} marginTop={14}>
          <TouchableOpacity
            style={{
              flex: 1,
              backgroundColor: currentValue === totalAmount ? "#DCFCE7" : "#F0FDF4",
              paddingVertical: 14,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: currentValue === totalAmount ? "#22C55E" : "#BBF7D0",
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={handleExactAmount}
            activeOpacity={0.7}
          >
            <Text
              style={{
                color: "#16A34A",
                fontWeight: "700",
                fontSize: 14,
              }}
            >
              Exact Amount
            </Text>
          </TouchableOpacity>
        </XStack>

        <XStack flexWrap="wrap" gap={10} marginTop={10}>
          {QUICK_AMOUNTS.map((amount) => (
            <TouchableOpacity
              key={amount}
              style={{
                backgroundColor: "#FFFFFF",
                paddingVertical: 14,
                paddingHorizontal: 20,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: "#E5E7EB",
                minWidth: 80,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
              onPress={() => handleQuickAdd(amount)}
              activeOpacity={0.7}
            >
              <Text
                style={{
                  color: "#374151",
                  fontWeight: "600",
                  fontSize: 16,
                }}
              >
                +₱{amount.toLocaleString()}
              </Text>
            </TouchableOpacity>
          ))}
        </XStack>
      </Card>
    </YStack>
  );
};
