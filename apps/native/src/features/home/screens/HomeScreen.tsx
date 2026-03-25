import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [isLocking, setIsLocking] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
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
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await signOut();
      navigation.reset({
        index: 0,
        routes: [{ name: "LoginScreen" }],
      });
    } catch {
      setIsLoggingOut(false);
    }
  }, [isLoggingOut, navigation, signOut]);

  const handleLock = useCallback(async () => {
    if (!user?._id || !user.storeId || isLocking) return;

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

    setIsLocking(true);
    lockScreen({
      userId: user._id,
      userName: user.name ?? "User",
      userRole: user.role?.name ?? "Staff",
    });
    screenLockMutation({ storeId: user.storeId, trigger: "manual" }).catch(() => {});
  }, [isLocking, lockScreen, navigation, screenLockMutation, user, userHasPin]);

  if (isLoading || !isAuthenticated) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#EDF3F7">
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

  const dineInCount = activeOrders?.filter((order) => order.orderType === "dine_in").length ?? 0;
  const takeoutCount = activeOrders?.filter((order) => order.orderType === "takeout").length ?? 0;
  const totalOrders = activeOrders?.length ?? 0;
  const averageTicket =
    summary && summary.totalOrdersToday > 0
      ? summary.todayRevenue / summary.totalOrdersToday
      : null;
  const permissions = user?.role?.permissions ?? [];
  const canUseDayClose = permissions.includes("reports.print_eod");

  return (
    <YStack flex={1} backgroundColor="#EDF3F7">
      <HomeHeader
        userName={user?.name ?? "User"}
        roleName={user?.role?.name}
        onLogout={handleLogout}
        onLock={handleLock}
        showLockButton={!!userHasPin}
        onSettings={() => navigation.navigate("SettingsScreen")}
        onOrderHistory={() => navigation.navigate("OrderHistoryScreen")}
        onDayClosing={canUseDayClose ? () => navigation.navigate("DayClosingScreen") : undefined}
      />

      <YStack flex={1} padding={16} gap={14}>
        <YStack
          borderRadius={20}
          padding={16}
          backgroundColor="#FFFFFF"
          borderWidth={1}
          borderColor="#DCE7EF"
          shadowColor="#0F172A"
          shadowOffset={{ width: 0, height: 6 }}
          shadowOpacity={0.08}
          shadowRadius={14}
          elevation={3}
        >
          <XStack gap={14} alignItems="stretch">
            <YStack
              width={230}
              borderRadius={18}
              paddingHorizontal={18}
              paddingVertical={16}
              justifyContent="center"
              backgroundColor="#0F172A"
            >
              <YStack gap={6}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    fontWeight: "700",
                    color: "rgba(255,255,255,0.72)",
                    textTransform: "uppercase",
                    letterSpacing: 1.2,
                  }}
                >
                  Current Time
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 52,
                    lineHeight: 58,
                    color: "#FFFFFF",
                    fontWeight: "800",
                    letterSpacing: -1.8,
                  }}
                >
                  {timeString}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 15,
                    lineHeight: 20,
                    color: "rgba(255,255,255,0.72)",
                    fontWeight: "600",
                    letterSpacing: 0.2,
                  }}
                >
                  {dateString}
                </Text>
              </YStack>
            </YStack>

            {summary ? (
              <XStack flex={1} gap={12}>
                <ScoreCard
                  value={summary.totalOrdersToday.toString()}
                  label="Orders"
                  detail={`${totalOrders} active now`}
                  tint="#E8F3FE"
                  valueColor="#0D87E1"
                  icon="receipt-outline"
                />
                <ScoreCard
                  value={summary.activeDineIn.toString()}
                  label="Dine-In"
                  detail={dineInCount > 0 ? `${dineInCount} tables busy` : "Ready for seating"}
                  tint="#ECFDF5"
                  valueColor="#059669"
                  icon="restaurant-outline"
                />
                <ScoreCard
                  value={summary.activeTakeout.toString()}
                  label="Takeout"
                  detail={takeoutCount > 0 ? `${takeoutCount} waiting` : "No pending pickup"}
                  tint="#FFF2E8"
                  valueColor="#EA580C"
                  icon="bag-handle-outline"
                />
                <RevenueCard
                  value={formatCurrency(summary.todayRevenue)}
                  average={averageTicket ? formatCurrency(averageTicket) : null}
                />
              </XStack>
            ) : (
              <YStack
                flex={1}
                alignItems="center"
                justifyContent="center"
                borderRadius={18}
                backgroundColor="#F8FBFD"
                borderWidth={1}
                borderColor="#E2E8F0"
              >
                <ActivityIndicator size="small" color="#0D87E1" />
              </YStack>
            )}
          </XStack>
        </YStack>

        <XStack flex={1} gap={14}>
          <YStack width={320} gap={12}>
            <ActionPanel
              title="Dine-In"
              subtitle="Open tables and manage dine-in orders"
              icon="restaurant-outline"
              accent="#0D87E1"
              accentSoft="#E8F3FE"
              accentText="#FFFFFF"
              badgeText={dineInCount > 0 ? `${dineInCount} active` : "Ready"}
              badgeBg="rgba(255,255,255,0.16)"
              footerLabel={dineInCount > 0 ? "View active tables" : "Open tables"}
              onPress={() => navigation.navigate("TablesScreen")}
              filled
            />

            <ActionPanel
              title="Takeout"
              subtitle="Create and manage takeout orders"
              icon="bag-handle-outline"
              accent="#EA580C"
              accentSoft="#FFF7ED"
              accentText="#9A3412"
              badgeText={takeoutCount > 0 ? `${takeoutCount} active` : "Open lane"}
              badgeBg="#FFE7D6"
              footerLabel={takeoutCount > 0 ? "View takeout orders" : "Create takeout order"}
              onPress={() => navigation.navigate("TakeoutListScreen")}
            />
          </YStack>

          <YStack
            flex={1}
            backgroundColor="#FFFFFF"
            borderRadius={20}
            borderWidth={1}
            borderColor="#DCE7EF"
            overflow="hidden"
            shadowColor="#0F172A"
            shadowOffset={{ width: 0, height: 4 }}
            shadowOpacity={0.06}
            shadowRadius={12}
            elevation={2}
          >
            <YStack
              paddingHorizontal={18}
              paddingTop={18}
              paddingBottom={14}
              backgroundColor="#F8FBFD"
              borderBottomWidth={1}
              borderColor="#E2E8F0"
            >
              <XStack justifyContent="space-between" alignItems="center">
                <XStack alignItems="center" gap={10}>
                  <YStack
                    backgroundColor="#E8F3FE"
                    borderRadius={12}
                    width={40}
                    height={40}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Ionicons name="receipt-outline" size={20} color="#0D87E1" />
                  </YStack>
                  <YStack gap={2}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 22,
                        color: "#0F172A",
                        fontWeight: "800",
                        letterSpacing: -0.5,
                      }}
                    >
                      Active Orders
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 13,
                        color: "#64748B",
                        fontWeight: "500",
                      }}
                    >
                      Open dine-in and takeout orders.
                    </Text>
                  </YStack>
                </XStack>

                <YStack
                  backgroundColor="#EEF5FA"
                  borderRadius={999}
                  paddingHorizontal={12}
                  paddingVertical={6}
                >
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#476174" }}>
                    {totalOrders} total
                  </Text>
                </YStack>
              </XStack>

              <XStack gap={18} marginTop={14} alignItems="center">
                <HeaderStat label="Dine-In" value={String(dineInCount)} color="#1D4ED8" />
                <HeaderStat label="Takeout" value={String(takeoutCount)} color="#C2410C" />
                <HeaderStat label="Open Orders" value={String(totalOrders)} color="#334155" />
              </XStack>
            </YStack>

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

function ScoreCard({
  value,
  label,
  detail,
  tint,
  valueColor,
  icon,
}: {
  value: string;
  label: string;
  detail: string;
  tint: string;
  valueColor: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <YStack
      flex={1}
      borderRadius={18}
      padding={16}
      backgroundColor={tint}
      justifyContent="space-between"
      minHeight={132}
    >
      <XStack justifyContent="space-between" alignItems="center">
        <YStack
          width={42}
          height={42}
          borderRadius={14}
          backgroundColor="rgba(255,255,255,0.78)"
          alignItems="center"
          justifyContent="center"
        >
          <Ionicons name={icon} size={20} color={valueColor} />
        </YStack>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 12,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 1.1,
            color: "#64748B",
          }}
        >
          {label}
        </Text>
      </XStack>

      <YStack gap={4}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 34,
            lineHeight: 38,
            fontWeight: "800",
            color: valueColor,
            letterSpacing: -1,
          }}
        >
          {value}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 13, color: "#516274", fontWeight: "600" }}>
          {detail}
        </Text>
      </YStack>
    </YStack>
  );
}

function RevenueCard({ value, average }: { value: string; average: string | null }) {
  return (
    <YStack
      flex={1.2}
      borderRadius={18}
      padding={16}
      backgroundColor="#F8FBFD"
      borderWidth={1}
      borderColor="#E2E8F0"
      minHeight={132}
      justifyContent="space-between"
    >
      <XStack justifyContent="space-between" alignItems="center">
        <YStack>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 12,
              fontWeight: "700",
              textTransform: "uppercase",
              letterSpacing: 1.1,
              color: "#64748B",
            }}
          >
            Revenue
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: 13, color: "#64748B", fontWeight: "500", marginTop: 3 }}
          >
            Net sales today
          </Text>
        </YStack>
        <YStack
          width={42}
          height={42}
          borderRadius={14}
          backgroundColor="#0F172A"
          alignItems="center"
          justifyContent="center"
        >
          <Ionicons name="cash-outline" size={20} color="#FFFFFF" />
        </YStack>
      </XStack>

      <YStack gap={10}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 34,
            lineHeight: 38,
            fontWeight: "800",
            color: "#0F172A",
            letterSpacing: -1.1,
          }}
        >
          {value}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 13, color: "#516274", fontWeight: "600" }}>
          Avg ticket: {average ?? "--"}
        </Text>
      </YStack>
    </YStack>
  );
}

function ActionPanel({
  title,
  subtitle,
  icon,
  accent,
  accentSoft,
  accentText,
  badgeText,
  badgeBg,
  footerLabel,
  onPress,
  filled,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  accentSoft: string;
  accentText: string;
  badgeText: string;
  badgeBg: string;
  footerLabel: string;
  onPress: () => void;
  filled?: boolean;
}) {
  const backgroundColor = filled ? accent : accentSoft;
  const titleColor = filled ? "#FFFFFF" : accentText;
  const subtitleColor = filled ? "rgba(255,255,255,0.74)" : "#C2410C";
  const iconBg = filled ? "rgba(255,255,255,0.16)" : "#FFE2CC";
  const iconColor = filled ? "#FFFFFF" : accent;
  const footerBg = filled ? "rgba(255,255,255,0.1)" : "#FFF1E7";
  const footerColor = filled ? "rgba(255,255,255,0.82)" : "#9A3412";

  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={{ flex: 1 }}>
      <YStack
        flex={1}
        backgroundColor={backgroundColor}
        borderRadius={20}
        padding={20}
        justifyContent="space-between"
        borderWidth={filled ? 0 : 1.5}
        borderColor={filled ? accent : "#FDBA74"}
        shadowColor={accent}
        shadowOffset={{ width: 0, height: 6 }}
        shadowOpacity={filled ? 0.24 : 0.1}
        shadowRadius={10}
        elevation={filled ? 4 : 2}
      >
        <XStack justifyContent="space-between" alignItems="flex-start">
          <YStack
            backgroundColor={iconBg}
            borderRadius={16}
            width={58}
            height={58}
            alignItems="center"
            justifyContent="center"
          >
            <Ionicons name={icon} size={28} color={iconColor} />
          </YStack>

          <YStack
            backgroundColor={badgeBg}
            borderRadius={999}
            paddingHorizontal={14}
            paddingVertical={7}
          >
            <Text
              numberOfLines={1}
              style={{
                color: titleColor,
                fontSize: 14,
                fontWeight: "800",
              }}
            >
              {badgeText}
            </Text>
          </YStack>
        </XStack>

        <YStack gap={14}>
          <YStack gap={4}>
            <Text
              numberOfLines={1}
              style={{
                color: titleColor,
                fontSize: 28,
                lineHeight: 32,
                fontWeight: "800",
                letterSpacing: -0.6,
              }}
            >
              {title}
            </Text>
            <Text
              numberOfLines={2}
              style={{
                color: subtitleColor,
                fontSize: 15,
                lineHeight: 20,
                fontWeight: "600",
              }}
            >
              {subtitle}
            </Text>
          </YStack>

          <XStack
            backgroundColor={footerBg}
            borderRadius={14}
            paddingHorizontal={12}
            paddingVertical={10}
            justifyContent="space-between"
            alignItems="center"
          >
            <Text
              numberOfLines={1}
              style={{ flex: 1, fontSize: 13, fontWeight: "700", color: footerColor }}
            >
              {footerLabel}
            </Text>
            <Ionicons name="arrow-forward-outline" size={18} color={filled ? "#FFFFFF" : accent} />
          </XStack>
        </YStack>
      </YStack>
    </TouchableOpacity>
  );
}

function HeaderStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <YStack>
      <Text
        numberOfLines={1}
        style={{ fontSize: 11, fontWeight: "700", color: "#94A3B8", textTransform: "uppercase" }}
      >
        {label}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "800", color, marginTop: 3 }}>
        {value}
      </Text>
    </YStack>
  );
}

export default HomeScreen;
