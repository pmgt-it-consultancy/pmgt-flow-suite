import type React from "react";
import { forwardRef } from "react";
import type { StyleProp, TextStyle } from "react-native";
import { SizableText, styled } from "tamagui";

const StyledText = styled(SizableText, {
  fontFamily: "$body",
  color: "$gray900",

  variants: {
    variant: {
      default: { color: "$gray900" },
      heading: { color: "$gray900", fontWeight: "600" },
      subheading: { color: "$gray600" },
      muted: { color: "$gray500" },
      error: { color: "$red500" },
      success: { color: "$green500" },
    },
    textSize: {
      xs: { fontSize: 12 },
      sm: { fontSize: 14 },
      base: { fontSize: 16 },
      lg: { fontSize: 18 },
      xl: { fontSize: 20 },
      "2xl": { fontSize: 24 },
      "3xl": { fontSize: 30 },
    },
  } as const,

  defaultVariants: {
    variant: "default",
    textSize: "base",
  },
});

type TextVariant = "default" | "heading" | "subheading" | "muted" | "error" | "success";
type TextSize = "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl";

interface TextProps {
  variant?: TextVariant;
  size?: TextSize;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
  numberOfLines?: number;
  ellipsizeMode?: "head" | "middle" | "tail" | "clip";
}

export const Text = forwardRef<React.ElementRef<typeof SizableText>, TextProps>(
  ({ variant = "default", size = "base", ...props }, ref) => {
    return <StyledText ref={ref} variant={variant} textSize={size} {...props} />;
  },
);

Text.displayName = "Text";
