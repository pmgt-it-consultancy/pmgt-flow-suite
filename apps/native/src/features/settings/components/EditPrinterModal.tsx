import { useEffect, useState } from "react";
import { TextInput, View } from "uniwind/components";
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
      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-1">Name</Text>
        <TextInput
          className="bg-gray-50 rounded-lg px-3 py-3 border border-gray-200"
          value={name}
          onChangeText={setName}
          placeholder="Printer name"
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-1">Role</Text>
        <View className="flex-row gap-2">
          <Chip selected={role === "receipt"} onPress={() => setRole("receipt")}>
            Receipt
          </Chip>
          <Chip selected={role === "kitchen"} onPress={() => setRole("kitchen")}>
            Kitchen
          </Chip>
        </View>
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-1">Paper Width</Text>
        <View className="flex-row gap-2">
          <Chip selected={paperWidth === 58} onPress={() => setPaperWidth(58)}>
            58mm
          </Chip>
          <Chip selected={paperWidth === 80} onPress={() => setPaperWidth(80)}>
            80mm
          </Chip>
        </View>
      </View>

      <Button variant="primary" onPress={handleSave} className="w-full">
        Save Changes
      </Button>
    </Modal>
  );
};
