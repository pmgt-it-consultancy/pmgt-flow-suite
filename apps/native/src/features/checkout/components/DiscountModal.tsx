import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useRef } from "react";
import {
  type TextInput as RNTextInput,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { XStack, YStack } from "tamagui";
import { Button, Chip, Modal, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

type DiscountType = "senior_citizen" | "pwd" | null;

interface OrderItem {
  _id: Id<"orderItems">;
  productName: string;
  quantity: number;
  lineTotal: number;
}

interface DiscountModalProps {
  visible: boolean;
  items: OrderItem[];
  discountedQtyByItem: Map<string, number>;
  discountType: DiscountType;
  selectedItemIds: Set<string>;
  idNumber: string;
  customerName: string;
  onClose: () => void;
  onDiscountTypeChange: (type: DiscountType) => void;
  onItemToggle: (itemId: Id<"orderItems">) => void;
  onSelectAll: () => void;
  onIdNumberChange: (value: string) => void;
  onCustomerNameChange: (value: string) => void;
  onApply: () => void;
}

export const DiscountModal = ({
  visible,
  items,
  discountedQtyByItem,
  discountType,
  selectedItemIds,
  idNumber,
  customerName,
  onClose,
  onDiscountTypeChange,
  onItemToggle,
  onSelectAll,
  onIdNumberChange,
  onCustomerNameChange,
  onApply,
}: DiscountModalProps) => {
  const formatCurrency = useFormatCurrency();
  const customerNameRef = useRef<RNTextInput>(null);

  const availableItems = items.filter((item) => {
    const discountedQty = discountedQtyByItem.get(item._id) ?? 0;
    return discountedQty < item.quantity;
  });

  const allSelected =
    availableItems.length > 0 && availableItems.every((item) => selectedItemIds.has(item._id));
  const isValid =
    discountType && selectedItemIds.size > 0 && idNumber.trim() && customerName.trim();

  return (
    <Modal
      visible={visible}
      title="Apply SC/PWD Discount"
      onClose={onClose}
      onRequestClose={onClose}
    >
      {/* Discount Type */}
      <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8, marginTop: 12 }}>
        Discount Type
      </Text>
      <XStack gap={12}>
        <Chip
          selected={discountType === "senior_citizen"}
          onPress={() => onDiscountTypeChange("senior_citizen")}
          style={{ flex: 1, justifyContent: "center" }}
        >
          Senior Citizen
        </Chip>
        <Chip
          selected={discountType === "pwd"}
          onPress={() => onDiscountTypeChange("pwd")}
          style={{ flex: 1, justifyContent: "center" }}
        >
          PWD
        </Chip>
      </XStack>

      {/* Select Items */}
      <XStack justifyContent="space-between" alignItems="center" marginTop={16} marginBottom={8}>
        <Text style={{ color: "#374151", fontWeight: "500" }}>Select Items</Text>
        {availableItems.length > 1 && (
          <TouchableOpacity onPress={onSelectAll} activeOpacity={0.7}>
            <Text style={{ color: "#0D87E1", fontWeight: "500", fontSize: 14 }}>
              {allSelected ? "Deselect All" : "Select All"}
            </Text>
          </TouchableOpacity>
        )}
      </XStack>
      <ScrollView style={{ maxHeight: 160 }}>
        {availableItems.map((item) => {
          const isSelected = selectedItemIds.has(item._id);
          return (
            <TouchableOpacity
              key={item._id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 12,
                borderWidth: 1,
                borderRadius: 8,
                marginBottom: 8,
                borderColor: isSelected ? "#0D87E1" : "#E5E7EB",
                backgroundColor: isSelected ? "#EFF6FF" : undefined,
              }}
              onPress={() => onItemToggle(item._id)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isSelected ? "checkbox" : "square-outline"}
                size={22}
                color={isSelected ? "#0D87E1" : "#9CA3AF"}
                style={{ marginRight: 10 }}
              />
              <Text style={{ flex: 1, color: "#374151" }}>
                {item.quantity}x {item.productName}
              </Text>
              <Text style={{ color: "#111827", fontWeight: "500" }}>
                {formatCurrency(item.lineTotal)}
              </Text>
            </TouchableOpacity>
          );
        })}
        {availableItems.length === 0 && (
          <Text variant="muted" style={{ textAlign: "center", paddingVertical: 16 }}>
            All items already have discounts
          </Text>
        )}
      </ScrollView>

      {/* ID Number */}
      <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8, marginTop: 16 }}>
        ID Number
      </Text>
      <TextInput
        style={{
          borderWidth: 1,
          borderColor: "#E5E7EB",
          borderRadius: 8,
          padding: 12,
          fontSize: 16,
        }}
        placeholder="Enter SC/PWD ID number"
        placeholderTextColor="#9CA3AF"
        value={idNumber}
        onChangeText={onIdNumberChange}
        returnKeyType="next"
        onSubmitEditing={() => customerNameRef.current?.focus()}
        blurOnSubmit={false}
      />

      {/* Customer Name */}
      <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8, marginTop: 16 }}>
        Customer Name
      </Text>
      <TextInput
        ref={customerNameRef}
        style={{
          borderWidth: 1,
          borderColor: "#E5E7EB",
          borderRadius: 8,
          padding: 12,
          fontSize: 16,
        }}
        placeholder="Enter customer name"
        placeholderTextColor="#9CA3AF"
        value={customerName}
        onChangeText={onCustomerNameChange}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (isValid) onApply();
        }}
      />

      <Text variant="muted" size="xs" style={{ marginTop: 12 }}>
        BIR rule: 20% discount applies only to items consumed by SC/PWD
      </Text>

      <Button
        variant="primary"
        size="lg"
        disabled={!isValid}
        onPress={onApply}
        style={{ marginTop: 20, opacity: !isValid ? 0.5 : 1 }}
      >
        Apply Discount{selectedItemIds.size > 1 ? ` to ${selectedItemIds.size} Items` : ""}
      </Button>
    </Modal>
  );
};
