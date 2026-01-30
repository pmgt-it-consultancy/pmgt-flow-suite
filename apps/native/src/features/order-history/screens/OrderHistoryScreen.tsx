import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from "uniwind/components";
import { useAuth } from "../../auth/context";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { Badge, Chip, IconButton, Text } from "../../shared/components/ui";
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

  const renderOrder = ({ item }: { item: NonNullable<typeof orders>[number] }) => {
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
      <TouchableOpacity
        className="bg-white mx-3 mb-2 p-4 rounded-xl border border-gray-100"
        activeOpacity={0.7}
        onPress={() => handleSelectOrder(item._id)}
      >
        <View className="flex-row justify-between items-start mb-2">
          <View className="flex-row items-center gap-2">
            <Text className="text-gray-900 font-bold text-base">#{item.orderNumber}</Text>
            <Badge variant={statusVariant}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Badge>
          </View>
          <Text className="text-gray-900 font-bold text-base">{formatCurrency(item.netSales)}</Text>
        </View>

        <View className="flex-row items-center gap-3">
          <View className="flex-row items-center gap-1">
            <Ionicons
              name={item.orderType === "dine_in" ? "restaurant-outline" : "bag-handle-outline"}
              size={14}
              color="#6B7280"
            />
            <Text variant="muted" size="sm">
              {orderTypeLabel}
            </Text>
          </View>

          {displayName ? (
            <Text variant="muted" size="sm">
              {displayName}
            </Text>
          ) : null}

          {paymentIcon ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name={paymentIcon as any} size={14} color="#6B7280" />
              <Text variant="muted" size="sm">
                {item.paymentMethod === "cash" ? "Cash" : "Card"}
              </Text>
            </View>
          ) : null}

          <Text variant="muted" size="sm">
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-gray-100">
      {/* Header */}
      <View className="bg-white flex-row items-center px-4 py-3 border-b border-gray-200">
        <IconButton icon="arrow-back" variant="ghost" onPress={handleBack} className="mr-2" />
        <View className="flex-1">
          <Text variant="heading" size="lg">
            Order History
          </Text>
        </View>
        <SystemStatusBar />
      </View>

      {/* Date Presets */}
      <View className="bg-white border-b border-gray-200 px-3 py-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {datePresets.map((preset) => (
              <Chip
                key={preset.key}
                selected={datePreset === preset.key}
                onPress={() => setDatePreset(preset.key)}
              >
                {preset.label}
              </Chip>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Search */}
      <View className="bg-white border-b border-gray-200 px-3 py-2">
        <View className="flex-row items-center bg-gray-100 rounded-lg px-3 py-2">
          <Ionicons name="search-outline" size={18} color="#9CA3AF" />
          <TextInput
            className="flex-1 ml-2 text-base text-gray-900"
            placeholder="Search by order # or customer name..."
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Status Filters */}
      <View className="bg-white border-b border-gray-200 px-3 py-2">
        <View className="flex-row gap-2">
          {statusFilters.map((filter) => (
            <Chip
              key={filter.key}
              selected={statusFilter === filter.key}
              onPress={() => setStatusFilter(filter.key)}
            >
              {filter.label}
            </Chip>
          ))}
        </View>
      </View>

      {/* Order List */}
      {orders === undefined ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#0D87E1" />
        </View>
      ) : orders.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Ionicons name="receipt-outline" size={48} color="#D1D5DB" />
          <Text variant="muted" className="mt-3 text-base">
            No orders found
          </Text>
          <Text variant="muted" size="sm" className="mt-1">
            Try adjusting your filters
          </Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          renderItem={renderOrder}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        />
      )}
    </View>
  );
};

export default OrderHistoryScreen;
