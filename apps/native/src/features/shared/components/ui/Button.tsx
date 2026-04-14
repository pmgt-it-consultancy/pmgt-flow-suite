import type React from "react";
import { type ComponentProps, forwardRef } from "react";
import { ActivityIndicator } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { Text } from "./Text";

interface ButtonProps extends ComponentProps<typeof Pressable> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<
  NonNullable<ButtonProps["variant"]>,
  { bg: string; activeBg: string }
> = {
  primary: { bg: "#0D87E1", activeBg: "#0B6FBA" },
  secondary: { bg: "#E5E7EB", activeBg: "#D1D5DB" },
  outline: { bg: "transparent", activeBg: "#F3F4F6" },
  ghost: { bg: "transparent", activeBg: "#F3F4F6" },
  destructive: { bg: "#EF4444", activeBg: "#DC2626" },
  success: { bg: "#22C55E", activeBg: "#16A34A" },
};

const textColors: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "#FFFFFF",
  secondary: "#111827",
  outline: "#111827",
  ghost: "#111827",
  destructive: "#FFFFFF",
  success: "#FFFFFF",
};

const textWeights: Record<NonNullable<ButtonProps["variant"]>, "600" | "500"> = {
  primary: "600",
  secondary: "500",
  outline: "500",
  ghost: "500",
  destructive: "600",
  success: "600",
};

const sizeStyles: Record<
  NonNullable<ButtonProps["size"]>,
  { px: number; py: number; radius: number }
> = {
  sm: { px: 12, py: 8, radius: 6 },
  md: { px: 16, py: 12, radius: 8 },
  lg: { px: 24, py: 16, radius: 12 },
};

const textSizes: Record<NonNullable<ButtonProps["size"]>, number> = {
  sm: 14,
  md: 16,
  lg: 18,
};

export const Button = forwardRef<React.ElementRef<typeof Pressable>, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      className: _className,
      children,
      style,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    const v = variantStyles[variant];
    const s = sizeStyles[size];

    return (
      <Pressable
        ref={ref}
        disabled={isDisabled}
        android_ripple={{ color: "rgba(255,255,255,0.2)", borderless: false }}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: v.bg,
            paddingHorizontal: s.px,
            paddingVertical: s.py,
            borderRadius: s.radius,
            opacity: isDisabled ? 0.5 : pressed ? 0.8 : 1,
            ...(variant === "outline" ? { borderWidth: 1, borderColor: "#D1D5DB" } : {}),
          },
          typeof style === "function" ? style({ pressed }) : style,
        ]}
        {...props}
      >
        {loading ? (
          <ActivityIndicator
            color={
              variant === "primary" || variant === "destructive" || variant === "success"
                ? "#fff"
                : "#374151"
            }
            size="small"
          />
        ) : typeof children === "string" ? (
          <Text
            style={{
              color: textColors[variant],
              fontWeight: textWeights[variant],
              fontSize: textSizes[size],
            }}
            numberOfLines={1}
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </Pressable>
    );
  },
);

Button.displayName = "Button";
