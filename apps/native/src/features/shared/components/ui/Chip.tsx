import { TouchableOpacity, type TouchableOpacityProps } from "react-native";
import { Text } from "./Text";

interface ChipProps extends TouchableOpacityProps {
  selected?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const Chip = ({
  selected = false,
  className: _className,
  children,
  style,
  ...props
}: ChipProps) => {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={[
        {
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 9999,
          backgroundColor: selected ? "#0D87E1" : "#F3F4F6",
        },
        style as any,
      ]}
      {...props}
    >
      {typeof children === "string" ? (
        <Text
          style={{
            fontSize: 14,
            fontWeight: "500",
            color: selected ? "#FFFFFF" : "#4B5563",
          }}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
};
