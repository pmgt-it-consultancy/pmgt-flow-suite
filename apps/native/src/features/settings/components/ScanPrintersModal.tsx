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
  const { isScanning, printers, scanForDevices, fetchPairedDevices, addPrinter } =
    usePrinterStore();

  const mergeDevices = (
    existing: BluetoothDevice[],
    incoming: BluetoothDevice[],
    savedAddresses: Set<string>,
  ) => {
    const map = new Map<string, BluetoothDevice>();
    for (const d of existing) map.set(d.address, d);
    for (const d of incoming) {
      if (!savedAddresses.has(d.address)) {
        const prev = map.get(d.address);
        // Prefer a real name over "Unknown"
        if (!prev || (prev.name === "Unknown" && d.name !== "Unknown")) {
          map.set(d.address, d);
        }
      }
    }
    return Array.from(map.values());
  };

  const startScan = async () => {
    const savedAddresses = new Set(printers.map((p) => p.id));

    // Phase 1: show paired/bonded devices instantly
    const paired = await fetchPairedDevices();
    setDevices((prev) => mergeDevices(prev, paired, savedAddresses));

    // Phase 2: full discovery scan (slow, ~12s)
    const found = await scanForDevices();
    setDevices((prev) => mergeDevices(prev, found, savedAddresses));
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
      {devices.length > 0 && (
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

      {isScanning && (
        <View className="items-center py-4">
          <ActivityIndicator size="small" />
          <Text className="mt-2 text-gray-500 text-sm">
            {devices.length > 0 ? "Scanning for more devices..." : "Scanning..."}
          </Text>
        </View>
      )}

      {!isScanning && devices.length === 0 && (
        <View className="items-center py-8">
          <Ionicons name="bluetooth-outline" size={40} color="#9CA3AF" />
          <Text className="mt-3 text-gray-500">No devices found</Text>
        </View>
      )}

      <Button variant="outline" onPress={startScan} disabled={isScanning} className="mt-4">
        Scan Again
      </Button>
    </Modal>
  );
};
