import { Alert } from "react-native";
import { XStack, YStack } from "tamagui";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { IconButton, Text } from "../../shared/components/ui";

interface HeaderProps {
  userName: string;
  onBack?: () => void;
  onLogout: () => void;
  onSettings: () => void;
  onOrderHistory: () => void;
}

export const Header = ({ userName, onBack, onLogout, onSettings, onOrderHistory }: HeaderProps) => {
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
            Hello, {userName}
          </Text>
          <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
            Select a table to get started
          </Text>
        </YStack>
      </XStack>
      <XStack gap={8} alignItems="center">
        <SystemStatusBar />
        <IconButton icon="receipt-outline" onPress={onOrderHistory} />
        <IconButton icon="settings-outline" onPress={onSettings} />
        <IconButton icon="log-out-outline" variant="destructive" onPress={handleLogoutPress} />
      </XStack>
    </XStack>
  );
};
