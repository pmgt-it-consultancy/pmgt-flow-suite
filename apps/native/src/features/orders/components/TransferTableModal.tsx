import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useState } from "react";
import { Alert, FlatList } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { useTablesAvailable } from "../../../sync";
import { LoadingState, Modal, Text } from "../../shared/components/ui";

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
  const availableTables = useTablesAvailable(visible ? storeId : undefined);
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
      scrollable={false}
    >
      {availableTables === undefined ? (
        <LoadingState
          title="Loading available tables"
          description="Checking which tables are ready to receive this order."
        />
      ) : availableTables.length === 0 ? (
        <YStack alignItems="center" paddingVertical={32}>
          <Ionicons name="alert-circle-outline" size={32} color="#D1D5DB" />
          <Text variant="muted" style={{ marginTop: 8 }}>
            No available tables
          </Text>
        </YStack>
      ) : (
        <FlatList
          data={availableTables}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <Pressable
              android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
              onPress={() => handleTransfer(item._id, item.name)}
              disabled={isTransferring}
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: "#F3F4F6",
                },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <XStack alignItems="center">
                <Ionicons name="grid-outline" size={20} color="#6B7280" />
                <Text style={{ color: "#111827", fontWeight: "500", marginLeft: 12 }}>
                  {item.name}
                </Text>
              </XStack>
              {item.capacity && (
                <Text style={{ color: "#9CA3AF", fontSize: 12 }}>{item.capacity} seats</Text>
              )}
            </Pressable>
          )}
          style={{ maxHeight: 300 }}
        />
      )}
    </Modal>
  );
};
