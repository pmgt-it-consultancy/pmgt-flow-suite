import { View } from "uniwind/components";
import { ViewProps } from "react-native";

interface SeparatorProps extends ViewProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export const Separator = ({
  orientation = "horizontal",
  className = "",
  ...props
}: SeparatorProps) => {
  const orientationClasses =
    orientation === "horizontal"
      ? "h-px w-full bg-gray-200"
      : "w-px h-full bg-gray-200";

  return <View className={`${orientationClasses} ${className}`.trim()} {...props} />;
};
