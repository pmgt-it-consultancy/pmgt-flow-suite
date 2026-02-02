import { Ionicons } from "@expo/vector-icons";
import { YStack } from "tamagui";
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
    <YStack flex={1} justifyContent="center" alignItems="center" padding={32}>
      <Ionicons name={icon} size={64} color="#D1D5DB" />
      <Text variant="heading" size="lg" style={{ color: "#6B7280", marginTop: 16 }}>
        {title}
      </Text>
      {description && (
        <Text variant="muted" size="sm" style={{ marginTop: 8, textAlign: "center" }}>
          {description}
        </Text>
      )}
    </YStack>
  );
};
