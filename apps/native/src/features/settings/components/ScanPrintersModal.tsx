import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { ActivityIndicator, TouchableOpacity, View } from "uniwind/components";
import { Button, Modal, Text } from "../../shared/components/ui";
import type { BluetoothDevice } from "../services/bluetoothPrinter";
import { usePrinterStore } from "../stores/usePrinterStore";

interface ScanPrintersModalProps {
  visible: boolean;
  onClose: () => void;
}

export const ScanPrintersModal = ({ visible, onClose }: ScanPrintersModalProps) => {
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const { isScanning, printers, scanForDevices, addPrinter } = usePrinterStore();

  const startScan = async () => {
    const found = await scanForDevices();
    const pairedAddresses = new Set(printers.map((p) => p.id));
    setDevices(found.filter((d) => !pairedAddresses.has(d.address)));
  };

  useEffect(() => {
    if (visible) {
      setDevices([]);
      startScan();
    }
  }, [visible]);

  const handleAdd = (device: BluetoothDevice, role: "receipt" | "kitchen") => {
    Alert.alert("Paper Width", "Select the paper width for this printer", [
      {
        text: "58mm",
        onPress: async () => {
          await addPrinter(device, role, 58);
          setDevices((prev) => prev.filter((d) => d.address !== device.address));
        },
      },
      {
        text: "80mm",
        onPress: async () => {
          await addPrinter(device, role, 80);
          setDevices((prev) => prev.filter((d) => d.address !== device.address));
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      position="bottom"
      title="Scan for Printers"
      showCloseButton
    >
      {isScanning ? (
        <View className="items-center py-8">
          <ActivityIndicator size="large" />
          <Text className="mt-3 text-gray-500">Scanning...</Text>
        </View>
      ) : devices.length === 0 ? (
        <View className="items-center py-8">
          <Ionicons name="bluetooth-outline" size={40} color="#9CA3AF" />
          <Text className="mt-3 text-gray-500">No devices found</Text>
        </View>
      ) : (
        <View>
          {devices.map((device) => (
            <View key={device.address} className="bg-gray-50 rounded-lg p-3 mb-2">
              <Text className="font-semibold">{device.name || "Unknown Device"}</Text>
              <Text className="text-xs text-gray-500">{device.address}</Text>
              <View className="flex-row mt-2 gap-2">
                <Button variant="outline" size="sm" onPress={() => handleAdd(device, "receipt")}>
                  Add as Receipt
                </Button>
                <Button variant="outline" size="sm" onPress={() => handleAdd(device, "kitchen")}>
                  Add as Kitchen
                </Button>
              </View>
            </View>
          ))}
        </View>
      )}

      <Button variant="outline" onPress={startScan} disabled={isScanning} className="mt-4">
        Scan Again
      </Button>
    </Modal>
  );
};
