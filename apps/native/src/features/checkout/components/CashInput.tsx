import { TextInput, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000];

interface CashInputProps {
  value: string;
  onChange: (value: string) => void;
}

export const CashInput = ({ value, onChange }: CashInputProps) => {
  return (
    <YStack paddingHorizontal={16} paddingVertical={12}>
      <Text variant="heading" style={{ marginBottom: 12 }}>
        Cash Received
      </Text>

      <XStack
        alignItems="center"
        backgroundColor="#FFFFFF"
        borderRadius={12}
        paddingHorizontal={16}
        borderWidth={1}
        borderColor="#E5E7EB"
      >
        <Text style={{ color: "#6B7280", fontWeight: "600", fontSize: 24 }}>₱</Text>
        <TextInput
          style={{
            flex: 1,
            padding: 16,
            fontWeight: "600",
            fontSize: 24,
            color: "#111827",
          }}
          placeholder="0.00"
          placeholderTextColor="#9CA3AF"
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
        />
      </XStack>

      {/* Quick Amount Buttons - Larger touch targets */}
      <XStack flexWrap="wrap" gap={10} marginTop={14}>
        {QUICK_AMOUNTS.map((amount) => {
          const isSelected = value === amount.toString();
          return (
            <TouchableOpacity
              key={amount}
              style={{
                backgroundColor: isSelected ? "#DBEAFE" : "#FFFFFF",
                paddingVertical: 14,
                paddingHorizontal: 20,
                borderRadius: 10,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected ? "#0D87E1" : "#E5E7EB",
                minWidth: 80,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
              onPress={() => onChange(amount.toString())}
              activeOpacity={0.7}
            >
              <Text
                style={{
                  color: isSelected ? "#0D87E1" : "#374151",
                  fontWeight: "600",
                  fontSize: 16,
                }}
              >
                ₱{amount.toLocaleString()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </XStack>
    </YStack>
  );
};
