import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { UpdateInfo } from "../stores/useUpdateStore";

type Props = {
  updateInfo: UpdateInfo;
  onGoToUpdates: () => void;
};

export function ForceUpdateModal({ updateInfo, onGoToUpdates }: Props) {
  return (
    <Modal visible animationType="fade" transparent={false}>
      <View style={styles.container}>
        <Text style={styles.title}>Update Required</Text>
        <Text style={styles.subtitle}>
          Version {updateInfo.latestVersion} is required to continue using this app.
        </Text>
        {updateInfo.releaseNotes ? (
          <Text style={styles.notes}>{updateInfo.releaseNotes}</Text>
        ) : null}
        <Pressable style={styles.button} onPress={onGoToUpdates}>
          <Text style={styles.buttonText}>Go to Updates</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  title: {
    fontSize: 24,
    fontFamily: "Bold",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    fontFamily: "Regular",
    textAlign: "center",
    marginBottom: 8,
    color: "#333",
  },
  notes: {
    fontSize: 14,
    fontFamily: "Regular",
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#0D87E1",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 16,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontFamily: "SemiBold",
  },
});
