import type React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { YStack } from "tamagui";
import { Text } from "./Text";

interface CardProps {
  variant?: "default" | "outlined" | "elevated";
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const Card = ({ variant = "default", style, children }: CardProps) => {
  return (
    <YStack
      backgroundColor="#FFFFFF"
      borderRadius={12}
      padding={16}
      {...(variant === "outlined" && { borderWidth: 1, borderColor: "#E5E7EB" })}
      {...(variant === "elevated" && {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
      })}
      style={style}
    >
      {children}
    </YStack>
  );
};

interface CardHeaderProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const CardHeader = ({ style, children }: CardHeaderProps) => {
  return (
    <YStack marginBottom={12} style={style}>
      {children}
    </YStack>
  );
};

interface CardTitleProps {
  children: React.ReactNode;
}

export const CardTitle = ({ children }: CardTitleProps) => (
  <Text variant="heading" size="lg">
    {children}
  </Text>
);

interface CardDescriptionProps {
  children: React.ReactNode;
}

export const CardDescription = ({ children }: CardDescriptionProps) => (
  <Text variant="muted" size="sm">
    {children}
  </Text>
);

interface CardContentProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const CardContent = ({ style, children }: CardContentProps) => {
  return <YStack style={style}>{children}</YStack>;
};

interface CardFooterProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const CardFooter = ({ style, children }: CardFooterProps) => {
  return (
    <YStack marginTop={16} flexDirection="row" style={style}>
      {children}
    </YStack>
  );
};
