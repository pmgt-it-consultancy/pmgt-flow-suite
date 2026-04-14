import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useState } from "react";
import { ScrollView, TextInput } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { Button, Modal, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface OrderItem {
  _id: Id<"orderItems">;
  productName: string;
  productPrice: number;
  quantity: number;
  lineTotal: number;
}

interface RefundItemModalProps {
  visible: boolean;
  items: OrderItem[];
  onConfirm: (
    refundedItemIds: Id<"orderItems">[],
    reason: string,
    refundMethod: "cash" | "card_ewallet",
  ) => Promise<void>;
  onClose: () => void;
}

export const RefundItemModal = ({ visible, items, onConfirm, onClose }: RefundItemModalProps) => {
  const formatCurrency = useFormatCurrency();
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card_ewallet">("cash");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const refundTotal = items
    .filter((i) => selectedItemIds.has(i._id.toString()))
    .reduce((sum, i) => sum + i.lineTotal, 0);

  const canSubmit = selectedItemIds.size > 0 && reason.trim().length > 0 && !isSubmitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const ids = Array.from(selectedItemIds).map((id) => id as Id<"orderItems">);
      await onConfirm(ids, reason.trim(), refundMethod);
      handleReset();
    } catch {
      // Error handled by parent
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedItemIds(new Set());
    setReason("");
    setRefundMethod("cash");
    setIsSubmitting(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  return (
    <Modal visible={visible} onClose={handleClose} title="Refund Items" position="bottom">
      <YStack gap={16}>
        {/* Item selection */}
        <YStack>
          <Text
            style={{
              color: "#6B7280",
              fontWeight: "600",
              fontSize: 12,
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Select items to refund
          </Text>
          <ScrollView style={{ maxHeight: 250 }}>
            {items.map((item) => {
              const isSelected = selectedItemIds.has(item._id.toString());
              return (
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  key={item._id}
                  onPress={() => toggleItem(item._id.toString())}
                  style={({ pressed }) => [{ minHeight: 52 }, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <XStack
                    paddingVertical={12}
                    paddingHorizontal={12}
                    borderRadius={10}
                    backgroundColor={isSelected ? "#DBEAFE" : "#F9FAFB"}
                    borderWidth={1}
                    borderColor={isSelected ? "#0D87E1" : "#E5E7EB"}
                    marginBottom={8}
                    alignItems="center"
                    gap={12}
                  >
                    <YStack
                      width={24}
                      height={24}
                      borderRadius={6}
                      borderWidth={2}
                      borderColor={isSelected ? "#0D87E1" : "#D1D5DB"}
                      backgroundColor={isSelected ? "#0D87E1" : "transparent"}
                      justifyContent="center"
                      alignItems="center"
                    >
                      {isSelected && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                    </YStack>
                    <YStack flex={1}>
                      <Text style={{ color: "#111827", fontSize: 15, fontWeight: "500" }}>
                        {item.quantity}x {item.productName}
                      </Text>
                    </YStack>
                    <Text style={{ color: "#111827", fontWeight: "600", fontSize: 14 }}>
                      {formatCurrency(item.lineTotal)}
                    </Text>
                  </XStack>
                </Pressable>
              );
            })}
          </ScrollView>
        </YStack>

        {/* Reason */}
        <YStack>
          <Text
            style={{
              color: "#6B7280",
              fontWeight: "600",
              fontSize: 12,
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Reason for refund
          </Text>
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: "#E5E7EB",
              borderRadius: 10,
              padding: 12,
              fontSize: 15,
              color: "#111827",
              minHeight: 70,
            }}
            placeholder="Enter reason..."
            placeholderTextColor="#9CA3AF"
            value={reason}
            onChangeText={setReason}
            multiline
            textAlignVertical="top"
          />
        </YStack>

        {/* Refund method */}
        <YStack>
          <Text
            style={{
              color: "#6B7280",
              fontWeight: "600",
              fontSize: 12,
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Refund method
          </Text>
          <XStack gap={10}>
            <Pressable onPress={() => setRefundMethod("cash")} style={{ flex: 1, minHeight: 48 }}>
              <XStack
                flex={1}
                paddingVertical={12}
                borderRadius={10}
                borderWidth={1.5}
                borderColor={refundMethod === "cash" ? "#0D87E1" : "#E5E7EB"}
                backgroundColor={refundMethod === "cash" ? "#DBEAFE" : "#F9FAFB"}
                justifyContent="center"
                alignItems="center"
                gap={8}
              >
                <Ionicons
                  name="cash-outline"
                  size={20}
                  color={refundMethod === "cash" ? "#0D87E1" : "#6B7280"}
                />
                <Text
                  style={{
                    fontWeight: "600",
                    fontSize: 14,
                    color: refundMethod === "cash" ? "#0D87E1" : "#374151",
                  }}
                >
                  Cash
                </Text>
              </XStack>
            </Pressable>
            <Pressable
              android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
              onPress={() => setRefundMethod("card_ewallet")}
              style={({ pressed }) => [{ flex: 1, minHeight: 48 }, { opacity: pressed ? 0.7 : 1 }]}
            >
              <XStack
                flex={1}
                paddingVertical={12}
                borderRadius={10}
                borderWidth={1.5}
                borderColor={refundMethod === "card_ewallet" ? "#0D87E1" : "#E5E7EB"}
                backgroundColor={refundMethod === "card_ewallet" ? "#DBEAFE" : "#F9FAFB"}
                justifyContent="center"
                alignItems="center"
                gap={8}
              >
                <Ionicons
                  name="card-outline"
                  size={20}
                  color={refundMethod === "card_ewallet" ? "#0D87E1" : "#6B7280"}
                />
                <Text
                  style={{
                    fontWeight: "600",
                    fontSize: 14,
                    color: refundMethod === "card_ewallet" ? "#0D87E1" : "#374151",
                  }}
                >
                  Card / E-Wallet
                </Text>
              </XStack>
            </Pressable>
          </XStack>
        </YStack>

        {/* Refund summary */}
        {selectedItemIds.size > 0 && (
          <XStack
            backgroundColor="#FEF2F2"
            borderRadius={10}
            padding={14}
            justifyContent="space-between"
            alignItems="center"
          >
            <Text style={{ color: "#DC2626", fontWeight: "500", fontSize: 14 }}>
              Refund Amount ({selectedItemIds.size} item{selectedItemIds.size > 1 ? "s" : ""})
            </Text>
            <Text style={{ color: "#DC2626", fontWeight: "700", fontSize: 18 }}>
              {formatCurrency(refundTotal)}
            </Text>
          </XStack>
        )}

        {/* Actions */}
        <XStack gap={12}>
          <YStack flex={1}>
            <Button variant="outline" size="lg" onPress={handleClose}>
              <Text style={{ color: "#374151", fontWeight: "500" }}>Cancel</Text>
            </Button>
          </YStack>
          <YStack flex={1}>
            <Button
              variant="destructive"
              size="lg"
              disabled={!canSubmit}
              onPress={handleConfirm}
              loading={isSubmitting}
              style={!canSubmit ? { opacity: 0.4 } : undefined}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "500" }}>Continue</Text>
            </Button>
          </YStack>
        </XStack>
      </YStack>
    </Modal>
  );
};
