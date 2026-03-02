import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
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
        onDayClosing={
          user?.role?.permissions?.includes("reports.print_eod")
            ? () => navigation.navigate("DayClosingScreen")
            : undefined
        }
      />

      <YStack flex={1} padding={16} gap={12}>
        {/* Clock & Stats Row */}
        <XStack alignItems="center" gap={12}>
          {/* Clock */}
          <YStack
            backgroundColor="$white"
            borderRadius={12}
            paddingVertical={16}
            paddingHorizontal={28}
            alignItems="center"
            justifyContent="center"
            borderWidth={1}
            borderColor="$gray200"
          >
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 0,
                fontSize: 56,
                lineHeight: 64,
                fontWeight: "700",
                color: "#111827",
              }}
            >
              {timeString}
            </Text>
            <Text
              variant="muted"
              numberOfLines={1}
              style={{ fontSize: 15, lineHeight: 20, letterSpacing: 0.5 }}
            >
              {dateString}
            </Text>
          </YStack>

          {/* Stats */}
          {summary ? (
            <XStack flex={1} gap={10}>
              <YStack
                flex={1}
                backgroundColor="$white"
                borderRadius={12}
                paddingVertical={14}
                paddingHorizontal={10}
                alignItems="center"
                justifyContent="center"
                borderWidth={1}
                borderColor="$gray200"
              >
                <Text style={{ fontSize: 32, lineHeight: 38, fontWeight: "700", color: "#0B6FBA" }}>
                  {summary.totalOrdersToday}
                </Text>
                <Text variant="muted" style={{ fontSize: 13, lineHeight: 18 }}>
                  Orders
                </Text>
              </YStack>
              <YStack
                flex={1}
                backgroundColor="$white"
                borderRadius={12}
                paddingVertical={14}
                paddingHorizontal={10}
                alignItems="center"
                justifyContent="center"
                borderWidth={1}
                borderColor="$gray200"
              >
                <Text style={{ fontSize: 32, lineHeight: 38, fontWeight: "700", color: "#16A34A" }}>
                  {summary.activeDineIn}
                </Text>
                <Text variant="muted" style={{ fontSize: 13, lineHeight: 18 }}>
                  Dine-In
                </Text>
              </YStack>
              <YStack
                flex={1}
                backgroundColor="$white"
                borderRadius={12}
                paddingVertical={14}
                paddingHorizontal={10}
                alignItems="center"
                justifyContent="center"
                borderWidth={1}
                borderColor="$gray200"
              >
                <Text style={{ fontSize: 32, lineHeight: 38, fontWeight: "700", color: "#EA580C" }}>
                  {summary.activeTakeout}
                </Text>
                <Text variant="muted" style={{ fontSize: 13, lineHeight: 18 }}>
                  Takeout
                </Text>
              </YStack>
              <YStack
                flex={1}
                backgroundColor="$white"
                borderRadius={12}
                paddingVertical={14}
                paddingHorizontal={10}
                alignItems="center"
                justifyContent="center"
                borderWidth={1}
                borderColor="$gray200"
              >
                <Text style={{ fontSize: 32, lineHeight: 38, fontWeight: "700", color: "#111827" }}>
                  {formatCurrency(summary.todayRevenue)}
                </Text>
                <Text variant="muted" style={{ fontSize: 13, lineHeight: 18 }}>
                  Revenue
                </Text>
              </YStack>
            </XStack>
          ) : null}
        </XStack>

        {/* Action Buttons + Active Orders — fill all remaining space */}
        <XStack flex={1} gap={12}>
          {/* Action Buttons — take up left portion */}
          <YStack flex={1} gap={12}>
            <Button
              size="lg"
              variant="primary"
              style={{ flex: 1, borderRadius: 14, justifyContent: "center", alignItems: "center" }}
              onPress={() => navigation.navigate("TablesScreen")}
            >
              <YStack alignItems="center" gap={8}>
                <Ionicons name="restaurant-outline" size={40} color="#fff" />
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 20 }}>Dine-In</Text>
              </YStack>
            </Button>

            <Button
              size="lg"
              variant="outline"
              style={{
                flex: 1,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: "#FB923C",
                backgroundColor: "#FFF7ED",
                justifyContent: "center",
                alignItems: "center",
              }}
              onPress={() => navigation.navigate("TakeoutListScreen")}
            >
              <YStack alignItems="center" gap={8}>
                <Ionicons name="bag-handle-outline" size={40} color="#EA580C" />
                <Text style={{ color: "#EA580C", fontWeight: "700", fontSize: 20 }}>Takeout</Text>
              </YStack>
            </Button>
          </YStack>

          {/* Active Orders — take up right portion */}
          <YStack flex={2}>
            <Text variant="heading" size="base" style={{ marginBottom: 8 }}>
              Active Orders
            </Text>
            {activeOrders ? (
              <ActiveOrdersList orders={activeOrders} />
            ) : (
              <YStack flex={1} alignItems="center" justifyContent="center">
                <ActivityIndicator size="small" color="#0D87E1" />
              </YStack>
            )}
          </YStack>
        </XStack>
      </YStack>
    </YStack>
  );
};

export default HomeScreen;
