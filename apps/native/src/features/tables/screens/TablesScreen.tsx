import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import * as Crypto from "expo-crypto";
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
import { TabSelectionModal } from "../components/TabSelectionModal";

interface TablesScreenProps {
  navigation: any;
}

export const TablesScreen = ({ navigation }: TablesScreenProps) => {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [showPaxModal, setShowPaxModal] = useState(false);
  const [paxInput, setPaxInput] = useState("");
  const [paxOrderId, setPaxOrderId] = useState<Id<"orders"> | null>(null);
  const [selectedTable, setSelectedTable] = useState<{
    id: Id<"tables">;
    name: string;
    orders: Array<{
      _id: Id<"orders">;
      orderNumber: string;
      tabNumber: number;
      tabName: string;
      itemCount: number;
      netSales: number;
      pax?: number;
      createdAt: number;
    }>;
  } | null>(null);
  const [isCreatingTab, setIsCreatingTab] = useState(false);
  const [isUpdatingPax, setIsUpdatingPax] = useState(false);
  const updatePaxMutation = useMutation(api.orders.updatePax);
  const createOrderMutation = useMutation(api.orders.create);

  // Query tables with multi-tab order information
  const tablesWithOrders = useQuery(
    api.tables.listWithOrders,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRefreshing(false);
  }, []);

  const getTableInfo = useCallback(
    (tableId: Id<"tables">) => {
      return tablesWithOrders?.find((t) => t._id === tableId);
    },
    [tablesWithOrders],
  );

  const handleUpdatePax = useCallback(
    (tableId: Id<"tables">) => {
      const tableInfo = getTableInfo(tableId);
      if (!tableInfo || tableInfo.orders.length === 0) return;
      // For multi-tab tables, update pax for the first order (could be enhanced to select which tab)
      const firstOrder = tableInfo.orders[0];
      setPaxOrderId(firstOrder._id);
      setPaxInput(firstOrder.pax?.toString() ?? "");
      setShowPaxModal(true);
    },
    [getTableInfo],
  );

  const handlePaxConfirm = useCallback(async () => {
    const pax = parseInt(paxInput, 10);
    if (!pax || pax < 1) {
      Alert.alert("Invalid", "Please enter a valid number of guests");
      return;
    }
    if (!paxOrderId || isUpdatingPax) return;
    setIsUpdatingPax(true);
    setShowPaxModal(false);
    try {
      await updatePaxMutation({ orderId: paxOrderId, pax });
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to update PAX");
    } finally {
      setIsUpdatingPax(false);
      setPaxOrderId(null);
    }
  }, [paxInput, paxOrderId, updatePaxMutation, isUpdatingPax]);

  const handleSelectTable = useCallback(
    (tableId: Id<"tables">, tableName: string) => {
      if (!user?.storeId) return;

      const tableInfo = getTableInfo(tableId);

      if (tableInfo && tableInfo.orders.length > 0) {
        // Table has active orders
        if (tableInfo.orders.length === 1) {
          // Single tab: Navigate directly to the order
          navigation.navigate("OrderScreen", {
            orderId: tableInfo.orders[0]._id,
            tableId,
            tableName,
            storeId: user.storeId,
          });
        } else {
          // Multiple tabs: Show tab selection modal
          setSelectedTable({
            id: tableId,
            name: tableName,
            orders: tableInfo.orders,
          });
        }
      } else {
        // No active orders: Navigate to draft mode
        navigation.navigate("OrderScreen", {
          tableId,
          tableName,
          storeId: user.storeId,
        });
      }
    },
    [user?.storeId, getTableInfo, navigation],
  );

  const handleSelectOrder = useCallback(
    (orderId: Id<"orders">) => {
      if (!user?.storeId || !selectedTable) return;

      // Capture values before clearing state
      const tableId = selectedTable.id;
      const tableName = selectedTable.name;
      const storeId = user.storeId;

      // Close modal
      setSelectedTable(null);

      // Navigate
      navigation.navigate("OrderScreen", {
        orderId,
        tableId,
        tableName,
        storeId,
      });
    },
    [user?.storeId, selectedTable, navigation],
  );

  const handleAddNewTab = useCallback(async () => {
    if (!user?.storeId || !selectedTable || isCreatingTab) return;

    const tableId = selectedTable.id;
    const tableName = selectedTable.name;
    const storeId = user.storeId;

    setIsCreatingTab(true);
    setSelectedTable(null);

    try {
      const orderId = await createOrderMutation({
        storeId,
        orderType: "dine_in",
        tableId,
        pax: 1,
        requestId: Crypto.randomUUID(),
      });

      navigation.navigate("OrderScreen", {
        orderId,
        tableId,
        tableName,
        storeId,
      });
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to create new tab");
    } finally {
      setIsCreatingTab(false);
    }
  }, [user?.storeId, selectedTable, createOrderMutation, navigation, isCreatingTab]);

  if (isLoading || !isAuthenticated) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#F3F4F6">
        <ActivityIndicator size="large" color="#0D87E1" />
      </YStack>
    );
  }

  const renderTable = useCallback(
    ({ item }: { item: NonNullable<typeof tablesWithOrders>[number] }) => {
      const isOccupied = item.orders.length > 0;

      return (
        <TableCard
          id={item._id}
          name={item.name}
          capacity={item.capacity ?? 0}
          isOccupied={isOccupied}
          orders={item.orders}
          totalTabs={item.totalTabs}
          totalItemCount={item.totalItemCount}
          totalNetSales={item.totalNetSales}
          onPress={handleSelectTable}
          onUpdatePax={isOccupied ? handleUpdatePax : undefined}
        />
      );
    },
    [handleSelectTable, handleUpdatePax],
  );

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      <Header userName={user?.name ?? "User"} onBack={() => navigation.goBack()} />

      {tablesWithOrders === undefined ? (
        <YStack flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator size="large" color="#0D87E1" />
        </YStack>
      ) : tablesWithOrders.length === 0 ? (
        <EmptyState title="No tables found" description="Add tables in the admin panel first" />
      ) : (
        <FlatList
          data={tablesWithOrders}
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
                disabled={isUpdatingPax}
                style={{
                  flex: 1,
                  backgroundColor: isUpdatingPax ? "#93C5FD" : "#0D87E1",
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

      {/* Tab Selection Modal */}
      {selectedTable && (
        <TabSelectionModal
          visible={!!selectedTable}
          onClose={() => setSelectedTable(null)}
          tableName={selectedTable.name}
          orders={selectedTable.orders}
          onSelectOrder={handleSelectOrder}
          onAddNewTab={handleAddNewTab}
          isCreating={isCreatingTab}
        />
      )}
    </YStack>
  );
};

export default TablesScreen;
