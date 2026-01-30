import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { Alert, TextInput } from "react-native";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,
  TouchableOpacity,
  View,
} from "uniwind/components";
import { useAuth } from "../../auth/context";
import { Text } from "../../shared/components/ui";
import { EmptyState, Header, TableCard } from "../components";

interface TablesScreenProps {
  navigation: any;
}

export const TablesScreen = ({ navigation }: TablesScreenProps) => {
  const { user, signOut, isLoading, isAuthenticated } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [showPaxModal, setShowPaxModal] = useState(false);
  const [paxInput, setPaxInput] = useState("");
  const [paxOrderId, setPaxOrderId] = useState<Id<"orders"> | null>(null);
  const updatePaxMutation = useMutation(api.orders.updatePax);

  // Query tables for user's store
  const tables = useQuery(api.tables.list, user?.storeId ? { storeId: user.storeId } : "skip");

  // Query orders to check which tables have active orders
  const orders = useQuery(
    api.orders.listActive,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

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
        pax: order.pax,
      };
    },
    [orders],
  );

  const handleUpdatePax = useCallback(
    (tableId: Id<"tables">) => {
      const orderInfo = getTableOrderInfo(tableId);
      if (!orderInfo) return;
      setPaxOrderId(orderInfo.orderId);
      setPaxInput(orderInfo.pax?.toString() ?? "");
      setShowPaxModal(true);
    },
    [getTableOrderInfo],
  );

  const handlePaxConfirm = useCallback(async () => {
    const pax = parseInt(paxInput, 10);
    if (!pax || pax < 1) {
      Alert.alert("Invalid", "Please enter a valid number of guests");
      return;
    }
    if (!paxOrderId) return;
    setShowPaxModal(false);
    try {
      await updatePaxMutation({ orderId: paxOrderId, pax });
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to update PAX");
    }
    setPaxOrderId(null);
  }, [paxInput, paxOrderId, updatePaxMutation]);

  const handleSelectTable = useCallback(
    (tableId: Id<"tables">, tableName: string) => {
      if (!user?.storeId) return;

      const orderInfo = getTableOrderInfo(tableId);

      if (orderInfo) {
        // Navigate to existing order
        navigation.navigate("OrderScreen", {
          orderId: orderInfo.orderId,
          tableId,
          tableName,
          storeId: user.storeId,
        });
      } else {
        // Navigate to draft mode (no order created yet)
        navigation.navigate("OrderScreen", {
          tableId,
          tableName,
          storeId: user.storeId,
        });
      }
    },
    [user?.storeId, getTableOrderInfo, navigation],
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
        pax={orderInfo?.pax}
        onPress={handleSelectTable}
        onUpdatePax={orderInfo ? handleUpdatePax : undefined}
      />
    );
  };

  return (
    <View className="flex-1 bg-gray-100">
      <Header
        userName={user?.name ?? "User"}
        onBack={() => navigation.goBack()}
        onLogout={handleLogout}
        onSettings={() => navigation.navigate("SettingsScreen")}
        onOrderHistory={() => navigation.navigate("OrderHistoryScreen")}
      />

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

      {/* PAX Update Modal */}
      <Modal
        visible={showPaxModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowPaxModal(false);
          setPaxOrderId(null);
        }}
      >
        <View className="flex-1 justify-center items-center bg-black/50">
          <View className="bg-white rounded-2xl p-6 w-72">
            <Text variant="heading" size="lg" className="text-center mb-4">
              Update Guest Count
            </Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-center text-lg mb-4"
              keyboardType="number-pad"
              placeholder="Number of guests"
              value={paxInput}
              onChangeText={setPaxInput}
              autoFocus
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 bg-gray-200 rounded-lg py-3"
                onPress={() => {
                  setShowPaxModal(false);
                  setPaxOrderId(null);
                }}
              >
                <Text className="text-center font-semibold text-gray-700">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-blue-500 rounded-lg py-3"
                onPress={handlePaxConfirm}
              >
                <Text className="text-center font-semibold text-white">Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default TablesScreen;
