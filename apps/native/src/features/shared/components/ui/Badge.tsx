import type { ViewProps } from "react-native";
import { View } from "uniwind/components";
import { Text } from "./Text";

interface BadgeProps extends ViewProps {
  variant?: "default" | "primary" | "secondary" | "success" | "warning" | "error" | "outline";
  size?: "sm" | "md";
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "bg-gray-100",
  primary: "bg-blue-100",
  secondary: "bg-gray-200",
  success: "bg-green-100",
  warning: "bg-yellow-100",
  error: "bg-red-100",
  outline: "bg-transparent border border-gray-300",
};

const textVariantClasses: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "text-gray-700",
  primary: "text-blue-700",
  secondary: "text-gray-700",
  success: "text-green-700",
  warning: "text-yellow-700",
  error: "text-red-700",
  outline: "text-gray-700",
};

const sizeClasses: Record<NonNullable<BadgeProps["size"]>, string> = {
  sm: "px-2 py-0.5 rounded",
  md: "px-3 py-1 rounded-md",
};

export const Badge = ({
  variant = "default",
  size = "sm",
  className = "",
  children,
  ...props
}: BadgeProps) => {
  const classes = `${variantClasses[variant]} ${sizeClasses[size]} ${className}`.trim();
  const textClasses = `${textVariantClasses[variant]} text-xs font-medium`.trim();

  return (
    <View className={classes} {...props}>
      {typeof children === "string" ? <Text className={textClasses}>{children}</Text> : children}
    </View>
  );
};
