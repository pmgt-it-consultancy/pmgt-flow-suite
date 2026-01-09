import React from "react";
import { View } from "uniwind/components";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../shared/components/ui";

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
}

export const EmptyState = ({
  icon = "restaurant-outline",
  title,
  description,
}: EmptyStateProps) => {
  return (
    <View className="flex-1 justify-center items-center p-8">
      <Ionicons name={icon} size={64} color="#D1D5DB" />
      <Text variant="heading" size="lg" className="text-gray-500 mt-4">
        {title}
      </Text>
      {description && (
        <Text variant="muted" size="sm" className="mt-2 text-center">
          {description}
        </Text>
      )}
    </View>
  );
};
