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
    <View className="px-3 pt-3 pb-1">
      <View className="flex-row items-center bg-gray-100 rounded-xl px-3 py-2.5">
        <Ionicons name="search" size={18} color="#9CA3AF" />
        <TextInput
          className="flex-1 ml-2.5 text-sm text-gray-900"
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
      </View>
    </View>
  );
};
