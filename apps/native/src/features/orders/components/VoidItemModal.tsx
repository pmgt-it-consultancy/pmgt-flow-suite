import { useState } from "react";
import { XStack, YStack } from "tamagui";
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
      <YStack marginBottom={16}>
        <Text style={{ color: "#374151", fontWeight: "500", fontSize: 14 }}>
          {itemQuantity}x {itemName}
        </Text>
        <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
          This item has been sent to the kitchen. Please provide a reason for voiding.
        </Text>
      </YStack>

      <Input
        placeholder="Reason for voiding..."
        value={reason}
        onChangeText={setReason}
        autoFocus
      />

      <XStack marginTop={16} gap={12}>
        <YStack flex={1}>
          <Button variant="outline" size="lg" onPress={handleClose}>
            <Text style={{ color: "#374151", fontWeight: "500" }}>Cancel</Text>
          </Button>
        </YStack>
        <YStack flex={1}>
          <Button
            variant="destructive"
            size="lg"
            disabled={!reason.trim()}
            onPress={handleConfirm}
            style={!reason.trim() ? { opacity: 0.4 } : undefined}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "500" }}>Confirm Void</Text>
          </Button>
        </YStack>
      </XStack>
    </Modal>
  );
};
