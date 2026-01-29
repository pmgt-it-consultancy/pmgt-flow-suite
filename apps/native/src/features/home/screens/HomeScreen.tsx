import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "uniwind/components";
import { useAuth } from "../../auth/context";
import { Button, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import { ActiveOrdersList, HomeHeader } from "../components";

interface HomeScreenProps {
  navigation: any;
}

export const HomeScreen = ({ navigation }: HomeScreenProps) => {
  const { user, signOut, isLoading, isAuthenticated } = useAuth();
  const formatCurrency = useFormatCurrency();
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const summary = useQuery(
    api.orders.getDashboardSummary,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  const activeOrders = useQuery(
    api.orders.listActive,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  const handleLogout = useCallback(async () => {
    await signOut();
    navigation.reset({
      index: 0,
      routes: [{ name: "LoginScreen" }],
    });
  }, [signOut, navigation]);

  if (isLoading || !isAuthenticated) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-100">
        <ActivityIndicator size="large" color="#0D87E1" />
      </View>
    );
  }

  const timeString = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateString = clock.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <View className="flex-1 bg-gray-100">
      <HomeHeader
        userName={user?.name ?? "User"}
        onLogout={handleLogout}
        onSettings={() => navigation.navigate("SettingsScreen")}
        onOrderHistory={() => navigation.navigate("OrderHistoryScreen")}
      />

      <View className="flex-1 p-6">
        {/* Clock & Date */}
        <View className="items-center mb-6">
          <Text className="text-4xl font-bold text-gray-900">{timeString}</Text>
          <Text variant="muted" size="base" className="mt-1">
            {dateString}
          </Text>
        </View>

        {/* Stats Row */}
        {summary ? (
          <View className="flex-row gap-3 mb-6">
            <View className="flex-1 bg-white rounded-xl p-4 items-center">
              <Text className="text-2xl font-bold text-blue-600">{summary.totalOrdersToday}</Text>
              <Text variant="muted" size="sm">
                Total Orders
              </Text>
            </View>
            <View className="flex-1 bg-white rounded-xl p-4 items-center">
              <Text className="text-2xl font-bold text-green-600">{summary.activeDineIn}</Text>
              <Text variant="muted" size="sm">
                Active Dine-In
              </Text>
            </View>
            <View className="flex-1 bg-white rounded-xl p-4 items-center">
              <Text className="text-2xl font-bold text-orange-600">{summary.activeTakeout}</Text>
              <Text variant="muted" size="sm">
                Active Takeout
              </Text>
            </View>
            <View className="flex-1 bg-white rounded-xl p-4 items-center">
              <Text className="text-2xl font-bold text-gray-900">
                {formatCurrency(summary.todayRevenue)}
              </Text>
              <Text variant="muted" size="sm">
                Today's Revenue
              </Text>
            </View>
          </View>
        ) : null}

        {/* Action Buttons */}
        <View className="flex-row gap-4 mb-6">
          <Button
            size="lg"
            variant="primary"
            className="flex-1 py-8 rounded-2xl"
            onPress={() => navigation.navigate("TablesScreen")}
          >
            <View className="items-center">
              <Ionicons name="restaurant-outline" size={32} color="#fff" />
              <Text className="text-white font-bold text-lg mt-2">Dine-In</Text>
            </View>
          </Button>

          <Button
            size="lg"
            variant="outline"
            className="flex-1 py-8 rounded-2xl border-2 border-orange-400 bg-orange-50"
            onPress={() => navigation.navigate("TakeoutListScreen")}
          >
            <View className="items-center">
              <Ionicons name="bag-handle-outline" size={32} color="#EA580C" />
              <Text className="text-orange-600 font-bold text-lg mt-2">Takeout</Text>
            </View>
          </Button>
        </View>

        {/* Active Orders Mini-List */}
        <View>
          <Text variant="heading" size="base" className="mb-3">
            Active Orders
          </Text>
          {activeOrders ? (
            <ActiveOrdersList orders={activeOrders} />
          ) : (
            <View className="items-center py-6">
              <ActivityIndicator size="small" color="#0D87E1" />
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

export default HomeScreen;
