import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAction } from "convex/react";
import Constants from "expo-constants";
import { useEffect } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import type { RootStackParamList } from "../../../navigation/Navigation";
import { PageHeader } from "../../shared/components/PageHeader";
import { useUpdateStore } from "../stores/useUpdateStore";

type Props = NativeStackScreenProps<RootStackParamList, "UpdatesScreen">;

export function UpdatesScreen({ navigation }: Props) {
  const checkForUpdate = useAction(api.appUpdate.checkForUpdate);
  const getApkDownloadUrl = useAction(api.appUpdate.getApkDownloadUrl);

  const {
    updateInfo,
    downloadStatus,
    downloadProgress,
    isChecking,
    error,
    checkForUpdate: storeCheck,
    startDownload,
    installUpdate,
  } = useUpdateStore();

  const currentVersion = Constants.expoConfig?.version ?? "0.0.0";

  // Check on mount
  useEffect(() => {
    storeCheck(checkForUpdate);
  }, [storeCheck, checkForUpdate]);

  const handleCheck = () => storeCheck(checkForUpdate);
  const handleDownload = () => startDownload(getApkDownloadUrl);
  const handleInstall = () => installUpdate();

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      <PageHeader title="Software Update" onBack={() => navigation.goBack()} />

      <ScrollView style={{ flex: 1, padding: 16 }}>
        {/* Current Version Card */}
        <YStack backgroundColor="#FFFFFF" borderRadius={12} padding={16} marginBottom={16}>
          <Text style={{ fontSize: 14, color: "#6B7280", marginBottom: 4 }}>Current Version</Text>
          <Text style={{ fontSize: 24, fontWeight: "700" }}>{currentVersion}</Text>
        </YStack>

        {/* Update Status */}
        {isChecking ? (
          <YStack
            backgroundColor="#FFFFFF"
            borderRadius={12}
            padding={24}
            marginBottom={16}
            alignItems="center"
          >
            <ActivityIndicator size="large" color="#0D87E1" />
            <Text style={{ color: "#6B7280", marginTop: 12, fontWeight: "500" }}>
              Checking for updates...
            </Text>
          </YStack>
        ) : updateInfo ? (
          <YStack backgroundColor="#FFFFFF" borderRadius={12} padding={16} marginBottom={16}>
            <XStack alignItems="center" marginBottom={8}>
              <Ionicons name="arrow-up-circle" size={24} color="#0D87E1" />
              <Text style={{ fontSize: 18, fontWeight: "700", marginLeft: 8 }}>
                Version {updateInfo.latestVersion} Available
              </Text>
            </XStack>

            {updateInfo.releaseNotes ? (
              <Text style={{ fontSize: 14, color: "#4B5563", marginBottom: 16 }}>
                {updateInfo.releaseNotes}
              </Text>
            ) : null}

            {/* Download / Progress / Install */}
            {downloadStatus === "idle" && (
              <TouchableOpacity
                onPress={handleDownload}
                style={{
                  backgroundColor: "#0D87E1",
                  borderRadius: 8,
                  paddingVertical: 12,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 16 }}>
                  Download Update
                </Text>
              </TouchableOpacity>
            )}

            {downloadStatus === "downloading" && (
              <YStack>
                <XStack justifyContent="space-between" marginBottom={8}>
                  <Text style={{ fontSize: 14, color: "#4B5563" }}>Downloading...</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "#0D87E1" }}>
                    {Math.round(downloadProgress * 100)}%
                  </Text>
                </XStack>
                <YStack backgroundColor="#E5E7EB" borderRadius={9999} height={12} overflow="hidden">
                  <YStack
                    height={12}
                    borderRadius={9999}
                    backgroundColor="#0D87E1"
                    width={`${Math.round(downloadProgress * 100)}%` as any}
                  />
                </YStack>
              </YStack>
            )}

            {downloadStatus === "completed" && (
              <TouchableOpacity
                onPress={handleInstall}
                style={{
                  backgroundColor: "#22C55E",
                  borderRadius: 8,
                  paddingVertical: 12,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 16 }}>
                  Install Update
                </Text>
              </TouchableOpacity>
            )}

            {downloadStatus === "failed" && (
              <YStack>
                <Text style={{ color: "#EF4444", fontSize: 14, marginBottom: 8 }}>
                  {error ?? "Download failed"}
                </Text>
                <TouchableOpacity
                  onPress={handleDownload}
                  style={{
                    backgroundColor: "#EF4444",
                    borderRadius: 8,
                    paddingVertical: 12,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 16 }}>
                    Retry Download
                  </Text>
                </TouchableOpacity>
              </YStack>
            )}
          </YStack>
        ) : (
          <YStack
            backgroundColor="#FFFFFF"
            borderRadius={12}
            padding={24}
            marginBottom={16}
            alignItems="center"
          >
            <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
            <Text style={{ fontSize: 18, fontWeight: "700", marginTop: 8 }}>
              Your app is up to date
            </Text>
            <Text style={{ fontSize: 14, color: "#6B7280", marginTop: 4 }}>
              You're running the latest version
            </Text>
          </YStack>
        )}

        {error && !updateInfo && (
          <YStack backgroundColor="#FEF2F2" borderRadius={12} padding={16} marginBottom={16}>
            <Text style={{ color: "#DC2626", fontSize: 14 }}>{error}</Text>
          </YStack>
        )}

        {/* Check for Updates Button */}
        {!isChecking && (
          <TouchableOpacity
            onPress={handleCheck}
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 12,
              paddingVertical: 16,
              alignItems: "center",
            }}
          >
            <Text style={{ fontWeight: "600", color: "#0D87E1" }}>Check for Updates</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </YStack>
  );
}
