import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { XStack, YStack } from "tamagui";
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
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#F3F4F6">
        <ActivityIndicator size="large" color="#0D87E1" />
      </YStack>
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
    <YStack flex={1} backgroundColor="#F3F4F6">
      <Header
        userName={user?.name ?? "User"}
        onBack={() => navigation.goBack()}
        onLogout={handleLogout}
        onSettings={() => navigation.navigate("SettingsScreen")}
        onOrderHistory={() => navigation.navigate("OrderHistoryScreen")}
      />

      {tables === undefined ? (
        <YStack flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator size="large" color="#0D87E1" />
        </YStack>
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
        <YStack
          flex={1}
          justifyContent="center"
          alignItems="center"
          backgroundColor="rgba(0,0,0,0.5)"
        >
          <YStack backgroundColor="#FFFFFF" borderRadius={16} padding={24} width={288}>
            <Text variant="heading" size="lg" style={{ textAlign: "center", marginBottom: 16 }}>
              Update Guest Count
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: "#D1D5DB",
                borderRadius: 8,
                paddingHorizontal: 16,
                paddingVertical: 12,
                textAlign: "center",
                fontSize: 18,
                marginBottom: 16,
              }}
              keyboardType="number-pad"
              placeholder="Number of guests"
              value={paxInput}
              onChangeText={setPaxInput}
              autoFocus
            />
            <XStack gap={12}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: "#E5E7EB",
                  borderRadius: 8,
                  paddingVertical: 12,
                }}
                onPress={() => {
                  setShowPaxModal(false);
                  setPaxOrderId(null);
                }}
              >
                <Text style={{ textAlign: "center", fontWeight: "600", color: "#374151" }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: "#0D87E1",
                  borderRadius: 8,
                  paddingVertical: 12,
                }}
                onPress={handlePaxConfirm}
              >
                <Text style={{ textAlign: "center", fontWeight: "600", color: "#FFFFFF" }}>
                  Confirm
                </Text>
              </TouchableOpacity>
            </XStack>
          </YStack>
        </YStack>
      </Modal>
    </YStack>
  );
};

export default TablesScreen;
