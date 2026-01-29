import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ScrollView, TouchableOpacity, View } from "uniwind/components";
import { IconButton, Text } from "../../shared/components/ui";
import { usePrinterStore } from "../stores/usePrinterStore";

interface SettingsScreenProps {
  navigation: any;
}

export const SettingsScreen = ({ navigation }: SettingsScreenProps) => {
  const printers = usePrinterStore((s) => s.printers);

  return (
    <View className="flex-1 bg-gray-100">
      {/* Header */}
      <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center">
        <IconButton icon="arrow-back" variant="ghost" onPress={() => navigation.goBack()} />
        <Text className="text-xl font-bold ml-3">Settings</Text>
      </View>

      {/* Settings List */}
      <ScrollView>
        {/* Printers */}
        <TouchableOpacity
          className="bg-white px-4 py-4 flex-row items-center border-b border-gray-100"
          onPress={() => navigation.navigate("PrinterSettingsScreen")}
        >
          <View className="w-10 h-10 rounded-full bg-blue-50 items-center justify-center">
            <Ionicons name="print-outline" size={20} color="#0D87E1" />
          </View>
          <View className="flex-1 ml-3">
            <Text className="text-base font-semibold">Printers</Text>
            <Text className="text-sm text-gray-500">
              {printers.length} {printers.length === 1 ? "printer" : "printers"} configured
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};
