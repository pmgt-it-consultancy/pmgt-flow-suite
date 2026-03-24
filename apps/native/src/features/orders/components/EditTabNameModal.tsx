import { useEffect, useState } from "react";
import { XStack, YStack } from "tamagui";
import { Button, Input, Modal, Text } from "../../shared/components/ui";

interface EditTabNameModalProps {
  visible: boolean;
  onClose: () => void;
  currentName: string;
  tabNumber: number;
  onSave: (newName: string) => Promise<void> | void;
}

export const EditTabNameModal = ({
  visible,
  onClose,
  currentName,
  tabNumber,
  onSave,
}: EditTabNameModalProps) => {
  const [tabName, setTabName] = useState(currentName);
  const [isSaving, setIsSaving] = useState(false);
  const defaultName = `Tab ${tabNumber}`;

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    const trimmedName = tabName.trim();
    try {
      if (!trimmedName) {
        await onSave(defaultName);
      } else {
        await onSave(trimmedName);
      }
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    setTabName(defaultName);
  };

  const handleClose = () => {
    setTabName(currentName);
    setIsSaving(false);
    onClose();
  };

  // Reset state when modal becomes visible or currentName changes
  useEffect(() => {
    if (visible) {
      setTabName(currentName);
    }
  }, [visible, currentName]);

  return (
    <Modal visible={visible} onClose={handleClose} title="Edit Tab Name" position="center">
      <YStack marginBottom={16}>
        <Text variant="muted" size="sm">
          Customize the name for this tab. Leave blank to use the default name.
        </Text>
      </YStack>

      <Input
        placeholder={defaultName}
        value={tabName}
        onChangeText={setTabName}
        autoFocus
        maxLength={50}
      />

      <XStack marginTop={12} justifyContent="flex-end">
        <Button variant="ghost" size="md" onPress={handleClear}>
          <Text style={{ color: "#6B7280", fontWeight: "500" }}>Reset to Default</Text>
        </Button>
      </XStack>

      <XStack marginTop={16} gap={12}>
        <YStack flex={1}>
          <Button variant="outline" size="lg" onPress={handleClose}>
            <Text style={{ color: "#374151", fontWeight: "500" }}>Cancel</Text>
          </Button>
        </YStack>
        <YStack flex={1}>
          <Button variant="primary" size="lg" onPress={handleSave} disabled={isSaving}>
            <Text style={{ color: "#FFFFFF", fontWeight: "500" }}>Save</Text>
          </Button>
        </YStack>
      </XStack>
    </Modal>
  );
};
