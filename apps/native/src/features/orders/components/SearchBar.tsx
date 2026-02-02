import { Ionicons } from "@expo/vector-icons";
import { TextInput } from "react-native";
import { XStack, YStack } from "tamagui";

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export const SearchBar = ({
  value,
  onChangeText,
  placeholder = "Search products...",
}: SearchBarProps) => {
  return (
    <YStack paddingHorizontal={12} paddingTop={12} paddingBottom={4}>
      <XStack
        alignItems="center"
        backgroundColor="#F3F4F6"
        borderRadius={12}
        paddingHorizontal={12}
        paddingVertical={10}
      >
        <Ionicons name="search" size={18} color="#9CA3AF" />
        <TextInput
          style={{ flex: 1, marginLeft: 10, fontSize: 14, color: "#111827" }}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          value={value}
          onChangeText={onChangeText}
        />
        {value.length > 0 && (
          <Ionicons
            name="close-circle"
            size={18}
            color="#9CA3AF"
            onPress={() => onChangeText("")}
          />
        )}
      </XStack>
    </YStack>
  );
};
