import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Switch } from "react-native";
import { ScrollView, TouchableOpacity, View } from "uniwind/components";
import { Button } from "../../shared/components/ui/Button";
import { Text } from "../../shared/components/ui/Text";
import { EditPrinterModal } from "../components/EditPrinterModal";
import { ScanPrintersModal } from "../components/ScanPrintersModal";
import type { PrinterConfig } from "../services/printerStorage";
import { usePrinterStore } from "../stores/usePrinterStore";

export const PrinterSettingsScreen = ({ navigation }: { navigation: any }) => {
  const [showScanModal, setShowScanModal] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<PrinterConfig | null>(null);

  const {
    printers,
    connectionStatus,
    kitchenPrintingEnabled,
    setKitchenPrintingEnabled,
    testPrint,
    removePrinter,
  } = usePrinterStore();

  const handleRemove = (printer: PrinterConfig) => {
    Alert.alert("Remove Printer", `Are you sure you want to remove "${printer.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => removePrinter(printer.id),
      },
    ]);
  };

  return (
    <View className="flex-1 bg-gray-100">
      {/* Header */}
      <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center">
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text variant="heading" size="lg">
          Printers
        </Text>
      </View>

      <ScrollView className="flex-1">
        {/* Kitchen Printing Toggle */}
        <View className="bg-white mx-4 mt-4 rounded-xl p-4 flex-row items-center justify-between">
          <View className="flex-1 mr-4">
            <Text variant="heading" size="md">
              Kitchen Printing
            </Text>
            <Text variant="muted" size="sm" className="mt-1">
              Print kitchen tickets at checkout
            </Text>
          </View>
          <Switch
            value={kitchenPrintingEnabled}
            onValueChange={setKitchenPrintingEnabled}
            trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Section Header */}
        <Text className="uppercase text-xs text-gray-500 px-4 py-2 mt-4">Paired Printers</Text>

        {/* Printer Cards */}
        {printers.length === 0 ? (
          <View className="bg-white rounded-xl p-4 mx-4 mb-3 items-center py-8">
            <Ionicons name="print-outline" size={40} color="#9CA3AF" />
            <Text variant="muted" size="md" className="mt-2">
              No printers configured
            </Text>
          </View>
        ) : (
          printers.map((printer) => {
            const isConnected = connectionStatus[printer.id] ?? false;

            return (
              <View key={printer.id} className="bg-white rounded-xl p-4 mx-4 mb-3">
                {/* Printer info */}
                <View className="flex-row items-center mb-1">
                  <Ionicons name="print" size={20} color="#374151" />
                  <Text variant="heading" size="md" className="ml-2">
                    {printer.name}
                  </Text>
                </View>

                <Text variant="muted" size="sm" className="mb-2">
                  Role: {printer.role === "receipt" ? "Receipt" : "Kitchen"} | Paper:{" "}
                  {printer.paperWidth}mm
                </Text>

                {/* Connection status */}
                <View className="flex-row items-center mb-3">
                  <View
                    className={`w-2 h-2 rounded-full mr-2 ${isConnected ? "bg-green-500" : "bg-gray-400"}`}
                  />
                  <Text size="sm" className={isConnected ? "text-green-600" : "text-gray-500"}>
                    {isConnected ? "Connected" : "Disconnected"}
                  </Text>
                </View>

                {/* Action buttons */}
                <View className="flex-row gap-2">
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
                    className="border-red-300"
                  >
                    <Text className="text-red-500 text-sm font-medium">Remove</Text>
                  </Button>
                </View>
              </View>
            );
          })
        )}

        {/* Scan button */}
        <View className="px-4 mt-4 mb-8">
          <Button variant="primary" size="md" onPress={() => setShowScanModal(true)}>
            Scan for Printers
          </Button>
        </View>
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
    </View>
  );
};
