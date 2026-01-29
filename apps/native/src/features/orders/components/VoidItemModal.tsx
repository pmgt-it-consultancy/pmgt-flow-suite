import { useState } from "react";
import { View } from "uniwind/components";
import { Button, Input, Modal, Text } from "../../shared/components/ui";

interface VoidItemModalProps {
  visible: boolean;
  itemName: string;
  itemQuantity: number;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

export const VoidItemModal = ({
  visible,
  itemName,
  itemQuantity,
  onConfirm,
  onClose,
}: VoidItemModalProps) => {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    if (!reason.trim()) return;
    onConfirm(reason.trim());
    setReason("");
  };

  const handleClose = () => {
    setReason("");
    onClose();
  };

  return (
    <Modal visible={visible} onClose={handleClose} title="Void Item" position="center">
      <View className="mb-4">
        <Text className="text-gray-700 font-medium text-sm">
          {itemQuantity}x {itemName}
        </Text>
        <Text variant="muted" size="sm" className="mt-1">
          This item has been sent to the kitchen. Please provide a reason for voiding.
        </Text>
      </View>

      <Input
        placeholder="Reason for voiding..."
        value={reason}
        onChangeText={setReason}
        autoFocus
      />

      <View className="flex-row mt-4 gap-3">
        <View className="flex-1">
          <Button variant="outline" size="lg" onPress={handleClose}>
            <Text className="text-gray-700 font-medium">Cancel</Text>
          </Button>
        </View>
        <View className="flex-1">
          <Button
            variant="destructive"
            size="lg"
            disabled={!reason.trim()}
            onPress={handleConfirm}
            className={!reason.trim() ? "opacity-40" : ""}
          >
            <Text className="text-white font-medium">Confirm Void</Text>
          </Button>
        </View>
      </View>
    </Modal>
  );
};
