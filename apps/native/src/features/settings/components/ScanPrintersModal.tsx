import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
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
        <YStack>
          {devices.map((device) => (
            <YStack
              key={device.address}
              backgroundColor="#F9FAFB"
              borderRadius={8}
              padding={12}
              marginBottom={8}
            >
              <Text style={{ fontWeight: "600" }}>{device.name || "Unknown Device"}</Text>
              <Text style={{ fontSize: 12, color: "#6B7280" }}>{device.address}</Text>
              <XStack marginTop={8} gap={8}>
                <Button variant="outline" size="sm" onPress={() => handleAdd(device, "receipt")}>
                  Add as Receipt
                </Button>
                <Button variant="outline" size="sm" onPress={() => handleAdd(device, "kitchen")}>
                  Add as Kitchen
                </Button>
              </XStack>
            </YStack>
          ))}
        </YStack>
      )}

      {isScanning && (
        <YStack alignItems="center" paddingVertical={16}>
          <ActivityIndicator size="small" />
          <Text style={{ marginTop: 8, color: "#6B7280", fontSize: 14 }}>
            {devices.length > 0 ? "Scanning for more devices..." : "Scanning..."}
          </Text>
        </YStack>
      )}

      {!isScanning && devices.length === 0 && (
        <YStack alignItems="center" paddingVertical={32}>
          <Ionicons name="bluetooth-outline" size={40} color="#9CA3AF" />
          <Text style={{ marginTop: 12, color: "#6B7280" }}>No devices found</Text>
        </YStack>
      )}

      <Button variant="outline" onPress={startScan} disabled={isScanning} style={{ marginTop: 16 }}>
        Scan Again
      </Button>
    </Modal>
  );
};
