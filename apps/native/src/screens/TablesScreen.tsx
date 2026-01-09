import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { RFValue } from "react-native-responsive-fontsize";
import { useQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAuth, useSessionToken } from "../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";

interface TablesScreenProps {
  navigation: any;
}

const TablesScreen = ({ navigation }: TablesScreenProps) => {
  const { user, logout } = useAuth();
  const token = useSessionToken();
  const [refreshing, setRefreshing] = useState(false);

  // Query tables for user's store
  const tables = useQuery(
    api.tables.list,
    token && user?.storeId ? { token, storeId: user.storeId } : "skip"
  );

  // Query orders to check which tables have active orders
  const orders = useQuery(
    api.orders.listActive,
    token && user?.storeId ? { token, storeId: user.storeId } : "skip"
  );

  // Create order mutation
  const createOrder = useMutation(api.orders.create);

  const handleRefresh = async () => {
    setRefreshing(true);
    // Queries auto-refresh, just wait a bit for visual feedback
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert(
      "Logout",
      "Are you sure you want to logout?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Logout",
          style: "destructive",
          onPress: async () => {
            await logout();
            navigation.reset({
              index: 0,
              routes: [{ name: "LoginScreen" }],
            });
          },
        },
      ]
    );
  };

  const handleSelectTable = async (tableId: Id<"tables">, tableName: string) => {
    if (!token || !user?.storeId) return;

    // Check if table has existing active order
    const existingOrder = orders?.find((o) => o.tableId === tableId);

    if (existingOrder) {
      // Navigate to existing order
      navigation.navigate("OrderScreen", {
        orderId: existingOrder._id,
        tableId,
        tableName,
      });
    } else {
      // Ask to create new order
      Alert.alert(
        "New Order",
        `Start a new order for ${tableName}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Start Order",
            onPress: async () => {
              try {
                const orderId = await createOrder({
                  token,
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
        ]
      );
    }
  };

  const getTableStatus = (tableId: Id<"tables">) => {
    const order = orders?.find((o) => o.tableId === tableId);
    if (!order) return { status: "available", color: "#22C55E", icon: "checkmark-circle" };

    return {
      status: "occupied",
      color: "#F59E0B",
      icon: "restaurant",
      itemCount: order.itemCount,
      total: order.subtotal,
    };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(amount);
  };

  const renderTable = ({ item }: { item: NonNullable<typeof tables>[number] }) => {
    const status = getTableStatus(item._id);
    const isOccupied = status.status === "occupied";

    return (
      <TouchableOpacity
        style={[styles.tableCard, isOccupied && styles.tableCardOccupied]}
        onPress={() => handleSelectTable(item._id, item.name)}
      >
        <View style={styles.tableHeader}>
          <Text style={styles.tableName}>{item.name}</Text>
          <Ionicons
            name={status.icon as any}
            size={24}
            color={status.color}
          />
        </View>
        <Text style={styles.tableCapacity}>
          Capacity: {item.capacity} {item.capacity === 1 ? "person" : "people"}
        </Text>
        {isOccupied && "itemCount" in status && (
          <View style={styles.orderInfo}>
            <Text style={styles.orderInfoText}>
              {status.itemCount} item(s)
            </Text>
            <Text style={styles.orderTotal}>
              {formatCurrency(status.total || 0)}
            </Text>
          </View>
        )}
        <View style={[styles.statusBadge, { backgroundColor: status.color + "20" }]}>
          <Text style={[styles.statusText, { color: status.color }]}>
            {status.status.toUpperCase()}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (!token) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0D87E1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello, {user?.name ?? "User"}</Text>
          <Text style={styles.subtitle}>Select a table to get started</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={24} color="#EF4444" />
        </TouchableOpacity>
      </View>

      {/* Tables Grid */}
      {tables === undefined ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0D87E1" />
        </View>
      ) : tables.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="restaurant-outline" size={64} color="#D1D5DB" />
          <Text style={styles.emptyText}>No tables found</Text>
          <Text style={styles.emptySubtext}>
            Add tables in the admin panel first
          </Text>
        </View>
      ) : (
        <FlatList
          data={tables}
          renderItem={renderTable}
          keyExtractor={(item) => item._id}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.row}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
      )}

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.quickActionButton}
          onPress={() => {
            // TODO: Take-out order flow
            Alert.alert("Coming Soon", "Take-out orders will be available soon");
          }}
        >
          <Ionicons name="bag-outline" size={20} color="#0D87E1" />
          <Text style={styles.quickActionText}>Take-out</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickActionButton}
          onPress={() => {
            // TODO: Delivery order flow
            Alert.alert("Coming Soon", "Delivery orders will be available soon");
          }}
        >
          <Ionicons name="bicycle-outline" size={20} color="#0D87E1" />
          <Text style={styles.quickActionText}>Delivery</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    backgroundColor: "#FFFFFF",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  greeting: {
    fontSize: RFValue(18),
    fontFamily: "SemiBold",
    color: "#111827",
  },
  subtitle: {
    fontSize: RFValue(12),
    fontFamily: "Regular",
    color: "#6B7280",
    marginTop: 2,
  },
  logoutButton: {
    padding: 8,
  },
  listContent: {
    padding: 8,
  },
  row: {
    justifyContent: "space-between",
  },
  tableCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    margin: 8,
    flex: 1,
    maxWidth: "47%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tableCardOccupied: {
    borderLeftWidth: 4,
    borderLeftColor: "#F59E0B",
  },
  tableHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  tableName: {
    fontSize: RFValue(16),
    fontFamily: "SemiBold",
    color: "#111827",
  },
  tableCapacity: {
    fontSize: RFValue(11),
    fontFamily: "Regular",
    color: "#6B7280",
    marginBottom: 8,
  },
  orderInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  orderInfoText: {
    fontSize: RFValue(11),
    fontFamily: "Medium",
    color: "#374151",
  },
  orderTotal: {
    fontSize: RFValue(11),
    fontFamily: "SemiBold",
    color: "#0D87E1",
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  statusText: {
    fontSize: RFValue(9),
    fontFamily: "SemiBold",
  },
  emptyText: {
    fontSize: RFValue(16),
    fontFamily: "SemiBold",
    color: "#6B7280",
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: RFValue(12),
    fontFamily: "Regular",
    color: "#9CA3AF",
    marginTop: 4,
  },
  quickActions: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  quickActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginHorizontal: 4,
    backgroundColor: "#EFF6FF",
    borderRadius: 8,
  },
  quickActionText: {
    fontSize: RFValue(12),
    fontFamily: "Medium",
    color: "#0D87E1",
    marginLeft: 8,
  },
});

export default TablesScreen;
