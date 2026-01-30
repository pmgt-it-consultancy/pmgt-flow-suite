import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity, View } from "uniwind/components";
import { Text } from "../../shared/components/ui";

interface CategoryTileProps {
  id: Id<"categories">;
  name: string;
  itemCount: number;
  onPress: (categoryId: Id<"categories">) => void;
}

export const CategoryTile = ({ id, name, itemCount, onPress }: CategoryTileProps) => {
  return (
    <TouchableOpacity
      className="flex-1 bg-blue-50 rounded-xl p-4 m-1.5 max-w-[31.5%] min-h-[100px] border border-blue-200 shadow-sm justify-between"
      onPress={() => onPress(id)}
      activeOpacity={0.7}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-blue-900 font-bold text-base flex-1 mr-2" numberOfLines={2}>
          {name}
        </Text>
        <Ionicons name="folder-open-outline" size={20} color="#1E40AF" />
      </View>
      <Text className="text-blue-500 text-xs mt-2">
        {itemCount} {itemCount === 1 ? "item" : "items"}
      </Text>
    </TouchableOpacity>
  );
};
