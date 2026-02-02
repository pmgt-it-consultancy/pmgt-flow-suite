import { useEffect, useState } from "react";
import { TextInput } from "react-native";
import { XStack, YStack } from "tamagui";
import { Button, Chip, Modal, Text } from "../../shared/components/ui";
import type { PrinterConfig } from "../services/printerStorage";
import { usePrinterStore } from "../stores/usePrinterStore";

interface EditPrinterModalProps {
  visible: boolean;
  printer: PrinterConfig | null;
  onClose: () => void;
}

export const EditPrinterModal = ({ visible, printer, onClose }: EditPrinterModalProps) => {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"receipt" | "kitchen">("receipt");
  const [paperWidth, setPaperWidth] = useState<58 | 80>(80);

  const updatePrinter = usePrinterStore((s) => s.updatePrinter);

  useEffect(() => {
    if (printer) {
      setName(printer.name);
      setRole(printer.role);
      setPaperWidth(printer.paperWidth);
    }
  }, [printer]);

  const handleSave = async () => {
    if (!printer) return;
    await updatePrinter(printer.id, { name, role, paperWidth });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      position="center"
      title="Edit Printer"
      showCloseButton
      onClose={onClose}
    >
      <YStack marginBottom={16}>
        <Text style={{ fontSize: 14, fontWeight: "500", color: "#374151", marginBottom: 4 }}>
          Name
        </Text>
        <TextInput
          style={{
            backgroundColor: "#F9FAFB",
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderWidth: 1,
            borderColor: "#E5E7EB",
          }}
          value={name}
          onChangeText={setName}
          placeholder="Printer name"
        />
      </YStack>

      <YStack marginBottom={16}>
        <Text style={{ fontSize: 14, fontWeight: "500", color: "#374151", marginBottom: 4 }}>
          Role
        </Text>
        <XStack gap={8}>
          <Chip selected={role === "receipt"} onPress={() => setRole("receipt")}>
            Receipt
          </Chip>
          <Chip selected={role === "kitchen"} onPress={() => setRole("kitchen")}>
            Kitchen
          </Chip>
        </XStack>
      </YStack>

      <YStack marginBottom={16}>
        <Text style={{ fontSize: 14, fontWeight: "500", color: "#374151", marginBottom: 4 }}>
          Paper Width
        </Text>
        <XStack gap={8}>
          <Chip selected={paperWidth === 58} onPress={() => setPaperWidth(58)}>
            58mm
          </Chip>
          <Chip selected={paperWidth === 80} onPress={() => setPaperWidth(80)}>
            80mm
          </Chip>
        </XStack>
      </YStack>

      <Button variant="primary" onPress={handleSave} style={{ width: "100%" }}>
        Save Changes
      </Button>
    </Modal>
  );
};
