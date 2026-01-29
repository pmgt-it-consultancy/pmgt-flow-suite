import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "uniwind/components";
import { useAuth } from "../../auth/context";
import { Button, IconButton, Text } from "../../shared/components/ui";
import { TakeoutOrderCard } from "../components";

type TakeoutStatus = "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";

const NEXT_STATUS: Partial<Record<TakeoutStatus, TakeoutStatus>> = {
  pending: "preparing",
  preparing: "ready_for_pickup",
  ready_for_pickup: "completed",
};

interface TakeoutListScreenProps {
  navigation: any;
}

export const TakeoutListScreen = ({ navigation }: TakeoutListScreenProps) => {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const takeoutOrders = useQuery(
    api.orders.getTakeoutOrders,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  const updateStatus = useMutation(api.orders.updateTakeoutStatus);

  const { activeOrders, completedOrders } = useMemo(() => {
    if (!takeoutOrders) return { activeOrders: [], completedOrders: [] };
    return {
      activeOrders: takeoutOrders.filter(
        (o) => o.takeoutStatus && !["completed", "cancelled"].includes(o.takeoutStatus),
      ),
      completedOrders: takeoutOrders.filter(
        (o) => o.takeoutStatus && ["completed", "cancelled"].includes(o.takeoutStatus),
      ),
    };
  }, [takeoutOrders]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRefreshing(false);
  }, []);

  const handleAdvanceStatus = useCallback(
    async (orderId: Id<"orders">, currentStatus: TakeoutStatus) => {
      const nextStatus = NEXT_STATUS[currentStatus];
      if (!nextStatus) return;
      try {
        await updateStatus({ orderId, newStatus: nextStatus });
      } catch (error: any) {
        console.error("Update takeout status error:", error);
      }
    },
    [updateStatus],
  );

  const handleNewOrder = useCallback(() => {
    if (!user?.storeId) return;
    navigation.navigate("TakeoutOrderScreen", { storeId: user.storeId });
  }, [user?.storeId, navigation]);

  return (
    <View className="flex-1 bg-gray-100">
      {/* Header */}
      <View className="bg-white px-4 py-4 flex-row justify-between items-center border-b border-gray-200">
        <View className="flex-row items-center gap-3">
          <IconButton icon="arrow-back" onPress={() => navigation.goBack()} />
          <View>
            <Text variant="heading" size="lg">
              Takeout Orders
            </Text>
            <Text variant="muted" size="sm">
              Today's takeout orders
            </Text>
          </View>
        </View>
        <Button size="md" onPress={handleNewOrder}>
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="add" size={20} color="#fff" />
            <Text className="text-white font-semibold">New Order</Text>
          </View>
        </Button>
      </View>

      {takeoutOrders === undefined ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#0D87E1" />
        </View>
      ) : (
        <FlatList
          data={[...activeOrders, ...completedOrders]}
          keyExtractor={(item) => item._id}
          renderItem={({ item, index }) => (
            <View>
              {/* Section headers */}
              {index === 0 && activeOrders.length > 0 ? (
                <Text variant="heading" size="sm" className="px-4 pt-4 pb-2">
                  Active ({activeOrders.length})
                </Text>
              ) : null}
              {index === activeOrders.length && completedOrders.length > 0 ? (
                <Text variant="heading" size="sm" className="px-4 pt-4 pb-2">
                  Completed ({completedOrders.length})
                </Text>
              ) : null}
              <View className="px-4">
                <TakeoutOrderCard
                  id={item._id}
                  orderNumber={item.orderNumber}
                  customerName={item.customerName}
                  takeoutStatus={item.takeoutStatus as TakeoutStatus | undefined}
                  netSales={item.netSales}
                  itemCount={item.itemCount}
                  createdAt={item.createdAt}
                  onAdvanceStatus={handleAdvanceStatus}
                />
              </View>
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-16">
              <Ionicons name="bag-handle-outline" size={48} color="#D1D5DB" />
              <Text variant="muted" className="mt-3">
                No takeout orders today
              </Text>
              <Button size="md" className="mt-4" onPress={handleNewOrder}>
                Create First Order
              </Button>
            </View>
          }
        />
      )}
    </View>
  );
};

export default TakeoutListScreen;
