import type { StyleProp, ViewStyle } from "react-native";
import { YStack } from "tamagui";

interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  style?: StyleProp<ViewStyle>;
}

export const Separator = ({ orientation = "horizontal", style }: SeparatorProps) => {
  return (
    <YStack
      height={orientation === "horizontal" ? 1 : "100%"}
      width={orientation === "horizontal" ? "100%" : 1}
      backgroundColor="#E5E7EB"
      style={style}
    />
  );
};
