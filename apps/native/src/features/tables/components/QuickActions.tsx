import { Ionicons } from "@expo/vector-icons";
import { Alert, TouchableOpacity } from "react-native";
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
      <TouchableOpacity
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 12,
          marginHorizontal: 4,
          backgroundColor: "#EFF6FF",
          borderRadius: 8,
        }}
        onPress={handleTakeout}
        activeOpacity={0.7}
      >
        <Ionicons name="bag-outline" size={20} color="#0D87E1" />
        <Text style={{ color: "#0D87E1", fontWeight: "500", marginLeft: 8 }}>Take-out</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 12,
          marginHorizontal: 4,
          backgroundColor: "#EFF6FF",
          borderRadius: 8,
        }}
        onPress={handleDelivery}
        activeOpacity={0.7}
      >
        <Ionicons name="bicycle-outline" size={20} color="#0D87E1" />
        <Text style={{ color: "#0D87E1", fontWeight: "500", marginLeft: 8 }}>Delivery</Text>
      </TouchableOpacity>
    </XStack>
  );
};
