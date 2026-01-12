import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { ActivityIndicator, FlatList, RefreshControl, View } from "uniwind/components";
import { useAuth } from "../../auth/context";
import { EmptyState, Header, QuickActions, TableCard } from "../components";

interface TablesScreenProps {
  navigation: any;
}

export const TablesScreen = ({ navigation }: TablesScreenProps) => {
  const { user, signOut, isLoading, isAuthenticated } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // Query tables for user's store
  const tables = useQuery(api.tables.list, user?.storeId ? { storeId: user.storeId } : "skip");

  // Query orders to check which tables have active orders
  const orders = useQuery(
    api.orders.listActive,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  // Create order mutation
  const createOrder = useMutation(api.orders.create);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRefreshing(false);
  }, []);

  const handleLogout = useCallback(async () => {
    await signOut();
    navigation.reset({
      index: 0,
      routes: [{ name: "LoginScreen" }],
    });
  }, [signOut, navigation]);

  const getTableOrderInfo = useCallback(
    (tableId: Id<"tables">) => {
      const order = orders?.find((o) => o.tableId === tableId);
      if (!order) return null;
      return {
        orderId: order._id,
        itemCount: order.itemCount,
        total: order.subtotal,
      };
    },
    [orders],
  );

  const handleSelectTable = useCallback(
    async (tableId: Id<"tables">, tableName: string) => {
      if (!user?.storeId) return;

      const orderInfo = getTableOrderInfo(tableId);

      if (orderInfo) {
        // Navigate to existing order
        navigation.navigate("OrderScreen", {
          orderId: orderInfo.orderId,
          tableId,
          tableName,
        });
      } else {
        // Ask to create new order
        Alert.alert("New Order", `Start a new order for ${tableName}?`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Start Order",
            onPress: async () => {
              try {
                const orderId = await createOrder({
                  storeId: user.storeId!,
                  tableId,
                  orderType: "dine_in",
                });
                navigation.navigate("OrderScreen", {
                  orderId,
                  tableId,
                  tableName,
                });
              } catch (error) {
                console.error("Create order error:", error);
                Alert.alert("Error", "Failed to create order");
              }
            },
          },
        ]);
      }
    },
    [user?.storeId, getTableOrderInfo, navigation, createOrder],
  );

  if (isLoading || !isAuthenticated) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-100">
        <ActivityIndicator size="large" color="#0D87E1" />
      </View>
    );
  }

  const renderTable = ({ item }: { item: NonNullable<typeof tables>[number] }) => {
    const orderInfo = getTableOrderInfo(item._id);

    return (
      <TableCard
        id={item._id}
        name={item.name}
        capacity={item.capacity}
        isOccupied={!!orderInfo}
        itemCount={orderInfo?.itemCount}
        total={orderInfo?.total}
        onPress={handleSelectTable}
      />
    );
  };

  return (
    <View className="flex-1 bg-gray-100">
      <Header userName={user?.name ?? "User"} onLogout={handleLogout} />

      {tables === undefined ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#0D87E1" />
        </View>
      ) : tables.length === 0 ? (
        <EmptyState title="No tables found" description="Add tables in the admin panel first" />
      ) : (
        <FlatList
          data={tables}
          renderItem={renderTable}
          keyExtractor={(item) => item._id}
          numColumns={2}
          contentContainerStyle={{ padding: 8 }}
          columnWrapperStyle={{ justifyContent: "space-between" }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        />
      )}

      <QuickActions />
    </View>
  );
};

export default TablesScreen;
