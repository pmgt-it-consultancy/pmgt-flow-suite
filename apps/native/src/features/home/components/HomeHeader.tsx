import { Alert, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface HomeHeaderProps {
  userName: string;
  roleName?: string;
  onLogout: () => void;
  onLock?: () => void;
  showLockButton?: boolean;
  onSettings: () => void;
  onOrderHistory: () => void;
  onDayClosing?: () => void;
}

export const HomeHeader = ({
  userName,
  roleName,
  onLogout,
  onLock,
  showLockButton,
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

  const cleanedUserName = userName.replace(/\s*\([^)]*\)\s*/g, "").trim();
  const showRoleLine = roleName && !userName.includes("(");

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
            numberOfLines={1}
            style={{
              color: "#FFFFFF",
              fontSize: 17,
              fontWeight: "700",
            }}
          >
            {cleanedUserName.charAt(0).toUpperCase()}
          </Text>
        </YStack>
        <YStack>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 17,
              fontWeight: "700",
              color: "#0F172A",
              letterSpacing: -0.2,
            }}
          >
            {cleanedUserName}
          </Text>
          {showRoleLine && (
            <Text
              numberOfLines={1}
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

      <XStack gap={8} alignItems="center">
        <HeaderActionButton label="Past Orders" onPress={onOrderHistory} />
        <HeaderActionButton label="Settings" onPress={onSettings} />
        {onDayClosing && <HeaderActionButton label="Day Closing" onPress={onDayClosing} />}
        {showLockButton && onLock && <HeaderActionButton label="Lock" onPress={onLock} />}
        <HeaderActionButton label="Logout" onPress={handleLogoutPress} destructive />
      </XStack>
    </XStack>
  );
};

function HeaderActionButton({
  label,
  onPress,
  destructive,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress}>
      <YStack
        minWidth={74}
        paddingHorizontal={12}
        paddingVertical={10}
        borderRadius={12}
        alignItems="center"
        justifyContent="center"
        backgroundColor={destructive ? "#FEF2F2" : "#F8FAFC"}
        borderWidth={1}
        borderColor={destructive ? "#FECACA" : "#E2E8F0"}
      >
        <Text
          numberOfLines={1}
          style={{
            fontSize: 12,
            fontWeight: "700",
            color: destructive ? "#DC2626" : "#334155",
          }}
        >
          {label}
        </Text>
      </YStack>
    </TouchableOpacity>
  );
}
