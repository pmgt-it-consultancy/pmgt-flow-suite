import { Ionicons } from "@expo/vector-icons";
import { Alert } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack } from "tamagui";
import { Text } from "../../shared/components/ui";

export const QuickActions = () => {
  const handleTakeout = () => {
    Alert.alert("Coming Soon", "Take-out orders will be available soon");
  };

  const handleDelivery = () => {
    Alert.alert("Coming Soon", "Delivery orders will be available soon");
  };

  return (
    <XStack backgroundColor="#FFFFFF" padding={12} borderTopWidth={1} borderTopColor="#E5E7EB">
      <Pressable
        android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
        style={({ pressed }) => [
          {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 16,
            marginHorizontal: 6,
            backgroundColor: "#EFF6FF",
            borderRadius: 10,
            minHeight: 52,
          },
          { opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={handleTakeout}
      >
        <Ionicons name="bag-outline" size={22} color="#0D87E1" />
        <Text style={{ color: "#0D87E1", fontWeight: "600", marginLeft: 10, fontSize: 15 }}>
          Take-out
        </Text>
      </Pressable>

      <Pressable
        android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
        style={({ pressed }) => [
          {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 16,
            marginHorizontal: 6,
            backgroundColor: "#EFF6FF",
            borderRadius: 10,
            minHeight: 52,
          },
          { opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={handleDelivery}
      >
        <Ionicons name="bicycle-outline" size={22} color="#0D87E1" />
        <Text style={{ color: "#0D87E1", fontWeight: "600", marginLeft: 10, fontSize: 15 }}>
          Delivery
        </Text>
      </Pressable>
    </XStack>
  );
};
