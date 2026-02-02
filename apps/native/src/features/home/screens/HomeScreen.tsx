import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { XStack, YStack } from "tamagui";
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
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="$gray100">
        <ActivityIndicator size="large" color="#0D87E1" />
      </YStack>
    );
  }

  const timeString = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateString = clock.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <YStack flex={1} backgroundColor="$gray100">
      <HomeHeader
        userName={user?.name ?? "User"}
        onLogout={handleLogout}
        onSettings={() => navigation.navigate("SettingsScreen")}
        onOrderHistory={() => navigation.navigate("OrderHistoryScreen")}
      />

      <YStack flex={1} padding={24}>
        {/* Clock & Date */}
        <YStack alignItems="center" marginBottom={24}>
          <Text style={{ fontSize: 36, fontWeight: "700", color: "#111827" }}>{timeString}</Text>
          <Text variant="muted" size="base" style={{ marginTop: 4 }}>
            {dateString}
          </Text>
        </YStack>

        {/* Stats Row */}
        {summary ? (
          <XStack gap={12} marginBottom={24}>
            <YStack
              flex={1}
              backgroundColor="$white"
              borderRadius={12}
              padding={16}
              alignItems="center"
            >
              <Text style={{ fontSize: 24, fontWeight: "700", color: "#0B6FBA" }}>
                {summary.totalOrdersToday}
              </Text>
              <Text variant="muted" size="sm">
                Total Orders
              </Text>
            </YStack>
            <YStack
              flex={1}
              backgroundColor="$white"
              borderRadius={12}
              padding={16}
              alignItems="center"
            >
              <Text style={{ fontSize: 24, fontWeight: "700", color: "#16A34A" }}>
                {summary.activeDineIn}
              </Text>
              <Text variant="muted" size="sm">
                Active Dine-In
              </Text>
            </YStack>
            <YStack
              flex={1}
              backgroundColor="$white"
              borderRadius={12}
              padding={16}
              alignItems="center"
            >
              <Text style={{ fontSize: 24, fontWeight: "700", color: "#EA580C" }}>
                {summary.activeTakeout}
              </Text>
              <Text variant="muted" size="sm">
                Active Takeout
              </Text>
            </YStack>
            <YStack
              flex={1}
              backgroundColor="$white"
              borderRadius={12}
              padding={16}
              alignItems="center"
            >
              <Text style={{ fontSize: 24, fontWeight: "700", color: "#111827" }}>
                {formatCurrency(summary.todayRevenue)}
              </Text>
              <Text variant="muted" size="sm">
                Today's Revenue
              </Text>
            </YStack>
          </XStack>
        ) : null}

        {/* Action Buttons */}
        <XStack gap={16} marginBottom={24}>
          <Button
            size="lg"
            variant="primary"
            style={{ flex: 1, paddingVertical: 32, borderRadius: 16 }}
            onPress={() => navigation.navigate("TablesScreen")}
          >
            <YStack alignItems="center">
              <Ionicons name="restaurant-outline" size={32} color="#fff" />
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 18, marginTop: 8 }}>
                Dine-In
              </Text>
            </YStack>
          </Button>

          <Button
            size="lg"
            variant="outline"
            style={{
              flex: 1,
              paddingVertical: 32,
              borderRadius: 16,
              borderWidth: 2,
              borderColor: "#FB923C",
              backgroundColor: "#FFF7ED",
            }}
            onPress={() => navigation.navigate("TakeoutListScreen")}
          >
            <YStack alignItems="center">
              <Ionicons name="bag-handle-outline" size={32} color="#EA580C" />
              <Text style={{ color: "#EA580C", fontWeight: "700", fontSize: 18, marginTop: 8 }}>
                Takeout
              </Text>
            </YStack>
          </Button>
        </XStack>

        {/* Active Orders Mini-List */}
        <YStack>
          <Text variant="heading" size="base" style={{ marginBottom: 12 }}>
            Active Orders
          </Text>
          {activeOrders ? (
            <ActiveOrdersList orders={activeOrders} />
          ) : (
            <YStack alignItems="center" paddingVertical={24}>
              <ActivityIndicator size="small" color="#0D87E1" />
            </YStack>
          )}
        </YStack>
      </YStack>
    </YStack>
  );
};

export default HomeScreen;
