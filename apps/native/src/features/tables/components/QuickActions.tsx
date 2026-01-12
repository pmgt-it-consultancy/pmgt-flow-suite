import { Ionicons } from "@expo/vector-icons";
import { Alert } from "react-native";
import { TouchableOpacity, View } from "uniwind/components";
import { Text } from "../../shared/components/ui";

export const QuickActions = () => {
  const handleTakeout = () => {
    Alert.alert("Coming Soon", "Take-out orders will be available soon");
  };

  const handleDelivery = () => {
    Alert.alert("Coming Soon", "Delivery orders will be available soon");
  };

  return (
    <View className="flex-row bg-white p-3 border-t border-gray-200">
      <TouchableOpacity
        className="flex-1 flex-row items-center justify-center py-3 mx-1 bg-blue-50 rounded-lg"
        onPress={handleTakeout}
        activeOpacity={0.7}
      >
        <Ionicons name="bag-outline" size={20} color="#0D87E1" />
        <Text className="text-blue-500 font-medium ml-2">Take-out</Text>
      </TouchableOpacity>

      <TouchableOpacity
        className="flex-1 flex-row items-center justify-center py-3 mx-1 bg-blue-50 rounded-lg"
        onPress={handleDelivery}
        activeOpacity={0.7}
      >
        <Ionicons name="bicycle-outline" size={20} color="#0D87E1" />
        <Text className="text-blue-500 font-medium ml-2">Delivery</Text>
      </TouchableOpacity>
    </View>
  );
};
