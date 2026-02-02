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

      <XStack flexWrap="wrap" gap={8} marginTop={12}>
        {QUICK_AMOUNTS.map((amount) => (
          <TouchableOpacity
            key={amount}
            style={{
              backgroundColor: "#FFFFFF",
              paddingVertical: 8,
              paddingHorizontal: 16,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "#E5E7EB",
            }}
            onPress={() => onChange(amount.toString())}
            activeOpacity={0.7}
          >
            <Text style={{ color: "#374151", fontWeight: "500" }}>{amount}</Text>
          </TouchableOpacity>
        ))}
      </XStack>
    </YStack>
  );
};
