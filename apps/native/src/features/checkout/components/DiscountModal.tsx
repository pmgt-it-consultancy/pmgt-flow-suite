import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useRef } from "react";
import {
  type TextInput as RNTextInput,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { XStack } from "tamagui";
import { Chip, Modal, Text } from "../../shared/components/ui";
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
      <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 10, marginTop: 12 }}>
        Discount Type
      </Text>
      <XStack gap={12}>
        <Chip
          selected={discountType === "senior_citizen"}
          onPress={() => onDiscountTypeChange("senior_citizen")}
          style={{ flex: 1, justifyContent: "center", minHeight: 48, paddingVertical: 12 }}
        >
          Senior Citizen
        </Chip>
        <Chip
          selected={discountType === "pwd"}
          onPress={() => onDiscountTypeChange("pwd")}
          style={{ flex: 1, justifyContent: "center", minHeight: 48, paddingVertical: 12 }}
        >
          PWD
        </Chip>
      </XStack>

      {/* Select Items Header with Button */}
      <XStack justifyContent="space-between" alignItems="center" marginTop={20} marginBottom={10}>
        <Text style={{ color: "#374151", fontWeight: "500" }}>Select Items</Text>
        {availableItems.length > 1 && (
          <TouchableOpacity
            onPress={onSelectAll}
            activeOpacity={0.7}
            style={{
              backgroundColor: allSelected ? "#DBEAFE" : "#F3F4F6",
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 8,
              minHeight: 40,
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontWeight: "600",
                color: allSelected ? "#0D87E1" : "#374151",
                fontSize: 14,
              }}
            >
              {allSelected ? "Deselect All" : "Select All"}
            </Text>
          </TouchableOpacity>
        )}
      </XStack>

      {/* Item List - Increased height and touch targets */}
      <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled={true}>
        {availableItems.map((item) => {
          const isSelected = selectedItemIds.has(item._id);
          return (
            <TouchableOpacity
              key={item._id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 14,
                paddingHorizontal: 14,
                borderWidth: 1.5,
                borderRadius: 10,
                marginBottom: 8,
                borderColor: isSelected ? "#0D87E1" : "#E5E7EB",
                backgroundColor: isSelected ? "#EFF6FF" : undefined,
                minHeight: 56,
              }}
              onPress={() => onItemToggle(item._id)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isSelected ? "checkbox" : "square-outline"}
                size={26}
                color={isSelected ? "#0D87E1" : "#9CA3AF"}
                style={{ marginRight: 12 }}
              />
              <Text style={{ flex: 1, color: "#374151", fontSize: 15 }}>
                {item.quantity}x {item.productName}
              </Text>
              <Text style={{ color: "#111827", fontWeight: "600", fontSize: 15 }}>
                {formatCurrency(item.lineTotal)}
              </Text>
            </TouchableOpacity>
          );
        })}
        {availableItems.length === 0 && (
          <Text variant="muted" style={{ textAlign: "center", paddingVertical: 20 }}>
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
          borderRadius: 10,
          padding: 14,
          fontSize: 16,
          minHeight: 52,
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
          borderRadius: 10,
          padding: 14,
          fontSize: 16,
          minHeight: 52,
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

      {/* Full-width Apply Button */}
      <TouchableOpacity
        onPress={onApply}
        disabled={!isValid}
        style={{
          backgroundColor: isValid ? "#0D87E1" : "#9CA3AF",
          borderRadius: 12,
          paddingVertical: 18,
          width: "100%",
          marginTop: 20,
          opacity: !isValid ? 0.5 : 1,
        }}
        activeOpacity={0.8}
      >
        <Text
          style={{
            color: "#FFFFFF",
            fontWeight: "700",
            fontSize: 18,
            textAlign: "center",
          }}
        >
          Apply Discount{selectedItemIds.size > 1 ? ` to ${selectedItemIds.size} Items` : ""}
        </Text>
      </TouchableOpacity>
    </Modal>
  );
};
