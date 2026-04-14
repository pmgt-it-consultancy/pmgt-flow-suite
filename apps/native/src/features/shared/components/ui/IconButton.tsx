import { Ionicons } from "@expo/vector-icons";
import type React from "react";
import { type ComponentProps, forwardRef } from "react";
import { Pressable } from "react-native-gesture-handler";

type IoniconsName = keyof typeof Ionicons.glyphMap;

interface IconButtonProps extends ComponentProps<typeof Pressable> {
  icon: IoniconsName;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "primary" | "ghost" | "destructive";
  iconColor?: string;
  className?: string;
}

const sizeConfig: Record<
  NonNullable<IconButtonProps["size"]>,
  { padding: number; iconSize: number }
> = {
  sm: { padding: 6, iconSize: 18 },
  md: { padding: 8, iconSize: 22 },
  lg: { padding: 12, iconSize: 26 },
};

const variantStyles: Record<
  NonNullable<IconButtonProps["variant"]>,
  { bg: string; radius: number }
> = {
  default: { bg: "#F3F4F6", radius: 9999 },
  primary: { bg: "#0D87E1", radius: 9999 },
  ghost: { bg: "transparent", radius: 0 },
  destructive: { bg: "#FEE2E2", radius: 9999 },
};

const defaultIconColors: Record<NonNullable<IconButtonProps["variant"]>, string> = {
  default: "#374151",
  primary: "#FFFFFF",
  ghost: "#374151",
  destructive: "#EF4444",
};

export const IconButton = forwardRef<React.ElementRef<typeof Pressable>, IconButtonProps>(
  (
    {
      icon,
      size = "md",
      variant = "default",
      iconColor,
      disabled,
      className: _className,
      style,
      ...props
    },
    ref,
  ) => {
    const cfg = sizeConfig[size];
    const v = variantStyles[variant];
    const color = iconColor ?? defaultIconColors[variant];

    return (
      <Pressable
        ref={ref}
        disabled={disabled}
        android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
        style={({ pressed }) => [
          {
            backgroundColor: v.bg,
            borderRadius: v.radius,
            padding: cfg.padding,
            opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
          },
          typeof style === "function" ? style({ pressed }) : style,
        ]}
        {...props}
      >
        <Ionicons name={icon} size={cfg.iconSize} color={color} />
      </Pressable>
    );
  },
);

IconButton.displayName = "IconButton";
