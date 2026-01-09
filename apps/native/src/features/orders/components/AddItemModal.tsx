import React from "react";
import { View, TextInput } from "uniwind/components";
import { Ionicons } from "@expo/vector-icons";
import { Text, Button, Modal, IconButton } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import { Id } from "@packages/backend/convex/_generated/dataModel";

interface SelectedProduct {
  id: Id<"products">;
  name: string;
  price: number;
}

interface AddItemModalProps {
  visible: boolean;
  product: SelectedProduct | null;
  quantity: number;
  notes: string;
  isLoading: boolean;
  onClose: () => void;
  onQuantityChange: (qty: number) => void;
  onNotesChange: (notes: string) => void;
  onConfirm: () => void;
}

export const AddItemModal = ({
  visible,
  product,
  quantity,
  notes,
  isLoading,
  onClose,
  onQuantityChange,
  onNotesChange,
  onConfirm,
}: AddItemModalProps) => {
  const formatCurrency = useFormatCurrency();

  if (!product) return null;

  const total = product.price * quantity;

  return (
    <Modal
      visible={visible}
      title="Add to Order"
      onClose={onClose}
      onRequestClose={onClose}
    >
      <Text variant="heading" size="xl" className="mb-1">
        {product.name}
      </Text>
      <Text className="text-blue-500 font-medium text-lg mb-5">
        {formatCurrency(product.price)}
      </Text>

      {/* Quantity */}
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-gray-700 font-medium">Quantity</Text>
        <View className="flex-row items-center bg-gray-100 rounded-lg">
          <IconButton
            icon="remove"
            size="md"
            variant="ghost"
            iconColor="#EF4444"
            onPress={() => onQuantityChange(Math.max(1, quantity - 1))}
          />
          <Text className="text-gray-900 font-semibold text-lg px-5">
            {quantity}
          </Text>
          <IconButton
            icon="add"
            size="md"
            variant="ghost"
            iconColor="#22C55E"
            onPress={() => onQuantityChange(quantity + 1)}
          />
        </View>
      </View>

      {/* Notes */}
      <View className="mb-5">
        <Text className="text-gray-700 font-medium mb-2">Notes (optional)</Text>
        <TextInput
          className="border border-gray-200 rounded-lg p-3 text-base min-h-[60px] text-top"
          placeholder="E.g., no ice, extra spicy..."
          placeholderTextColor="#9CA3AF"
          value={notes}
          onChangeText={onNotesChange}
          multiline
        />
      </View>

      {/* Footer */}
      <View className="flex-row justify-between items-center pt-4 border-t border-gray-200">
        <Text className="text-gray-900 font-bold text-lg">
          Total: {formatCurrency(total)}
        </Text>
        <Button
          variant="primary"
          loading={isLoading}
          disabled={isLoading}
          onPress={onConfirm}
          className="min-w-[120px]"
        >
          Add to Order
        </Button>
      </View>
    </Modal>
  );
};
