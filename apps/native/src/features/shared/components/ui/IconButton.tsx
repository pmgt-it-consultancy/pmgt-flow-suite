import React, { forwardRef } from "react";
import { TouchableOpacity as UniwindTouchableOpacity } from "uniwind/components";
import { TouchableOpacity, TouchableOpacityProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type IoniconsName = keyof typeof Ionicons.glyphMap;

interface IconButtonProps extends TouchableOpacityProps {
  icon: IoniconsName;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "primary" | "ghost" | "destructive";
  iconColor?: string;
  className?: string;
}

const sizeConfig: Record<NonNullable<IconButtonProps["size"]>, { padding: string; iconSize: number }> = {
  sm: { padding: "p-1.5", iconSize: 18 },
  md: { padding: "p-2", iconSize: 22 },
  lg: { padding: "p-3", iconSize: 26 },
};

const variantClasses: Record<NonNullable<IconButtonProps["variant"]>, string> = {
  default: "bg-gray-100 rounded-full",
  primary: "bg-blue-500 rounded-full",
  ghost: "bg-transparent",
  destructive: "bg-red-100 rounded-full",
};

const defaultIconColors: Record<NonNullable<IconButtonProps["variant"]>, string> = {
  default: "#374151",
  primary: "#FFFFFF",
  ghost: "#374151",
  destructive: "#EF4444",
};

export const IconButton = forwardRef<React.ElementRef<typeof TouchableOpacity>, IconButtonProps>(
  (
    {
      icon,
      size = "md",
      variant = "default",
      iconColor,
      disabled,
      className = "",
      ...props
    },
    ref
  ) => {
    const config = sizeConfig[size];
    const classes = `${variantClasses[variant]} ${config.padding} ${disabled ? "opacity-50" : ""} ${className}`.trim();
    const color = iconColor ?? defaultIconColors[variant];

    return (
      <UniwindTouchableOpacity
        ref={ref}
        className={classes}
        disabled={disabled}
        activeOpacity={0.7}
        {...props}
      >
        <Ionicons name={icon} size={config.iconSize} color={color} />
      </UniwindTouchableOpacity>
    );
  }
);

IconButton.displayName = "IconButton";
