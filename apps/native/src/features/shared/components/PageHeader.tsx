import type { ReactNode } from "react";
import { XStack, YStack } from "tamagui";
import { SystemStatusBar } from "./SystemStatusBar";
import { IconButton, Text } from "./ui";

interface PageHeaderProps {
  title?: string;
  subtitle?: string;
  titleContent?: ReactNode;
  onBack?: () => void;
  rightContent?: ReactNode;
  centerTitle?: boolean;
}

export const PageHeader = ({
  title,
  subtitle,
  titleContent,
  onBack,
  rightContent,
  centerTitle = false,
}: PageHeaderProps) => {
  return (
    <XStack
      backgroundColor="#FFFFFF"
      alignItems="center"
      paddingHorizontal={16}
      paddingVertical={14}
      borderBottomWidth={1}
      borderColor="#E5E7EB"
      gap={12}
    >
      {onBack ? <IconButton icon="arrow-back" variant="ghost" onPress={onBack} /> : null}
      <YStack flex={1} alignItems={centerTitle ? "center" : "flex-start"}>
        {titleContent ?? (
          <>
            {title ? (
              <Text variant="heading" size="lg" numberOfLines={1}>
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text variant="muted" size="sm" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </>
        )}
      </YStack>
      <XStack alignItems="center" gap={8}>
        {rightContent}
        <SystemStatusBar />
      </XStack>
    </XStack>
  );
};
