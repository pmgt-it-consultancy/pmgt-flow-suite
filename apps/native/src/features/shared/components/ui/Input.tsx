import type React from "react";
import { forwardRef } from "react";
import type { TextInput, TextInputProps } from "react-native";
import { TextInput as UniwindTextInput, View } from "uniwind/components";
import { Text } from "./Text";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  className?: string;
}

export const Input = forwardRef<React.ElementRef<typeof TextInput>, InputProps>(
  ({ label, error, leftIcon, rightIcon, className = "", ...props }, ref) => {
    const inputClasses = `flex-1 text-base text-gray-900 ${className}`.trim();
    const containerClasses = `flex-row items-center bg-white border ${error ? "border-red-500" : "border-gray-300"} rounded-lg px-4 py-3`;

    return (
      <View className="w-full">
        {label && (
          <Text variant="default" size="sm" className="mb-2 font-medium">
            {label}
          </Text>
        )}
        <View className={containerClasses}>
          {leftIcon && <View className="mr-3">{leftIcon}</View>}
          <UniwindTextInput
            ref={ref}
            className={inputClasses}
            placeholderTextColor="#9CA3AF"
            {...props}
          />
          {rightIcon && <View className="ml-3">{rightIcon}</View>}
        </View>
        {error && (
          <Text variant="error" size="sm" className="mt-1">
            {error}
          </Text>
        )}
      </View>
    );
  },
);

Input.displayName = "Input";
