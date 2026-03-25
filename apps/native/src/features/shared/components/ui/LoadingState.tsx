import { ActivityIndicator } from "react-native";
import { YStack } from "tamagui";
import { Text } from "./Text";

interface LoadingStateProps {
  title?: string;
  description?: string;
  fullHeight?: boolean;
}

export const LoadingState = ({
  title = "Loading...",
  description,
  fullHeight = false,
}: LoadingStateProps) => {
  return (
    <YStack
      flex={fullHeight ? 1 : undefined}
      minHeight={fullHeight ? undefined : 180}
      alignItems="center"
      justifyContent="center"
      paddingHorizontal={24}
      paddingVertical={32}
      gap={12}
    >
      <ActivityIndicator size="large" color="#0D87E1" />
      <YStack alignItems="center" gap={4}>
        <Text style={{ color: "#111827", fontWeight: "600", fontSize: 16, textAlign: "center" }}>
          {title}
        </Text>
        {description ? (
          <Text
            variant="muted"
            size="sm"
            style={{ textAlign: "center", maxWidth: 280, lineHeight: 20 }}
          >
            {description}
          </Text>
        ) : null}
      </YStack>
    </YStack>
  );
};
