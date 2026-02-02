import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import React from "react";
import { ScrollView, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { IconButton, Text } from "../../shared/components/ui";
import { usePrinterStore } from "../stores/usePrinterStore";

interface SettingsScreenProps {
  navigation: any;
}

export const SettingsScreen = ({ navigation }: SettingsScreenProps) => {
  const printers = usePrinterStore((s) => s.printers);

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      {/* Header */}
      <XStack
        backgroundColor="#FFFFFF"
        paddingHorizontal={16}
        paddingVertical={16}
        borderBottomWidth={1}
        borderColor="#E5E7EB"
        alignItems="center"
      >
        <IconButton icon="arrow-back" variant="ghost" onPress={() => navigation.goBack()} />
        <Text style={{ fontSize: 20, fontWeight: "700", marginLeft: 12, flex: 1 }}>Settings</Text>
        <SystemStatusBar />
      </XStack>

      {/* Settings List */}
      <ScrollView>
        {/* Printers */}
        <TouchableOpacity
          style={{
            backgroundColor: "#FFFFFF",
            paddingHorizontal: 16,
            paddingVertical: 16,
            flexDirection: "row",
            alignItems: "center",
            borderBottomWidth: 1,
            borderBottomColor: "#F3F4F6",
          }}
          onPress={() => navigation.navigate("PrinterSettingsScreen")}
        >
          <YStack
            width={40}
            height={40}
            borderRadius={20}
            backgroundColor="#EFF6FF"
            alignItems="center"
            justifyContent="center"
          >
            <Ionicons name="print-outline" size={20} color="#0D87E1" />
          </YStack>
          <YStack flex={1} marginLeft={12}>
            <Text style={{ fontSize: 16, fontWeight: "600" }}>Printers</Text>
            <Text style={{ fontSize: 14, color: "#6B7280" }}>
              {printers.length} {printers.length === 1 ? "printer" : "printers"} configured
            </Text>
          </YStack>
          <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
        </TouchableOpacity>

        {/* Check for Updates */}
        <TouchableOpacity
          style={{
            backgroundColor: "#FFFFFF",
            paddingHorizontal: 16,
            paddingVertical: 16,
            flexDirection: "row",
            alignItems: "center",
            borderBottomWidth: 1,
            borderBottomColor: "#F3F4F6",
          }}
          onPress={() => navigation.navigate("UpdatesScreen")}
        >
          <YStack
            width={40}
            height={40}
            borderRadius={20}
            backgroundColor="#EFF6FF"
            alignItems="center"
            justifyContent="center"
          >
            <Ionicons name="cloud-download-outline" size={20} color="#0D87E1" />
          </YStack>
          <YStack flex={1} marginLeft={12}>
            <Text style={{ fontSize: 16, fontWeight: "600" }}>Check for Updates</Text>
            <Text style={{ fontSize: 14, color: "#6B7280" }}>
              Version {Constants.expoConfig?.version ?? "1.0.0"}
            </Text>
          </YStack>
          <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
        </TouchableOpacity>
      </ScrollView>
    </YStack>
  );
};
