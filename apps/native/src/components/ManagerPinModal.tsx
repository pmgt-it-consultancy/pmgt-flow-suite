import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { RFValue } from "react-native-responsive-fontsize";
import { useAction, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { useSessionToken, useAuth } from "../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";

interface ManagerPinModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (managerId: Id<"users">) => void;
  title?: string;
  description?: string;
}

const ManagerPinModal = ({
  visible,
  onClose,
  onSuccess,
  title = "Manager Authorization",
  description = "Enter manager PIN to proceed",
}: ManagerPinModalProps) => {
  const { user } = useAuth();
  const token = useSessionToken();
  const [pin, setPin] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState<Id<"users"> | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Get users with manager permissions from the user's store
  const users = useQuery(
    api.users.list,
    token && user?.storeId ? { token, storeId: user.storeId } : "skip"
  );

  const verifyPin = useAction(api.auth.verifyManagerPin);

  // Filter to only show users who might have manager PIN
  const managers = users?.filter(
    (u) =>
      u.isActive &&
      (u.roleName === "Admin" ||
        u.roleName === "Manager" ||
        u.roleName === "Super Admin")
  );

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setPin("");
      setSelectedManagerId(null);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [visible]);

  const handleVerify = async () => {
    if (!selectedManagerId) {
      Alert.alert("Error", "Please select a manager");
      return;
    }

    if (!pin || pin.length < 4) {
      Alert.alert("Error", "Please enter a valid PIN (4-6 digits)");
      return;
    }

    setIsVerifying(true);
    try {
      const isValid = await verifyPin({
        userId: selectedManagerId,
        pin,
      });

      if (isValid) {
        onSuccess(selectedManagerId);
        onClose();
      } else {
        Alert.alert("Error", "Invalid PIN. Please try again.");
        setPin("");
      }
    } catch (error) {
      console.error("PIN verification error:", error);
      Alert.alert("Error", "Failed to verify PIN");
    } finally {
      setIsVerifying(false);
    }
  };

  const handlePinChange = (value: string) => {
    // Only allow digits
    const cleanedValue = value.replace(/[^0-9]/g, "").slice(0, 6);
    setPin(cleanedValue);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="shield-checkmark" size={32} color="#0D87E1" />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.description}>{description}</Text>
          </View>

          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
          >
            <Ionicons name="close" size={24} color="#6B7280" />
          </TouchableOpacity>

          {/* Manager Selection */}
          <Text style={styles.label}>Select Manager</Text>
          <View style={styles.managerList}>
            {managers?.map((manager) => (
              <TouchableOpacity
                key={manager._id}
                style={[
                  styles.managerOption,
                  selectedManagerId === manager._id && styles.managerOptionActive,
                ]}
                onPress={() => setSelectedManagerId(manager._id)}
              >
                <View style={styles.managerInfo}>
                  <Text style={styles.managerName}>{manager.name}</Text>
                  <Text style={styles.managerRole}>{manager.roleName}</Text>
                </View>
                {selectedManagerId === manager._id && (
                  <Ionicons name="checkmark-circle" size={24} color="#0D87E1" />
                )}
              </TouchableOpacity>
            ))}
            {!managers?.length && (
              <Text style={styles.noManagers}>No managers available</Text>
            )}
          </View>

          {/* PIN Input */}
          <Text style={styles.label}>Enter PIN</Text>
          <View style={styles.pinContainer}>
            <TextInput
              ref={inputRef}
              style={styles.pinInput}
              value={pin}
              onChangeText={handlePinChange}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              placeholder="****"
              placeholderTextColor="#D1D5DB"
            />
            <View style={styles.pinDots}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.pinDot,
                    pin.length > i && styles.pinDotFilled,
                  ]}
                />
              ))}
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              disabled={isVerifying}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.verifyButton,
                (!selectedManagerId || pin.length < 4 || isVerifying) &&
                  styles.verifyButtonDisabled,
              ]}
              onPress={handleVerify}
              disabled={!selectedManagerId || pin.length < 4 || isVerifying}
            >
              {isVerifying ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.verifyButtonText}>Verify</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  content: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  closeButton: {
    position: "absolute",
    top: 16,
    right: 16,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontFamily: "SemiBold",
    fontSize: RFValue(18),
    color: "#111827",
    marginBottom: 8,
  },
  description: {
    fontFamily: "Regular",
    fontSize: RFValue(12),
    color: "#6B7280",
    textAlign: "center",
  },
  label: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#374151",
    marginBottom: 8,
  },
  managerList: {
    marginBottom: 20,
  },
  managerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    marginBottom: 8,
  },
  managerOptionActive: {
    borderColor: "#0D87E1",
    backgroundColor: "#EFF6FF",
  },
  managerInfo: {
    flex: 1,
  },
  managerName: {
    fontFamily: "Medium",
    fontSize: RFValue(13),
    color: "#111827",
  },
  managerRole: {
    fontFamily: "Regular",
    fontSize: RFValue(11),
    color: "#6B7280",
  },
  noManagers: {
    fontFamily: "Regular",
    fontSize: RFValue(12),
    color: "#9CA3AF",
    textAlign: "center",
    padding: 20,
  },
  pinContainer: {
    marginBottom: 24,
  },
  pinInput: {
    position: "absolute",
    opacity: 0,
    width: "100%",
    height: 60,
  },
  pinDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 16,
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#E5E7EB",
  },
  pinDotFilled: {
    backgroundColor: "#0D87E1",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
  },
  cancelButtonText: {
    fontFamily: "Medium",
    fontSize: RFValue(13),
    color: "#6B7280",
  },
  verifyButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#0D87E1",
    alignItems: "center",
  },
  verifyButtonDisabled: {
    backgroundColor: "#D1D5DB",
  },
  verifyButtonText: {
    fontFamily: "SemiBold",
    fontSize: RFValue(13),
    color: "#FFFFFF",
  },
});

export default ManagerPinModal;
