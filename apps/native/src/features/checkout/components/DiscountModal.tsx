import React from "react";
import { View, ScrollView, TouchableOpacity, TextInput } from "uniwind/components";
import { Ionicons } from "@expo/vector-icons";
import { Text, Modal, Button, Chip } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import { Id } from "@packages/backend/convex/_generated/dataModel";

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
  appliedDiscountItemIds: Id<"orderItems">[];
  discountType: DiscountType;
  selectedItemId: Id<"orderItems"> | null;
  idNumber: string;
  customerName: string;
  onClose: () => void;
  onDiscountTypeChange: (type: DiscountType) => void;
  onItemSelect: (itemId: Id<"orderItems">) => void;
  onIdNumberChange: (value: string) => void;
  onCustomerNameChange: (value: string) => void;
  onApply: () => void;
}

export const DiscountModal = ({
  visible,
  items,
  appliedDiscountItemIds,
  discountType,
  selectedItemId,
  idNumber,
  customerName,
  onClose,
  onDiscountTypeChange,
  onItemSelect,
  onIdNumberChange,
  onCustomerNameChange,
  onApply,
}: DiscountModalProps) => {
  const formatCurrency = useFormatCurrency();

  const availableItems = items.filter(
    (item) => !appliedDiscountItemIds.includes(item._id)
  );

  const isValid = discountType && selectedItemId && idNumber.trim() && customerName.trim();

  return (
    <Modal
      visible={visible}
      title="Apply SC/PWD Discount"
      onClose={onClose}
      onRequestClose={onClose}
    >
      {/* Discount Type */}
      <Text className="text-gray-700 font-medium mb-2 mt-3">Discount Type</Text>
      <View className="flex-row gap-3">
        <Chip
          selected={discountType === "senior_citizen"}
          onPress={() => onDiscountTypeChange("senior_citizen")}
          className="flex-1 justify-center"
        >
          Senior Citizen
        </Chip>
        <Chip
          selected={discountType === "pwd"}
          onPress={() => onDiscountTypeChange("pwd")}
          className="flex-1 justify-center"
        >
          PWD
        </Chip>
      </View>

      {/* Select Item */}
      <Text className="text-gray-700 font-medium mb-2 mt-4">Select Item</Text>
      <ScrollView className="max-h-[120px]">
        {availableItems.map((item) => (
          <TouchableOpacity
            key={item._id}
            className={`flex-row items-center p-3 border rounded-lg mb-2 ${
              selectedItemId === item._id
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200"
            }`}
            onPress={() => onItemSelect(item._id)}
            activeOpacity={0.7}
          >
            <Text className="flex-1 text-gray-700">
              {item.quantity}x {item.productName}
            </Text>
            <Text className="text-gray-900 font-medium mr-2">
              {formatCurrency(item.lineTotal)}
            </Text>
            {selectedItemId === item._id && (
              <Ionicons name="checkmark-circle" size={20} color="#0D87E1" />
            )}
          </TouchableOpacity>
        ))}
        {availableItems.length === 0 && (
          <Text variant="muted" className="text-center py-4">
            All items already have discounts
          </Text>
        )}
      </ScrollView>

      {/* ID Number */}
      <Text className="text-gray-700 font-medium mb-2 mt-4">ID Number</Text>
      <TextInput
        className="border border-gray-200 rounded-lg p-3 text-base"
        placeholder="Enter SC/PWD ID number"
        placeholderTextColor="#9CA3AF"
        value={idNumber}
        onChangeText={onIdNumberChange}
      />

      {/* Customer Name */}
      <Text className="text-gray-700 font-medium mb-2 mt-4">Customer Name</Text>
      <TextInput
        className="border border-gray-200 rounded-lg p-3 text-base"
        placeholder="Enter customer name"
        placeholderTextColor="#9CA3AF"
        value={customerName}
        onChangeText={onCustomerNameChange}
      />

      <Text variant="muted" size="xs" className="mt-3">
        BIR rule: 20% discount applies only to items consumed by SC/PWD
      </Text>

      <Button
        variant="primary"
        size="lg"
        disabled={!isValid}
        onPress={onApply}
        className={`mt-5 ${!isValid ? "opacity-50" : ""}`}
      >
        Apply Discount
      </Button>
    </Modal>
  );
};
