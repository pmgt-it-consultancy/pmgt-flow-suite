import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert } from "react-native";
import { XStack, YStack } from "tamagui";
import { Button, Modal, Text } from "../../shared/components/ui";
import {
  addScanCompletedListener,
  addScanDeviceFoundListener,
  addScanPairedDevicesListener,
  type BluetoothDevice,
} from "../services/bluetoothPrinter";
import type { PrinterAddProgress } from "../stores/usePrinterStore";
import { usePrinterStore } from "../stores/usePrinterStore";

interface ScanPrintersModalProps {
  visible: boolean;
  onClose: () => void;
}

type AddRole = "receipt" | "kitchen";

interface AddFeedbackState {
  device: BluetoothDevice;
  role: AddRole;
  paperWidth: 58 | 80;
  status: "saving" | "connecting" | "success" | "error";
  message: string;
}

export const ScanPrintersModal = ({ visible, onClose }: ScanPrintersModalProps) => {
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [addFeedback, setAddFeedback] = useState<AddFeedbackState | null>(null);
  const successCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanSubscriptionsRef = useRef<Array<{ remove: () => void }>>([]);
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

  const startScan = useCallback(async () => {
    const savedAddresses = new Set(printers.map((p) => p.id));

    scanSubscriptionsRef.current.forEach((subscription) => {
      subscription.remove();
    });
    scanSubscriptionsRef.current = [
      addScanPairedDevicesListener((pairedDevices) => {
        setDevices((prev) => mergeDevices(prev, pairedDevices, savedAddresses));
      }),
      addScanDeviceFoundListener((device) => {
        setDevices((prev) => mergeDevices(prev, [device], savedAddresses));
      }),
      addScanCompletedListener(() => {
        // No-op for now; keeping the listener ensures we stay subscribed until scan finishes.
      }),
    ];

    // Phase 1: show paired/bonded devices instantly
    const paired = await fetchPairedDevices();
    setDevices((prev) => mergeDevices(prev, paired, savedAddresses));

    // Phase 2: full discovery scan (slow, ~12s)
    const found = await scanForDevices();
    setDevices((prev) => mergeDevices(prev, found, savedAddresses));
  }, [printers, scanForDevices, fetchPairedDevices]);

  useEffect(() => {
    if (visible) {
      setDevices([]);
      setAddFeedback(null);
      startScan();
    }
    return () => {
      scanSubscriptionsRef.current.forEach((subscription) => {
        subscription.remove();
      });
      scanSubscriptionsRef.current = [];
      if (successCloseTimeoutRef.current) {
        clearTimeout(successCloseTimeoutRef.current);
        successCloseTimeoutRef.current = null;
      }
    };
  }, [visible, startScan]);

  const closeWithReset = () => {
    if (successCloseTimeoutRef.current) {
      clearTimeout(successCloseTimeoutRef.current);
      successCloseTimeoutRef.current = null;
    }
    setAddFeedback(null);
    onClose();
  };

  const runAddPrinter = async (device: BluetoothDevice, role: AddRole, paperWidth: 58 | 80) => {
    setAddFeedback({
      device,
      role,
      paperWidth,
      status: "saving",
      message: `Saving ${device.name || "printer"} as the ${role} printer...`,
    });

    try {
      const connected = await addPrinter(
        device,
        role,
        paperWidth,
        (progress: PrinterAddProgress) => {
          setAddFeedback((current) => {
            if (!current || current.device.address !== device.address) return current;

            return {
              ...current,
              status: progress,
              message:
                progress === "saving"
                  ? `Saving ${device.name || "printer"} as the ${role} printer...`
                  : `Connecting to ${device.name || "printer"}...`,
            };
          });
        },
      );

      if (!connected) {
        setAddFeedback({
          device,
          role,
          paperWidth,
          status: "error",
          message: `Saved "${device.name || "printer"}", but the connection failed. Make sure it is turned on and in range.`,
        });
        return;
      }

      setDevices((prev) => prev.filter((d) => d.address !== device.address));
      setAddFeedback({
        device,
        role,
        paperWidth,
        status: "success",
        message: `${device.name || "Printer"} connected successfully.`,
      });

      successCloseTimeoutRef.current = setTimeout(() => {
        successCloseTimeoutRef.current = null;
        closeWithReset();
      }, 1200);
    } catch {
      setAddFeedback({
        device,
        role,
        paperWidth,
        status: "error",
        message: `Could not add "${device.name || "printer"}". Please try again.`,
      });
    }
  };

  const handleAdd = (device: BluetoothDevice, role: "receipt" | "kitchen") => {
    Alert.alert("Paper Width", "Select the paper width for this printer", [
      {
        text: "58mm",
        onPress: () => void runAddPrinter(device, role, 58),
      },
      {
        text: "80mm",
        onPress: () => void runAddPrinter(device, role, 80),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <Modal
      visible={visible}
      onClose={
        addFeedback?.status === "saving" || addFeedback?.status === "connecting"
          ? undefined
          : closeWithReset
      }
      position="bottom"
      title="Scan for Printers"
      showCloseButton
    >
      {addFeedback && (
        <YStack
          backgroundColor={
            addFeedback.status === "success"
              ? "#DCFCE7"
              : addFeedback.status === "error"
                ? "#FEF2F2"
                : "#DBEAFE"
          }
          borderRadius={12}
          borderWidth={1}
          borderColor={
            addFeedback.status === "success"
              ? "#86EFAC"
              : addFeedback.status === "error"
                ? "#FECACA"
                : "#93C5FD"
          }
          padding={16}
          marginBottom={16}
        >
          <XStack alignItems="center" gap={12}>
            {addFeedback.status === "saving" || addFeedback.status === "connecting" ? (
              <ActivityIndicator size="small" color="#0D87E1" />
            ) : (
              <Ionicons
                name={addFeedback.status === "success" ? "checkmark-circle" : "alert-circle"}
                size={22}
                color={addFeedback.status === "success" ? "#16A34A" : "#DC2626"}
              />
            )}
            <YStack flex={1}>
              <Text
                variant="heading"
                size="sm"
                style={{
                  color:
                    addFeedback.status === "success"
                      ? "#166534"
                      : addFeedback.status === "error"
                        ? "#991B1B"
                        : "#1D4ED8",
                }}
              >
                {addFeedback.status === "saving"
                  ? "Adding printer"
                  : addFeedback.status === "connecting"
                    ? "Connecting printer"
                    : addFeedback.status === "success"
                      ? "Printer ready"
                      : "Connection failed"}
              </Text>
              <Text
                size="sm"
                style={{
                  marginTop: 4,
                  color:
                    addFeedback.status === "success"
                      ? "#166534"
                      : addFeedback.status === "error"
                        ? "#991B1B"
                        : "#1D4ED8",
                }}
              >
                {addFeedback.message}
              </Text>
            </YStack>
          </XStack>

          {addFeedback.status === "error" && (
            <XStack marginTop={12} gap={8}>
              <Button
                variant="primary"
                size="sm"
                onPress={() =>
                  void runAddPrinter(addFeedback.device, addFeedback.role, addFeedback.paperWidth)
                }
                style={{ flex: 1 }}
              >
                Retry
              </Button>
              <Button
                variant="outline"
                size="sm"
                onPress={() => setAddFeedback(null)}
                style={{ flex: 1 }}
              >
                Dismiss
              </Button>
            </XStack>
          )}
        </YStack>
      )}

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
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => handleAdd(device, "receipt")}
                  disabled={addFeedback !== null}
                >
                  Add as Receipt
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => handleAdd(device, "kitchen")}
                  disabled={addFeedback !== null}
                >
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

      <Button
        variant="outline"
        onPress={startScan}
        disabled={isScanning || addFeedback !== null}
        style={{ marginTop: 16 }}
      >
        Scan Again
      </Button>
    </Modal>
  );
};
