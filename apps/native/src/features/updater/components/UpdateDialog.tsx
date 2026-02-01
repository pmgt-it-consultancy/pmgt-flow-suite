import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { UpdateInfo } from "../stores/useUpdateStore";

type Props = {
  updateInfo: UpdateInfo;
  onGoToUpdates: () => void;
};

type OptionalProps = Props & {
  onDismiss: () => void;
};

export function OptionalUpdateDialog({ updateInfo, onGoToUpdates, onDismiss }: OptionalProps) {
  return (
    <Modal visible animationType="fade" transparent>
      <View style={optionalStyles.overlay}>
        <View style={optionalStyles.card}>
          <Text style={styles.title}>Update Available</Text>
          <Text style={styles.subtitle}>Version {updateInfo.latestVersion} is available.</Text>
          {updateInfo.releaseNotes ? (
            <Text style={styles.notes}>{updateInfo.releaseNotes}</Text>
          ) : null}
          <View style={optionalStyles.buttons}>
            <Pressable style={optionalStyles.laterButton} onPress={onDismiss}>
              <Text style={optionalStyles.laterButtonText}>Later</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={onGoToUpdates}>
              <Text style={styles.buttonText}>Update Now</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

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

const optionalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 32,
    width: "80%",
    maxWidth: 400,
    alignItems: "center",
  },
  buttons: {
    display: "flex",
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    alignItems: "flex-end",
  },
  laterButton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: "#CCC",
  },
  laterButtonText: {
    fontSize: 16,
    fontFamily: "SemiBold",
    color: "#666",
  },
});

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
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontFamily: "SemiBold",
  },
});
