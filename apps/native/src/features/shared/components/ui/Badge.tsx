import type { StyleProp, ViewStyle } from "react-native";
import { XStack } from "tamagui";
import { Text } from "./Text";

interface BadgeProps {
  variant?: "default" | "primary" | "secondary" | "success" | "warning" | "error" | "outline";
  size?: "sm" | "md";
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const variantStyles: Record<NonNullable<BadgeProps["variant"]>, { bg: string; border?: string }> = {
  default: { bg: "#F3F4F6" },
  primary: { bg: "#DBEAFE" },
  secondary: { bg: "#E5E7EB" },
  success: { bg: "#DCFCE7" },
  warning: { bg: "#FEF3C7" },
  error: { bg: "#FEE2E2" },
  outline: { bg: "transparent", border: "#D1D5DB" },
};

const textColors: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "#374151",
  primary: "#1D4ED8",
  secondary: "#374151",
  success: "#15803D",
  warning: "#A16207",
  error: "#B91C1C",
  outline: "#374151",
};

const sizeMap: Record<
  NonNullable<BadgeProps["size"]>,
  { px: number; py: number; radius: number }
> = {
  sm: { px: 8, py: 2, radius: 4 },
  md: { px: 12, py: 4, radius: 6 },
};

export const Badge = ({ variant = "default", size = "sm", children, style }: BadgeProps) => {
  const v = variantStyles[variant];
  const s = sizeMap[size];

  return (
    <XStack
      backgroundColor={v.bg}
      paddingHorizontal={s.px}
      paddingVertical={s.py}
      borderRadius={s.radius}
      borderWidth={v.border ? 1 : 0}
      borderColor={v.border}
      alignItems="center"
      style={style}
    >
      {typeof children === "string" ? (
        <Text style={{ color: textColors[variant], fontSize: 12, fontWeight: "500" }}>
          {children}
        </Text>
      ) : (
        children
      )}
    </XStack>
  );
};
