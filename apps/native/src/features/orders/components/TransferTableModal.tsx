import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Alert } from "react-native";
import { ActivityIndicator, FlatList, TouchableOpacity, View } from "uniwind/components";
import { Modal, Text } from "../../shared/components/ui";

interface TransferTableModalProps {
  visible: boolean;
  storeId: Id<"stores">;
  orderId: Id<"orders">;
  currentTableName: string;
  onTransferred: (newTableId: Id<"tables">, newTableName: string) => void;
  onClose: () => void;
}

export const TransferTableModal = ({
  visible,
  storeId,
  orderId,
  currentTableName,
  onTransferred,
  onClose,
}: TransferTableModalProps) => {
  const [isTransferring, setIsTransferring] = useState(false);
  const availableTables = useQuery(api.tables.getAvailable, visible ? { storeId } : "skip");
  const transferTable = useMutation(api.orders.transferTable);

  const handleTransfer = async (newTableId: Id<"tables">, newTableName: string) => {
    setIsTransferring(true);
    try {
      await transferTable({ orderId, newTableId });
      onTransferred(newTableId, newTableName);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to transfer table");
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Transfer Table"
      description={`Move order from ${currentTableName} to:`}
      position="center"
    >
      {availableTables === undefined ? (
        <View className="items-center py-8">
          <ActivityIndicator size="small" color="#0D87E1" />
        </View>
      ) : availableTables.length === 0 ? (
        <View className="items-center py-8">
          <Ionicons name="alert-circle-outline" size={32} color="#D1D5DB" />
          <Text variant="muted" className="mt-2">
            No available tables
          </Text>
        </View>
      ) : (
        <FlatList
          data={availableTables}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => handleTransfer(item._id, item.name)}
              disabled={isTransferring}
              className="flex-row items-center justify-between py-3 px-3 border-b border-gray-100"
            >
              <View className="flex-row items-center">
                <Ionicons name="grid-outline" size={20} color="#6B7280" />
                <Text className="text-gray-900 font-medium ml-3">{item.name}</Text>
              </View>
              {item.capacity && (
                <Text className="text-gray-400 text-xs">{item.capacity} seats</Text>
              )}
            </TouchableOpacity>
          )}
          style={{ maxHeight: 300 }}
        />
      )}
    </Modal>
  );
};
