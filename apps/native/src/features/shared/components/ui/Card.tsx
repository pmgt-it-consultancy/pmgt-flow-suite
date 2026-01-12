import type React from "react";
import { forwardRef } from "react";
import type { View, ViewProps } from "react-native";
import { View as UniwindView } from "uniwind/components";
import { Text } from "./Text";

interface CardProps extends ViewProps {
  variant?: "default" | "outlined" | "elevated";
  className?: string;
}

const variantClasses: Record<NonNullable<CardProps["variant"]>, string> = {
  default: "bg-white rounded-xl p-4",
  outlined: "bg-white rounded-xl p-4 border border-gray-200",
  elevated: "bg-white rounded-xl p-4 shadow-md",
};

export const Card = forwardRef<React.ElementRef<typeof View>, CardProps>(
  ({ variant = "default", className = "", ...props }, ref) => {
    const classes = `${variantClasses[variant]} ${className}`.trim();
    return <UniwindView ref={ref} className={classes} {...props} />;
  },
);

Card.displayName = "Card";

interface CardHeaderProps extends ViewProps {
  className?: string;
}

export const CardHeader = forwardRef<React.ElementRef<typeof View>, CardHeaderProps>(
  ({ className = "", ...props }, ref) => {
    return <UniwindView ref={ref} className={`mb-3 ${className}`.trim()} {...props} />;
  },
);

CardHeader.displayName = "CardHeader";

interface CardTitleProps {
  children: React.ReactNode;
  className?: string;
}

export const CardTitle = ({ children, className = "" }: CardTitleProps) => (
  <Text variant="heading" size="lg" className={className}>
    {children}
  </Text>
);

interface CardDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export const CardDescription = ({ children, className = "" }: CardDescriptionProps) => (
  <Text variant="muted" size="sm" className={className}>
    {children}
  </Text>
);

interface CardContentProps extends ViewProps {
  className?: string;
}

export const CardContent = forwardRef<React.ElementRef<typeof View>, CardContentProps>(
  ({ className = "", ...props }, ref) => {
    return <UniwindView ref={ref} className={className} {...props} />;
  },
);

CardContent.displayName = "CardContent";

interface CardFooterProps extends ViewProps {
  className?: string;
}

export const CardFooter = forwardRef<React.ElementRef<typeof View>, CardFooterProps>(
  ({ className = "", ...props }, ref) => {
    return <UniwindView ref={ref} className={`mt-4 flex-row ${className}`.trim()} {...props} />;
  },
);

CardFooter.displayName = "CardFooter";
