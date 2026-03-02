import { Alert } from "react-native";
import { XStack, YStack } from "tamagui";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { IconButton, Text } from "../../shared/components/ui";

interface HomeHeaderProps {
  userName: string;
  onLogout: () => void;
  onSettings: () => void;
  onOrderHistory: () => void;
  onDayClosing?: () => void;
}

export const HomeHeader = ({
  userName,
  onLogout,
  onSettings,
  onOrderHistory,
  onDayClosing,
}: HomeHeaderProps) => {
  const handleLogoutPress = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: onLogout,
      },
    ]);
  };

  return (
    <XStack
      backgroundColor="$white"
      paddingHorizontal={16}
      paddingVertical={16}
      justifyContent="space-between"
      alignItems="center"
      borderBottomWidth={1}
      borderColor="$gray200"
    >
      <YStack>
        <Text variant="heading" size="xl">
          Hello, {userName}
        </Text>
        <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
          What would you like to do?
        </Text>
      </YStack>
      <XStack gap={8} alignItems="center">
        <SystemStatusBar />
        <IconButton icon="receipt-outline" onPress={onOrderHistory} />
        <IconButton icon="settings-outline" onPress={onSettings} />
        {onDayClosing && <IconButton icon="today-outline" onPress={onDayClosing} />}
        <IconButton icon="log-out-outline" variant="destructive" onPress={handleLogoutPress} />
      </XStack>
    </XStack>
  );
};
