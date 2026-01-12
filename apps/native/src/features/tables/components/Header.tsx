import { Alert } from "react-native";
import { View } from "uniwind/components";
import { IconButton, Text } from "../../shared/components/ui";

interface HeaderProps {
  userName: string;
  onLogout: () => void;
}

export const Header = ({ userName, onLogout }: HeaderProps) => {
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
      <IconButton icon="log-out-outline" variant="destructive" onPress={handleLogoutPress} />
    </View>
  );
};
