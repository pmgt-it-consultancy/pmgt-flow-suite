import type React from "react";
import { forwardRef } from "react";
import type { TouchableOpacity, TouchableOpacityProps } from "react-native";
import { ActivityIndicator, TouchableOpacity as UniwindTouchableOpacity } from "uniwind/components";
import { Text } from "./Text";

interface ButtonProps extends TouchableOpacityProps {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-blue-500 active:bg-blue-600",
  secondary: "bg-gray-200 active:bg-gray-300",
  outline: "bg-transparent border border-gray-300 active:bg-gray-100",
  ghost: "bg-transparent active:bg-gray-100",
  destructive: "bg-red-500 active:bg-red-600",
  success: "bg-green-500 active:bg-green-600",
};

const textVariantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "text-white font-semibold",
  secondary: "text-gray-900 font-medium",
  outline: "text-gray-900 font-medium",
  ghost: "text-gray-900 font-medium",
  destructive: "text-white font-semibold",
  success: "text-white font-semibold",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-3 py-2 rounded-md",
  md: "px-4 py-3 rounded-lg",
  lg: "px-6 py-4 rounded-xl",
};

const textSizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
};

export const Button = forwardRef<React.ElementRef<typeof TouchableOpacity>, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      className = "",
      children,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    const containerClasses =
      `flex-row items-center justify-center ${variantClasses[variant]} ${sizeClasses[size]} ${isDisabled ? "opacity-50" : ""} ${className}`.trim();
    const textClasses = `${textVariantClasses[variant]} ${textSizeClasses[size]}`.trim();

    return (
      <UniwindTouchableOpacity
        ref={ref}
        className={containerClasses}
        disabled={isDisabled}
        activeOpacity={0.7}
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
          <Text className={textClasses} numberOfLines={1}>
            {children}
          </Text>
        ) : (
          children
        )}
      </UniwindTouchableOpacity>
    );
  },
);

Button.displayName = "Button";
