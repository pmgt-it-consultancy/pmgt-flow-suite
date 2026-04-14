import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, TextInput } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { PageHeader } from "../../shared/components/PageHeader";
import { Badge, Chip, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

type DatePreset = "today" | "yesterday" | "7d" | "30d";
type StatusFilter = "all" | "paid" | "voided";

interface OrderHistoryScreenProps {
  navigation: any;
}

function getDateRange(preset: DatePreset): { start: number; end: number } {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1;

  switch (preset) {
    case "today": {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return { start: startOfToday, end: endOfToday };
    }
    case "yesterday": {
      const startOfYesterday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
      ).getTime();
      const endOfYesterday =
        new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 1;
      return { start: startOfYesterday, end: endOfYesterday };
    }
    case "7d": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
      return { start, end: endOfToday };
    }
    case "30d": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();
      return { start, end: endOfToday };
    }
  }
}

export const OrderHistoryScreen = ({ navigation }: OrderHistoryScreenProps) => {
  const { user } = useAuth();
  const formatCurrency = useFormatCurrency();

  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const dateRange = useMemo(() => getDateRange(datePreset), [datePreset]);

  const orders = useQuery(
    api.orders.getOrderHistory,
    user?.storeId
      ? {
          storeId: user.storeId,
          startDate: dateRange.start,
          endDate: dateRange.end,
          search: searchQuery || undefined,
          status: statusFilter === "all" ? undefined : statusFilter,
        }
      : "skip",
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRefreshing(false);
  }, []);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleSelectOrder = useCallback(
    (orderId: Id<"orders">) => {
      navigation.navigate("OrderDetailScreen", { orderId });
    },
    [navigation],
  );

  const formatTime = useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("en-PH", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }, []);

  const datePresets: { key: DatePreset; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "7d", label: "Last 7 Days" },
    { key: "30d", label: "Last 30 Days" },
  ];

  const statusFilters: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "paid", label: "Paid" },
    { key: "voided", label: "Voided" },
  ];

  const renderOrder = useCallback(
    ({ item }: { item: NonNullable<typeof orders>[number] }) => {
      const orderTypeLabel = item.orderType === "dine_in" ? "Dine-In" : "Take-out";
      const displayName = item.tableName ?? item.customerName ?? "";
      const statusVariant =
        item.status === "paid" ? "success" : item.status === "voided" ? "error" : "default";
      const paymentIcon =
        item.paymentMethod === "cash"
          ? "cash-outline"
          : item.paymentMethod === "card_ewallet"
            ? "card-outline"
            : undefined;

      return (
        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          style={({ pressed }) => [
            {
              backgroundColor: "#FFFFFF",
              marginHorizontal: 12,
              marginBottom: 8,
              padding: 16,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#F3F4F6",
            },
            { opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={() => handleSelectOrder(item._id)}
        >
          <XStack justifyContent="space-between" alignItems="flex-start" marginBottom={8}>
            <XStack alignItems="center" gap={8}>
              <Text style={{ color: "#111827", fontWeight: "700", fontSize: 16 }}>
                #{item.orderNumber}
              </Text>
              <Badge variant={statusVariant}>
                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              </Badge>
            </XStack>
            <Text style={{ color: "#111827", fontWeight: "700", fontSize: 16 }}>
              {formatCurrency(item.netSales)}
            </Text>
          </XStack>

          <XStack alignItems="center" gap={12}>
            <XStack alignItems="center" gap={4}>
              <Ionicons
                name={item.orderType === "dine_in" ? "restaurant-outline" : "bag-handle-outline"}
                size={14}
                color="#6B7280"
              />
              <Text variant="muted" size="sm">
                {orderTypeLabel}
              </Text>
            </XStack>

            {displayName ? (
              <Text variant="muted" size="sm">
                {displayName}
              </Text>
            ) : null}

            {paymentIcon ? (
              <XStack alignItems="center" gap={4}>
                <Ionicons name={paymentIcon as any} size={14} color="#6B7280" />
                <Text variant="muted" size="sm">
                  {item.paymentMethod === "cash" ? "Cash" : "Card"}
                </Text>
              </XStack>
            ) : null}

            <Text variant="muted" size="sm">
              {formatTime(item.createdAt)}
            </Text>
          </XStack>
        </Pressable>
      );
    },
    [formatCurrency, handleSelectOrder, formatTime],
  );

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      <PageHeader title="Order History" onBack={handleBack} />

      {/* Date Presets */}
      <XStack
        backgroundColor="#FFFFFF"
        borderBottomWidth={1}
        borderColor="#E5E7EB"
        paddingHorizontal={12}
        paddingVertical={8}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <XStack gap={8}>
            {datePresets.map((preset) => (
              <Chip
                key={preset.key}
                selected={datePreset === preset.key}
                onPress={() => setDatePreset(preset.key)}
              >
                {preset.label}
              </Chip>
            ))}
          </XStack>
        </ScrollView>
      </XStack>

      {/* Search */}
      <YStack
        backgroundColor="#FFFFFF"
        borderBottomWidth={1}
        borderColor="#E5E7EB"
        paddingHorizontal={12}
        paddingVertical={8}
      >
        <XStack
          alignItems="center"
          backgroundColor="#F3F4F6"
          borderRadius={8}
          paddingHorizontal={12}
          paddingVertical={8}
        >
          <Ionicons name="search-outline" size={18} color="#9CA3AF" />
          <TextInput
            style={{ flex: 1, marginLeft: 8, fontSize: 16, color: "#111827" }}
            placeholder="Search by order # or customer name..."
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </Pressable>
          ) : null}
        </XStack>
      </YStack>

      {/* Status Filters */}
      <XStack
        backgroundColor="#FFFFFF"
        borderBottomWidth={1}
        borderColor="#E5E7EB"
        paddingHorizontal={12}
        paddingVertical={8}
      >
        <XStack gap={8}>
          {statusFilters.map((filter) => (
            <Chip
              key={filter.key}
              selected={statusFilter === filter.key}
              onPress={() => setStatusFilter(filter.key)}
            >
              {filter.label}
            </Chip>
          ))}
        </XStack>
      </XStack>

      {/* Order List */}
      {orders === undefined ? (
        <YStack flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator size="large" color="#0D87E1" />
        </YStack>
      ) : orders.length === 0 ? (
        <YStack flex={1} alignItems="center" justifyContent="center">
          <Ionicons name="receipt-outline" size={48} color="#D1D5DB" />
          <Text variant="muted" style={{ marginTop: 12, fontSize: 16 }}>
            No orders found
          </Text>
          <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
            Try adjusting your filters
          </Text>
        </YStack>
      ) : (
        <FlatList
          data={orders}
          renderItem={renderOrder}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        />
      )}
    </YStack>
  );
};

export default OrderHistoryScreen;
