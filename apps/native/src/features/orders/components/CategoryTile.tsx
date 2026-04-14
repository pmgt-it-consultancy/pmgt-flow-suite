import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { memo } from "react";
import { Pressable } from "react-native-gesture-handler";
import { XStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface CategoryTileProps {
  id: Id<"categories">;
  name: string;
  itemCount: number;
  onPress: (categoryId: Id<"categories">) => void;
}

export const CategoryTile = memo(({ id, name, itemCount, onPress }: CategoryTileProps) => {
  return (
    <Pressable
      android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: "#EFF6FF",
          borderRadius: 12,
          padding: 16,
          margin: 6,
          maxWidth: "31.5%",
          minHeight: 100,
          borderWidth: 1,
          borderColor: "#BFDBFE",
          justifyContent: "space-between",
        },
        { opacity: pressed ? 0.7 : 1 },
      ]}
      onPress={() => onPress(id)}
    >
      <XStack alignItems="center" justifyContent="space-between">
        <Text
          style={{ color: "#1E3A5F", fontWeight: "700", fontSize: 16, flex: 1, marginRight: 8 }}
          numberOfLines={2}
        >
          {name}
        </Text>
        <Ionicons name="folder-open-outline" size={20} color="#1E40AF" />
      </XStack>
      <Text style={{ color: "#0D87E1", fontSize: 12, marginTop: 8 }}>
        {itemCount} {itemCount === 1 ? "item" : "items"}
      </Text>
    </Pressable>
  );
});
