import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Constants from "expo-constants";
import { useMemo, useState } from "react";
import { Alert, Modal as RNModal, ScrollView, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { PageHeader } from "../../shared/components/PageHeader";
import { Text } from "../../shared/components/ui";
import { usePrinterStore } from "../stores/usePrinterStore";

interface SettingsScreenProps {
  navigation: any;
}

export const SettingsScreen = ({ navigation }: SettingsScreenProps) => {
  const { user, hasPermission } = useAuth();
  const printers = usePrinterStore((s) => s.printers);
  const storeId = user?.storeId;
  const [showTimeoutPicker, setShowTimeoutPicker] = useState(false);
  const autoLockTimeout = useQuery(
    api.screenLock.getAutoLockTimeout,
    storeId ? { storeId } : "skip",
  );
  const setAutoLockTimeoutMutation = useMutation(api.screenLock.setAutoLockTimeout);

  const timeoutOptions = useMemo(
    () => [
      { label: "Disabled", value: 0 },
      { label: "1 minute", value: 1 },
      { label: "2 minutes", value: 2 },
      { label: "5 minutes", value: 5 },
      { label: "10 minutes", value: 10 },
      { label: "15 minutes", value: 15 },
      { label: "30 minutes", value: 30 },
    ],
    [],
  );

  const currentLabel =
    timeoutOptions.find((option) => option.value === autoLockTimeout)?.label ?? "5 minutes";

  const canManageAutoLock = hasPermission("system.settings");

  const handleOpenTimeoutPicker = () => {
    if (!canManageAutoLock) {
      Alert.alert(
        "Permission Required",
        "Only managers with settings access can change auto-lock.",
      );
      return;
    }

    setShowTimeoutPicker(true);
  };

  const handleSetTimeout = async (minutes: number) => {
    if (!storeId) {
      return;
    }

    try {
      await setAutoLockTimeoutMutation({ storeId, minutes });
      setShowTimeoutPicker(false);
    } catch (error) {
      Alert.alert(
        "Unable to Update",
        error instanceof Error ? error.message : "Failed to update auto-lock timeout.",
      );
    }
  };

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      <PageHeader title="Settings" onBack={() => navigation.goBack()} />

      {/* Settings List */}
      <ScrollView>
        {/* Printers */}
        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          style={({ pressed }) => [
            {
              backgroundColor: "#FFFFFF",
              paddingHorizontal: 16,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              borderBottomWidth: 1,
              borderBottomColor: "#F3F4F6",
            },
            { opacity: pressed ? 0.7 : 1 },
          ]}
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
        </Pressable>

        {/* Check for Updates */}
        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          style={({ pressed }) => [
            {
              backgroundColor: "#FFFFFF",
              paddingHorizontal: 16,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              borderBottomWidth: 1,
              borderBottomColor: "#F3F4F6",
            },
            { opacity: pressed ? 0.7 : 1 },
          ]}
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
        </Pressable>

        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          style={({ pressed }) => [
            {
              backgroundColor: "#FFFFFF",
              paddingHorizontal: 16,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              borderBottomWidth: 1,
              borderBottomColor: "#F3F4F6",
              opacity: canManageAutoLock ? 1 : 0.7,
            },
            { opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={handleOpenTimeoutPicker}
        >
          <YStack
            width={40}
            height={40}
            borderRadius={20}
            backgroundColor="#FEF3C7"
            alignItems="center"
            justifyContent="center"
          >
            <Ionicons name="timer-outline" size={20} color="#D97706" />
          </YStack>
          <YStack flex={1} marginLeft={12}>
            <Text style={{ fontSize: 16, fontWeight: "600" }}>Auto-Lock After</Text>
            <Text style={{ fontSize: 14, color: "#6B7280" }}>
              {currentLabel}
              {!canManageAutoLock ? " · Requires settings access" : ""}
            </Text>
          </YStack>
          <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
        </Pressable>
      </ScrollView>

      <RNModal
        visible={showTimeoutPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTimeoutPicker(false)}
        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
      >
        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          style={({ pressed }) => [
            {
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.4)",
              justifyContent: "center",
              alignItems: "center",
            },
            { opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={() => setShowTimeoutPicker(false)}
        >
          <Pressable onPress={() => {}}>
            <View
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 16,
                width: "100%",
                maxHeight: "60%",
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: "#E5E7EB",
                }}
              >
                <Text style={{ fontSize: 18, fontWeight: "700" }}>Auto-Lock After</Text>
              </View>
              <ScrollView>
                {timeoutOptions.map((option) => (
                  <Pressable
                    android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                    key={option.value}
                    style={({ pressed }) => [
                      {
                        paddingHorizontal: 20,
                        paddingVertical: 16,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: autoLockTimeout === option.value ? "#EFF6FF" : "#FFFFFF",
                        borderBottomWidth: 1,
                        borderBottomColor: "#F3F4F6",
                      },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => handleSetTimeout(option.value)}
                  >
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: autoLockTimeout === option.value ? "600" : "400",
                        color: autoLockTimeout === option.value ? "#0D87E1" : "#111827",
                      }}
                    >
                      {option.label}
                    </Text>
                    {autoLockTimeout === option.value && (
                      <Ionicons name="checkmark" size={20} color="#0D87E1" />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Pressable>
      </RNModal>
    </YStack>
  );
};
