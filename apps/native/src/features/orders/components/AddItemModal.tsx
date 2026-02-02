import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TextInput } from "react-native";
import { XStack, YStack } from "tamagui";
import { Button, IconButton, Modal, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

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
    <Modal visible={visible} title="Add to Order" onClose={onClose} onRequestClose={onClose}>
      <Text variant="heading" size="xl" style={{ marginBottom: 4 }}>
        {product.name}
      </Text>
      <Text style={{ color: "#0D87E1", fontWeight: "500", fontSize: 18, marginBottom: 20 }}>
        {formatCurrency(product.price)}
      </Text>

      {/* Quantity */}
      <XStack justifyContent="space-between" alignItems="center" marginBottom={16}>
        <Text style={{ color: "#374151", fontWeight: "500" }}>Quantity</Text>
        <XStack alignItems="center" backgroundColor="#F3F4F6" borderRadius={8}>
          <IconButton
            icon="remove"
            size="md"
            variant="ghost"
            iconColor="#EF4444"
            onPress={() => onQuantityChange(Math.max(1, quantity - 1))}
          />
          <Text
            style={{ color: "#111827", fontWeight: "600", fontSize: 18, paddingHorizontal: 20 }}
          >
            {quantity}
          </Text>
          <IconButton
            icon="add"
            size="md"
            variant="ghost"
            iconColor="#22C55E"
            onPress={() => onQuantityChange(quantity + 1)}
          />
        </XStack>
      </XStack>

      {/* Notes */}
      <YStack marginBottom={20}>
        <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8 }}>
          Notes (optional)
        </Text>
        <TextInput
          style={{
            borderWidth: 1,
            borderColor: "#E5E7EB",
            borderRadius: 8,
            padding: 12,
            fontSize: 16,
            minHeight: 60,
            textAlignVertical: "top",
          }}
          placeholder="E.g., no ice, extra spicy..."
          placeholderTextColor="#9CA3AF"
          value={notes}
          onChangeText={onNotesChange}
          multiline
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={onConfirm}
        />
      </YStack>

      {/* Footer */}
      <XStack
        justifyContent="space-between"
        alignItems="center"
        paddingTop={16}
        borderTopWidth={1}
        borderTopColor="#E5E7EB"
      >
        <Text style={{ color: "#111827", fontWeight: "700", fontSize: 18, flexShrink: 1 }}>
          Total: {formatCurrency(total)}
        </Text>
        <Button
          variant="primary"
          loading={isLoading}
          disabled={isLoading}
          onPress={onConfirm}
          style={{ flexShrink: 0 }}
        >
          Add Item
        </Button>
      </XStack>
    </Modal>
  );
};
