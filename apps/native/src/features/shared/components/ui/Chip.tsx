import { TouchableOpacity } from "uniwind/components";
import { TouchableOpacityProps } from "react-native";
import { Text } from "./Text";

interface ChipProps extends TouchableOpacityProps {
  selected?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const Chip = ({
  selected = false,
  className = "",
  children,
  ...props
}: ChipProps) => {
  const containerClasses = `px-4 py-2 rounded-full ${selected ? "bg-blue-500" : "bg-gray-100"} ${className}`.trim();
  const textClasses = `text-sm font-medium ${selected ? "text-white" : "text-gray-600"}`;

  return (
    <TouchableOpacity className={containerClasses} activeOpacity={0.7} {...props}>
      {typeof children === "string" ? (
        <Text className={textClasses}>{children}</Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
};
