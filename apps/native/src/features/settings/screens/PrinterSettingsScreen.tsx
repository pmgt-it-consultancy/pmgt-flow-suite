import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, ScrollView, Switch } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { PageHeader } from "../../shared/components/PageHeader";
import { Button } from "../../shared/components/ui/Button";
import { Text } from "../../shared/components/ui/Text";
import { EditPrinterModal } from "../components/EditPrinterModal";
import { ScanPrintersModal } from "../components/ScanPrintersModal";
import type { PrinterConfig } from "../services/printerStorage";
import type { PrinterConnectionStatus } from "../stores/usePrinterStore";
import { usePrinterStore } from "../stores/usePrinterStore";

export const PrinterSettingsScreen = ({ navigation }: { navigation: any }) => {
  const [showScanModal, setShowScanModal] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<PrinterConfig | null>(null);

  const {
    printers,
    connectionStatus,
    kitchenPrintingEnabled,
    cashDrawerEnabled,
    useReceiptPrinterForKitchen,
    setKitchenPrintingEnabled,
    setCashDrawerEnabled,
    setUseReceiptPrinterForKitchen,
    openCashDrawer,
    testPrint,
    removePrinter,
    connectPrinter,
    setConnectionStatus,
    resetReconnectAttempts,
  } = usePrinterStore();

  const handleOpenDrawer = async () => {
    try {
      await openCashDrawer();
    } catch {
      Alert.alert("Error", "Failed to open cash drawer. Make sure a receipt printer is connected.");
    }
  };

  const handleRemove = (printer: PrinterConfig) => {
    Alert.alert(
      "Remove Printer",
      `Remove "${printer.name}" from the app and unpair it from this device?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove & Unpair",
          style: "destructive",
          onPress: () => removePrinter(printer.id),
        },
      ],
    );
  };

  const handleReconnect = async (printer: PrinterConfig) => {
    setConnectionStatus(printer.id, "reconnecting");
    resetReconnectAttempts(printer.id);

    const connected = await connectPrinter(printer.id);
    if (!connected) {
      setConnectionStatus(printer.id, "failed");
      Alert.alert(
        "Reconnect Failed",
        `Could not connect to "${printer.name}". Make sure the printer is turned on and in range.`,
        [
          { text: "Retry", onPress: () => handleReconnect(printer) },
          { text: "Dismiss", style: "cancel" },
        ],
      );
    }
  };

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      <PageHeader title="Printers" onBack={() => navigation.goBack()} />

      <ScrollView style={{ flex: 1 }}>
        {/* Kitchen Printing Toggle */}
        <XStack
          backgroundColor="#FFFFFF"
          marginHorizontal={16}
          marginTop={16}
          borderRadius={12}
          padding={16}
          alignItems="center"
          justifyContent="space-between"
        >
          <YStack flex={1} marginRight={16}>
            <Text variant="heading" size="base">
              Kitchen Printing
            </Text>
            <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
              Print kitchen tickets at checkout
            </Text>
          </YStack>
          <Switch
            value={kitchenPrintingEnabled}
            onValueChange={setKitchenPrintingEnabled}
            trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
            thumbColor="#FFFFFF"
          />
        </XStack>

        {/* Use Receipt Printer for Kitchen Toggle */}
        {kitchenPrintingEnabled && !printers.some((p) => p.role === "kitchen") && (
          <XStack
            backgroundColor="#FFFFFF"
            marginHorizontal={16}
            marginTop={12}
            borderRadius={12}
            padding={16}
            alignItems="center"
            justifyContent="space-between"
          >
            <YStack flex={1} marginRight={16}>
              <Text variant="heading" size="base">
                Use Receipt Printer for Kitchen
              </Text>
              <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
                Print kitchen tickets on the receipt printer
              </Text>
            </YStack>
            <Switch
              value={useReceiptPrinterForKitchen}
              onValueChange={setUseReceiptPrinterForKitchen}
              trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
              thumbColor="#FFFFFF"
            />
          </XStack>
        )}

        {/* Cash Drawer Toggle */}
        <XStack
          backgroundColor="#FFFFFF"
          marginHorizontal={16}
          marginTop={12}
          borderRadius={12}
          padding={16}
          alignItems="center"
          justifyContent="space-between"
        >
          <YStack flex={1} marginRight={16}>
            <Text variant="heading" size="base">
              Cash Drawer
            </Text>
            <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
              Auto-open cash drawer after payment
            </Text>
          </YStack>
          <Switch
            value={cashDrawerEnabled}
            onValueChange={setCashDrawerEnabled}
            trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
            thumbColor="#FFFFFF"
          />
        </XStack>

        {/* Manual Open Drawer Button */}
        {cashDrawerEnabled && (
          <YStack paddingHorizontal={16} marginTop={12}>
            <Pressable
              android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
              onPress={handleOpenDrawer}
              style={({ pressed }) => [
                {
                  backgroundColor: "#FFFFFF",
                  borderRadius: 12,
                  padding: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons
                name="lock-open-outline"
                size={20}
                color="#0D87E1"
                style={{ marginRight: 8 }}
              />
              <Text style={{ color: "#0D87E1", fontWeight: "600", fontSize: 15 }}>
                Open Cash Drawer
              </Text>
            </Pressable>
          </YStack>
        )}

        {/* Section Header */}
        <Text
          style={{
            textTransform: "uppercase",
            fontSize: 12,
            color: "#6B7280",
            paddingHorizontal: 16,
            paddingVertical: 8,
            marginTop: 16,
          }}
        >
          Paired Printers
        </Text>

        {/* Printer Cards */}
        {printers.length === 0 ? (
          <YStack
            backgroundColor="#FFFFFF"
            borderRadius={12}
            padding={16}
            marginHorizontal={16}
            marginBottom={12}
            alignItems="center"
            paddingVertical={32}
          >
            <Ionicons name="print-outline" size={40} color="#9CA3AF" />
            <Text variant="muted" size="base" style={{ marginTop: 8 }}>
              No printers configured
            </Text>
          </YStack>
        ) : (
          printers.map((printer) => {
            const status: PrinterConnectionStatus = connectionStatus[printer.id] ?? "disconnected";

            return (
              <YStack
                key={printer.id}
                backgroundColor="#FFFFFF"
                borderRadius={12}
                padding={16}
                marginHorizontal={16}
                marginBottom={12}
              >
                {/* Printer info */}
                <XStack alignItems="center" marginBottom={4}>
                  <Ionicons name="print" size={20} color="#374151" />
                  <Text variant="heading" size="base" style={{ marginLeft: 8 }}>
                    {printer.name}
                  </Text>
                </XStack>

                <Text variant="muted" size="sm" style={{ marginBottom: 8 }}>
                  Role: {printer.role === "receipt" ? "Receipt" : "Kitchen"} | Paper:{" "}
                  {printer.paperWidth}mm
                </Text>

                {/* Connection status */}
                <XStack alignItems="center" marginBottom={12}>
                  <YStack
                    width={8}
                    height={8}
                    borderRadius={4}
                    marginRight={8}
                    backgroundColor={
                      status === "connected"
                        ? "#22C55E"
                        : status === "reconnecting"
                          ? "#F59E0B"
                          : status === "failed"
                            ? "#EF4444"
                            : "#9CA3AF"
                    }
                  />
                  <Text
                    size="sm"
                    style={{
                      color:
                        status === "connected"
                          ? "#16A34A"
                          : status === "reconnecting"
                            ? "#D97706"
                            : status === "failed"
                              ? "#DC2626"
                              : "#6B7280",
                    }}
                  >
                    {status === "connected"
                      ? "Connected"
                      : status === "reconnecting"
                        ? "Reconnecting..."
                        : status === "failed"
                          ? "Connection Failed"
                          : "Disconnected"}
                  </Text>
                </XStack>

                {/* Action buttons */}
                <XStack gap={8} flexWrap="wrap">
                  {(status === "disconnected" || status === "failed") && (
                    <Button variant="outline" size="sm" onPress={() => handleReconnect(printer)}>
                      <Text style={{ color: "#0D87E1", fontSize: 14, fontWeight: "500" }}>
                        Reconnect
                      </Text>
                    </Button>
                  )}
                  {status === "reconnecting" && (
                    <Button variant="outline" size="sm" disabled>
                      <Text style={{ color: "#9CA3AF", fontSize: 14, fontWeight: "500" }}>
                        Reconnecting...
                      </Text>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onPress={() => testPrint(printer.id)}>
                    Test Print
                  </Button>
                  <Button variant="outline" size="sm" onPress={() => setEditingPrinter(printer)}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => handleRemove(printer)}
                    style={{ borderColor: "#FCA5A5" }}
                  >
                    <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "500" }}>
                      Remove
                    </Text>
                  </Button>
                </XStack>
              </YStack>
            );
          })
        )}

        {/* Scan button */}
        <YStack paddingHorizontal={16} marginTop={16} marginBottom={32}>
          <Button variant="primary" size="md" onPress={() => setShowScanModal(true)}>
            Scan for Printers
          </Button>
        </YStack>
      </ScrollView>

      {/* Modals */}
      <ScanPrintersModal visible={showScanModal} onClose={() => setShowScanModal(false)} />

      {editingPrinter && (
        <EditPrinterModal
          visible={!!editingPrinter}
          printer={editingPrinter}
          onClose={() => setEditingPrinter(null)}
        />
      )}
    </YStack>
  );
};
