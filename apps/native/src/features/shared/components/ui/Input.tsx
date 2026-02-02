import type React from "react";
import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { XStack, YStack } from "tamagui";
import { Text } from "./Text";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  className?: string;
}

export const Input = forwardRef<React.ElementRef<typeof TextInput>, InputProps>(
  ({ label, error, leftIcon, rightIcon, className: _className, style, ...props }, ref) => {
    return (
      <YStack width="100%">
        {label && (
          <Text variant="default" size="sm" style={{ marginBottom: 8, fontWeight: "500" }}>
            {label}
          </Text>
        )}
        <XStack
          alignItems="center"
          backgroundColor="$white"
          borderWidth={1}
          borderColor={error ? "$red500" : "$gray300"}
          borderRadius="$2"
          paddingHorizontal="$4"
          paddingVertical="$3"
        >
          {leftIcon && <YStack marginRight={12}>{leftIcon}</YStack>}
          <TextInput
            ref={ref}
            style={[{ flex: 1, fontSize: 16, color: "#111827" }, style as any]}
            placeholderTextColor="#9CA3AF"
            {...props}
          />
          {rightIcon && <YStack marginLeft={12}>{rightIcon}</YStack>}
        </XStack>
        {error && (
          <Text variant="error" size="sm" style={{ marginTop: 4 }}>
            {error}
          </Text>
        )}
      </YStack>
    );
  },
);

Input.displayName = "Input";
