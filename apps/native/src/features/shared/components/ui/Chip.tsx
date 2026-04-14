import type { ComponentProps } from "react";
import { Pressable } from "react-native-gesture-handler";
import { Text } from "./Text";

interface ChipProps extends ComponentProps<typeof Pressable> {
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
    <Pressable
      android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
      style={({ pressed }) => [
        {
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 9999,
          backgroundColor: selected ? "#0D87E1" : "#F3F4F6",
          opacity: pressed ? 0.7 : 1,
        },
        typeof style === "function" ? style({ pressed }) : style,
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
    </Pressable>
  );
};
