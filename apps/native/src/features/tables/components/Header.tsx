import { XStack, YStack } from "tamagui";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { IconButton, Text } from "../../shared/components/ui";

interface HeaderProps {
  userName: string;
  onBack?: () => void;
}

export const Header = ({ userName, onBack }: HeaderProps) => {
  return (
    <XStack
      backgroundColor="#FFFFFF"
      paddingHorizontal={16}
      paddingVertical={16}
      justifyContent="space-between"
      alignItems="center"
      borderBottomWidth={1}
      borderBottomColor="#E5E7EB"
    >
      <XStack alignItems="center" gap={12}>
        {onBack ? <IconButton icon="arrow-back" onPress={onBack} /> : null}
        <YStack>
          <Text variant="heading" size="xl">
            Dine-In Tables
          </Text>
          <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
            {userName}
          </Text>
        </YStack>
      </XStack>
      <SystemStatusBar />
    </XStack>
  );
};
