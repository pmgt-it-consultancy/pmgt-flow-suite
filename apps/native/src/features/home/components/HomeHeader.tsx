import { Alert } from "react-native";
import { XStack, YStack } from "tamagui";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { IconButton, Text } from "../../shared/components/ui";

interface HomeHeaderProps {
  userName: string;
  roleName?: string;
  onLogout: () => void;
  onSettings: () => void;
  onOrderHistory: () => void;
  onDayClosing?: () => void;
}

export const HomeHeader = ({
  userName,
  roleName,
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
      backgroundColor="#FFFFFF"
      paddingHorizontal={20}
      paddingVertical={14}
      justifyContent="space-between"
      alignItems="center"
      borderBottomWidth={1}
      borderColor="#E2E8F0"
    >
      <XStack alignItems="center" gap={12}>
        {/* Avatar */}
        <YStack
          backgroundColor="#0D87E1"
          borderRadius={12}
          width={42}
          height={42}
          alignItems="center"
          justifyContent="center"
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 17,
              fontWeight: "700",
            }}
          >
            {userName.charAt(0).toUpperCase()}
          </Text>
        </YStack>
        <YStack>
          <Text
            style={{
              fontSize: 17,
              fontWeight: "700",
              color: "#0F172A",
              letterSpacing: -0.2,
            }}
          >
            {userName}
          </Text>
          {roleName && (
            <Text
              style={{
                fontSize: 13,
                fontWeight: "500",
                color: "#94A3B8",
                marginTop: 1,
              }}
            >
              {roleName}
            </Text>
          )}
        </YStack>
      </XStack>

      <XStack gap={6} alignItems="center">
        <SystemStatusBar />
        <IconButton icon="receipt-outline" onPress={onOrderHistory} />
        <IconButton icon="settings-outline" onPress={onSettings} />
        {onDayClosing && <IconButton icon="today-outline" onPress={onDayClosing} />}
        <IconButton icon="log-out-outline" variant="destructive" onPress={handleLogoutPress} />
      </XStack>
    </XStack>
  );
};
