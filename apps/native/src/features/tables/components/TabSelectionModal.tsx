import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Modal as RNModal, ScrollView, StyleSheet, View } from "react-native";
import { GestureHandlerRootView, Pressable } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface TabOrder {
  _id: Id<"orders">;
  orderNumber: string;
  tabNumber: number;
  tabName: string;
  itemCount: number;
  netSales: number;
  pax?: number;
  createdAt: number;
}

interface TabSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  tableName: string;
  orders: TabOrder[];
  onSelectOrder: (orderId: Id<"orders">) => void;
  onAddNewTab: () => void;
  isCreating?: boolean;
}

export const TabSelectionModal = ({
  visible,
  onClose,
  tableName,
  orders,
  onSelectOrder,
  onAddNewTab,
  isCreating,
}: TabSelectionModalProps) => {
  const formatCurrency = useFormatCurrency();

  const handleSelectOrder = (orderId: Id<"orders">) => {
    // Parent handles closing the modal after navigation
    onSelectOrder(orderId);
  };

  const handleAddNewTab = () => {
    // Parent handles closing the modal after navigation
    onAddNewTab();
  };

  return (
    <RNModal visible={visible} transparent animationType="slide">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          {/* Backdrop */}
          <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />

          {/* Content */}
          <KeyboardAvoidingView
            behavior="padding"
            style={{
              maxHeight: "92%",
              backgroundColor: "#FFFFFF",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
            }}
          >
            <View style={{ maxHeight: "100%" }}>
              {/* Fixed Header */}
              <XStack
                paddingHorizontal={20}
                paddingTop={20}
                paddingBottom={16}
                borderBottomWidth={1}
                borderColor="#E5E7EB"
                justifyContent="space-between"
                alignItems="center"
              >
                <YStack flex={1}>
                  <Text variant="heading" size="xl">
                    Table {tableName}
                  </Text>
                  <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
                    {orders.length} {orders.length === 1 ? "tab" : "tabs"} active
                  </Text>
                </YStack>
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  onPress={onClose}
                  style={({ pressed }) => [
                    { padding: 8, marginRight: -8 },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={24} color="#6B7280" />
                </Pressable>
              </XStack>

              {/* Scrollable Tab List */}
              <ScrollView
                contentContainerStyle={{ padding: 20 }}
                showsVerticalScrollIndicator={false}
              >
                <YStack gap={12}>
                  {orders.map((order) => (
                    <Pressable key={order._id} onPress={() => handleSelectOrder(order._id)}>
                      <XStack
                        backgroundColor="#F9FAFB"
                        borderRadius={12}
                        borderWidth={1}
                        borderColor="#E5E7EB"
                        paddingHorizontal={16}
                        paddingVertical={16}
                        alignItems="center"
                        justifyContent="space-between"
                        minHeight={64}
                      >
                        <YStack flex={1} gap={4}>
                          <XStack alignItems="center" gap={8}>
                            <Text variant="heading" size="lg">
                              {order.tabName}
                            </Text>
                            {order.pax !== undefined && order.pax > 0 && (
                              <XStack
                                backgroundColor="#DBEAFE"
                                borderRadius={6}
                                paddingHorizontal={8}
                                paddingVertical={2}
                                alignItems="center"
                                gap={4}
                              >
                                <Ionicons name="people" size={12} color="#0D87E1" />
                                <Text size="xs" style={{ color: "#0D87E1", fontWeight: "600" }}>
                                  {order.pax}
                                </Text>
                              </XStack>
                            )}
                          </XStack>
                          <Text variant="muted" size="sm">
                            {order.itemCount} {order.itemCount === 1 ? "item" : "items"} ·{" "}
                            {formatCurrency(order.netSales)}
                          </Text>
                        </YStack>
                        <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                      </XStack>
                    </Pressable>
                  ))}
                </YStack>
              </ScrollView>

              {/* Fixed Footer - Add New Tab Button */}
              <YStack
                paddingHorizontal={20}
                paddingTop={16}
                paddingBottom={24}
                borderTopWidth={1}
                borderColor="#E5E7EB"
              >
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  onPress={handleAddNewTab}
                  disabled={isCreating}
                  style={({ pressed }) => [
                    {
                      backgroundColor: isCreating ? "#93C5FD" : "#0D87E1",
                      borderRadius: 12,
                      paddingVertical: 18,
                      paddingHorizontal: 20,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: 56,
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Ionicons name="add-circle-outline" size={22} color="#FFFFFF" />
                  <Text
                    size="lg"
                    style={{
                      color: "#FFFFFF",
                      fontWeight: "600",
                      marginLeft: 8,
                    }}
                  >
                    Add New Tab
                  </Text>
                </Pressable>
              </YStack>
            </View>
          </KeyboardAvoidingView>
        </View>
      </GestureHandlerRootView>
    </RNModal>
  );
};
