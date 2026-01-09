import React from "react";
import { View } from "uniwind/components";
import { Text, IconButton } from "../../shared/components/ui";

interface OrderHeaderProps {
  title: string;
  subtitle: string;
  onBack: () => void;
}

export const OrderHeader = ({ title, subtitle, onBack }: OrderHeaderProps) => {
  return (
    <View className="bg-white flex-row items-center px-4 py-3 border-b border-gray-200">
      <IconButton
        icon="arrow-back"
        variant="ghost"
        onPress={onBack}
        className="mr-2"
      />
      <View className="flex-1">
        <Text variant="heading" size="lg">
          {title}
        </Text>
        <Text variant="muted" size="sm">
          {subtitle}
        </Text>
      </View>
    </View>
  );
};
