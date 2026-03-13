import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { useLockStore } from "../../lock/stores/useLockStore";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import { ActiveOrdersList, HomeHeader } from "../components";

interface HomeScreenProps {
  navigation: any;
}

export const HomeScreen = ({ navigation }: HomeScreenProps) => {
  const { user, signOut, isLoading, isAuthenticated } = useAuth();
  const formatCurrency = useFormatCurrency();
  const [clock, setClock] = useState(new Date());
  const lockScreen = useLockStore((state) => state.lock);
  const screenLockMutation = useMutation(api.screenLock.screenLock);

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
  const userHasPin = useQuery(
    api.screenLock.getUserHasPin,
    user?._id ? { userId: user._id } : "skip",
  );

  const handleLogout = useCallback(async () => {
    await signOut();
    navigation.reset({
      index: 0,
      routes: [{ name: "LoginScreen" }],
    });
  }, [signOut, navigation]);

  const handleLock = useCallback(async () => {
    if (!user?._id || !user.storeId) {
      return;
    }

    if (!userHasPin) {
      Alert.alert(
        "PIN Required",
        "You need to set a PIN before you can lock the screen. Go to Settings to set one.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Go to Settings", onPress: () => navigation.navigate("SettingsScreen") },
        ],
      );
      return;
    }

    lockScreen({
      userId: user._id,
      userName: user.name ?? "User",
      userRole: user.role?.name ?? "Staff",
    });
    screenLockMutation({ storeId: user.storeId, trigger: "manual" }).catch(() => {});
  }, [lockScreen, navigation, screenLockMutation, user, userHasPin]);

  if (isLoading || !isAuthenticated) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#F1F5F9">
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

  const dineInCount = activeOrders?.filter((o) => o.orderType === "dine_in").length ?? 0;
  const takeoutCount = activeOrders?.filter((o) => o.orderType === "takeout").length ?? 0;

  return (
    <YStack flex={1} backgroundColor="#F1F5F9">
      <HomeHeader
        userName={user?.name ?? "User"}
        roleName={user?.role?.name}
        onLogout={handleLogout}
        onLock={handleLock}
        showLockButton={!!userHasPin}
        onSettings={() => navigation.navigate("SettingsScreen")}
        onOrderHistory={() => navigation.navigate("OrderHistoryScreen")}
        onDayClosing={
          user?.role?.permissions?.includes("reports.print_eod")
            ? () => navigation.navigate("DayClosingScreen")
            : undefined
        }
      />

      <YStack flex={1} padding={16} gap={14}>
        {/* Unified Stats Bar */}
        <XStack
          backgroundColor="#FFFFFF"
          borderRadius={14}
          paddingVertical={14}
          paddingHorizontal={8}
          alignItems="center"
          shadowColor="#000"
          shadowOffset={{ width: 0, height: 1 }}
          shadowOpacity={0.05}
          shadowRadius={3}
          elevation={1}
        >
          {/* Clock */}
          <YStack
            alignItems="center"
            justifyContent="center"
            paddingHorizontal={20}
            borderRightWidth={1}
            borderColor="#E2E8F0"
          >
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 0,
                fontSize: 44,
                lineHeight: 50,
                fontWeight: "700",
                color: "#0F172A",
                letterSpacing: -1,
              }}
            >
              {timeString}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 13,
                lineHeight: 18,
                color: "#94A3B8",
                fontWeight: "500",
                letterSpacing: 0.3,
              }}
            >
              {dateString}
            </Text>
          </YStack>

          {/* Stats */}
          {summary ? (
            <XStack flex={1} paddingLeft={8}>
              <StatItem
                value={summary.totalOrdersToday.toString()}
                label="Orders"
                color="#0D87E1"
                bgColor="#EFF6FF"
              />
              <StatItem
                value={summary.activeDineIn.toString()}
                label="Dine-In"
                color="#059669"
                bgColor="#ECFDF5"
              />
              <StatItem
                value={summary.activeTakeout.toString()}
                label="Takeout"
                color="#EA580C"
                bgColor="#FFF7ED"
              />
              <StatItem
                value={formatCurrency(summary.todayRevenue)}
                label="Revenue"
                color="#0F172A"
                bgColor="#F8FAFC"
                isLast
              />
            </XStack>
          ) : (
            <XStack flex={1} justifyContent="center" paddingVertical={10}>
              <ActivityIndicator size="small" color="#94A3B8" />
            </XStack>
          )}
        </XStack>

        {/* Main Content: Actions + Orders */}
        <XStack flex={1} gap={14}>
          {/* Action Buttons */}
          <YStack width={280} gap={12}>
            {/* Dine-In Button */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate("TablesScreen")}
              style={{ flex: 1 }}
            >
              <YStack
                flex={1}
                backgroundColor="#0D87E1"
                borderRadius={16}
                padding={20}
                justifyContent="space-between"
                shadowColor="#0D87E1"
                shadowOffset={{ width: 0, height: 4 }}
                shadowOpacity={0.2}
                shadowRadius={8}
                elevation={3}
              >
                <XStack justifyContent="space-between" alignItems="flex-start">
                  <YStack
                    backgroundColor="rgba(255,255,255,0.2)"
                    borderRadius={14}
                    width={52}
                    height={52}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Ionicons name="restaurant-outline" size={28} color="#FFFFFF" />
                  </YStack>
                  {dineInCount > 0 && (
                    <YStack
                      backgroundColor="rgba(255,255,255,0.25)"
                      borderRadius={20}
                      paddingHorizontal={14}
                      paddingVertical={6}
                    >
                      <Text
                        style={{
                          color: "#FFFFFF",
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                      >
                        {dineInCount} active
                      </Text>
                    </YStack>
                  )}
                </XStack>
                <YStack>
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 22,
                      fontWeight: "700",
                      letterSpacing: -0.3,
                    }}
                  >
                    Dine-In
                  </Text>
                  <Text
                    style={{
                      color: "rgba(255,255,255,0.7)",
                      fontSize: 14,
                      fontWeight: "500",
                      marginTop: 2,
                    }}
                  >
                    Manage tables
                  </Text>
                </YStack>
              </YStack>
            </TouchableOpacity>

            {/* Takeout Button */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate("TakeoutListScreen")}
              style={{ flex: 1 }}
            >
              <YStack
                flex={1}
                backgroundColor="#FFF7ED"
                borderRadius={16}
                borderWidth={1.5}
                borderColor="#FDBA74"
                padding={20}
                justifyContent="space-between"
                shadowColor="#EA580C"
                shadowOffset={{ width: 0, height: 2 }}
                shadowOpacity={0.08}
                shadowRadius={6}
                elevation={2}
              >
                <XStack justifyContent="space-between" alignItems="flex-start">
                  <YStack
                    backgroundColor="#FED7AA"
                    borderRadius={14}
                    width={52}
                    height={52}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Ionicons name="bag-handle-outline" size={28} color="#EA580C" />
                  </YStack>
                  {takeoutCount > 0 && (
                    <YStack
                      backgroundColor="#FFEDD5"
                      borderRadius={20}
                      paddingHorizontal={14}
                      paddingVertical={6}
                    >
                      <Text
                        style={{
                          color: "#C2410C",
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                      >
                        {takeoutCount} active
                      </Text>
                    </YStack>
                  )}
                </XStack>
                <YStack>
                  <Text
                    style={{
                      color: "#9A3412",
                      fontSize: 22,
                      fontWeight: "700",
                      letterSpacing: -0.3,
                    }}
                  >
                    Takeout
                  </Text>
                  <Text
                    style={{
                      color: "#C2410C",
                      fontSize: 14,
                      fontWeight: "500",
                      marginTop: 2,
                    }}
                  >
                    New & pending orders
                  </Text>
                </YStack>
              </YStack>
            </TouchableOpacity>
          </YStack>

          {/* Active Orders Panel */}
          <YStack
            flex={1}
            backgroundColor="#FFFFFF"
            borderRadius={16}
            shadowColor="#000"
            shadowOffset={{ width: 0, height: 1 }}
            shadowOpacity={0.05}
            shadowRadius={3}
            elevation={1}
          >
            {/* Panel Header */}
            <XStack
              paddingHorizontal={18}
              paddingVertical={14}
              alignItems="center"
              justifyContent="space-between"
              borderBottomWidth={1}
              borderColor="#F1F5F9"
            >
              <XStack alignItems="center" gap={8}>
                <YStack
                  backgroundColor="#EFF6FF"
                  borderRadius={8}
                  width={32}
                  height={32}
                  alignItems="center"
                  justifyContent="center"
                >
                  <Ionicons name="receipt-outline" size={17} color="#0D87E1" />
                </YStack>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "700",
                    color: "#0F172A",
                    letterSpacing: -0.2,
                  }}
                >
                  Active Orders
                </Text>
              </XStack>
              {activeOrders && (
                <YStack
                  backgroundColor="#F1F5F9"
                  borderRadius={12}
                  paddingHorizontal={10}
                  paddingVertical={4}
                >
                  <Text style={{ fontSize: 13, fontWeight: "600", color: "#64748B" }}>
                    {activeOrders.length} total
                  </Text>
                </YStack>
              )}
            </XStack>

            {/* Orders List */}
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

/* ── Stat Item ── */
function StatItem({
  value,
  label,
  color,
  bgColor,
  isLast,
}: {
  value: string;
  label: string;
  color: string;
  bgColor: string;
  isLast?: boolean;
}) {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      paddingVertical={6}
      borderRightWidth={isLast ? 0 : 1}
      borderColor="#E2E8F0"
    >
      <YStack
        backgroundColor={bgColor}
        borderRadius={10}
        paddingHorizontal={12}
        paddingVertical={4}
        marginBottom={4}
      >
        <Text
          numberOfLines={1}
          style={{
            fontSize: 26,
            lineHeight: 32,
            fontWeight: "800",
            color,
            letterSpacing: -0.5,
            flexShrink: 0,
          }}
        >
          {value}
        </Text>
      </YStack>
      <Text
        numberOfLines={1}
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: "#94A3B8",
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {label}
      </Text>
    </YStack>
  );
}

export default HomeScreen;
