import { Ionicons } from "@expo/vector-icons";
import { TextInput, View } from "uniwind/components";

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
    <View className="flex-row items-center px-3 py-2 bg-gray-50 border-b border-gray-200">
      <Ionicons name="search" size={20} color="#9CA3AF" />
      <TextInput
        className="flex-1 ml-2 text-base text-gray-900"
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  );
};
