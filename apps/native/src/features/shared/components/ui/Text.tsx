import type React from "react";
import { forwardRef } from "react";
import type { Text as RNText, TextProps as RNTextProps } from "react-native";
import { Text as UniwindText } from "uniwind/components";

interface TextProps extends RNTextProps {
  variant?: "default" | "heading" | "subheading" | "muted" | "error" | "success";
  size?: "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl";
  className?: string;
}

const variantClasses: Record<NonNullable<TextProps["variant"]>, string> = {
  default: "text-gray-900",
  heading: "text-gray-900 font-semibold",
  subheading: "text-gray-600",
  muted: "text-gray-500",
  error: "text-red-500",
  success: "text-green-500",
};

const sizeClasses: Record<NonNullable<TextProps["size"]>, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
};

export const Text = forwardRef<React.ElementRef<typeof RNText>, TextProps>(
  ({ variant = "default", size = "base", className = "", ...props }, ref) => {
    const classes = `${variantClasses[variant]} ${sizeClasses[size]} ${className}`.trim();
    return <UniwindText ref={ref} className={classes} {...props} />;
  },
);

Text.displayName = "Text";
