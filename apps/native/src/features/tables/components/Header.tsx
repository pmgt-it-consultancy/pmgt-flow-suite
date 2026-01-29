import { Alert } from "react-native";
import { View } from "uniwind/components";
import { IconButton, Text } from "../../shared/components/ui";

interface HeaderProps {
  userName: string;
  onLogout: () => void;
  onSettings: () => void;
}

export const Header = ({ userName, onLogout, onSettings }: HeaderProps) => {
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
    <View className="bg-white px-4 py-4 flex-row justify-between items-center border-b border-gray-200">
      <View>
        <Text variant="heading" size="xl">
          Hello, {userName}
        </Text>
        <Text variant="muted" size="sm" className="mt-1">
          Select a table to get started
        </Text>
      </View>
      <View className="flex-row gap-2">
        <IconButton icon="settings-outline" onPress={onSettings} />
        <IconButton icon="log-out-outline" variant="destructive" onPress={handleLogoutPress} />
      </View>
    </View>
  );
};
