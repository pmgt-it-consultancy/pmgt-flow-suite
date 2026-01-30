import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAction } from "convex/react";
import Constants from "expo-constants";
import React, { useEffect } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import type { RootStackParamList } from "../../../navigation/Navigation";
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
    <View className="flex-1 bg-gray-100">
      {/* Header */}
      <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center">
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text className="text-xl font-bold flex-1">Software Update</Text>
      </View>

      <ScrollView className="flex-1 p-4">
        {/* Current Version Card */}
        <View className="bg-white rounded-xl p-4 mb-4">
          <Text className="text-sm text-gray-500 mb-1">Current Version</Text>
          <Text className="text-2xl font-bold">{currentVersion}</Text>
        </View>

        {/* Update Status */}
        {isChecking ? (
          <View className="bg-white rounded-xl p-6 mb-4 items-center">
            <ActivityIndicator size="large" color="#0D87E1" />
            <Text className="text-gray-500 mt-3 font-medium">Checking for updates...</Text>
          </View>
        ) : updateInfo ? (
          <View className="bg-white rounded-xl p-4 mb-4">
            <View className="flex-row items-center mb-2">
              <Ionicons name="arrow-up-circle" size={24} color="#0D87E1" />
              <Text className="text-lg font-bold ml-2">
                Version {updateInfo.latestVersion} Available
              </Text>
            </View>

            {updateInfo.releaseNotes ? (
              <Text className="text-sm text-gray-600 mb-4">{updateInfo.releaseNotes}</Text>
            ) : null}

            {/* Download / Progress / Install */}
            {downloadStatus === "idle" && (
              <TouchableOpacity
                onPress={handleDownload}
                className="bg-blue-500 rounded-lg py-3 items-center"
                style={{ backgroundColor: "#0D87E1" }}
              >
                <Text className="text-white font-semibold text-base">Download Update</Text>
              </TouchableOpacity>
            )}

            {downloadStatus === "downloading" && (
              <View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-sm text-gray-600">Downloading...</Text>
                  <Text className="text-sm font-semibold" style={{ color: "#0D87E1" }}>
                    {Math.round(downloadProgress * 100)}%
                  </Text>
                </View>
                <View className="bg-gray-200 rounded-full h-3 overflow-hidden">
                  <View
                    className="h-3 rounded-full"
                    style={{
                      backgroundColor: "#0D87E1",
                      width: `${Math.round(downloadProgress * 100)}%`,
                    }}
                  />
                </View>
              </View>
            )}

            {downloadStatus === "completed" && (
              <TouchableOpacity
                onPress={handleInstall}
                className="rounded-lg py-3 items-center"
                style={{ backgroundColor: "#22C55E" }}
              >
                <Text className="text-white font-semibold text-base">Install Update</Text>
              </TouchableOpacity>
            )}

            {downloadStatus === "failed" && (
              <View>
                <Text className="text-red-500 text-sm mb-2">{error ?? "Download failed"}</Text>
                <TouchableOpacity
                  onPress={handleDownload}
                  className="bg-red-500 rounded-lg py-3 items-center"
                >
                  <Text className="text-white font-semibold text-base">Retry Download</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          <View className="bg-white rounded-xl p-6 mb-4 items-center">
            <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
            <Text className="text-lg font-bold mt-2">Your app is up to date</Text>
            <Text className="text-sm text-gray-500 mt-1">You're running the latest version</Text>
          </View>
        )}

        {error && !updateInfo && (
          <View className="bg-red-50 rounded-xl p-4 mb-4">
            <Text className="text-red-600 text-sm">{error}</Text>
          </View>
        )}

        {/* Check for Updates Button */}
        {!isChecking && (
          <TouchableOpacity onPress={handleCheck} className="bg-white rounded-xl py-4 items-center">
            <Text className="font-semibold" style={{ color: "#0D87E1" }}>
              Check for Updates
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}
