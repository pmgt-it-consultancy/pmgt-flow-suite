import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  type TextInput as RNTextInput,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { Button, Modal, Text } from "../../shared/components/ui";

interface ManagerPinModalProps {
  visible: boolean;
  title?: string;
  description?: string;
  onClose: () => void;
  onSuccess: (managerId: Id<"users">, pin: string) => void;
}

export const ManagerPinModal = ({
  visible,
  title = "Manager Approval",
  description = "Enter manager PIN to proceed",
  onClose,
  onSuccess,
}: ManagerPinModalProps) => {
  const { user } = useAuth();
  const [selectedManagerId, setSelectedManagerId] = useState<Id<"users"> | null>(null);
  const [pin, setPin] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const pinInputRef = useRef<RNTextInput>(null);

  // Query managers for this store - auth handled by Convex Auth provider
  const managers = useQuery(
    api.helpers.usersHelpers.listManagers,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  const verifyPin = useAction(api.users.verifyPin);

  const handleVerify = useCallback(async () => {
    if (!selectedManagerId || !pin) return;

    setIsVerifying(true);
    try {
      const result = await verifyPin({
        userId: selectedManagerId,
        pin,
      });

      if (result.success) {
        onSuccess(selectedManagerId, pin);
        setPin("");
        setSelectedManagerId(null);
      } else {
        Alert.alert("Invalid PIN", result.error || "The PIN entered is incorrect");
      }
    } catch (error) {
      console.error("Verify PIN error:", error);
      Alert.alert("Error", "Failed to verify PIN");
    } finally {
      setIsVerifying(false);
    }
  }, [selectedManagerId, pin, verifyPin, onSuccess]);

  const handleClose = useCallback(() => {
    setPin("");
    setSelectedManagerId(null);
    onClose();
  }, [onClose]);

  const handleSelectManager = useCallback((managerId: Id<"users">) => {
    setSelectedManagerId(managerId);
    // Auto-focus PIN input after selecting a manager
    setTimeout(() => pinInputRef.current?.focus(), 100);
  }, []);

  return (
    <Modal
      visible={visible}
      title={title}
      onClose={handleClose}
      onRequestClose={handleClose}
      position="center"
    >
      <Text variant="muted" style={{ marginBottom: 16 }}>
        {description}
      </Text>

      {/* Manager Selection */}
      <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8 }}>Select Manager</Text>
      <YStack marginBottom={16}>
        {managers === undefined ? (
          <ActivityIndicator size="small" color="#0D87E1" />
        ) : managers.length === 0 ? (
          <Text variant="muted" style={{ textAlign: "center", paddingVertical: 16 }}>
            No managers found
          </Text>
        ) : (
          managers.map((manager) => (
            <TouchableOpacity
              key={manager._id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 12,
                borderWidth: 1,
                borderRadius: 8,
                marginBottom: 8,
                borderColor: selectedManagerId === manager._id ? "#0D87E1" : "#E5E7EB",
                backgroundColor: selectedManagerId === manager._id ? "#EFF6FF" : undefined,
              }}
              onPress={() => handleSelectManager(manager._id)}
              activeOpacity={0.7}
            >
              <YStack
                width={40}
                height={40}
                borderRadius={20}
                backgroundColor="#E5E7EB"
                alignItems="center"
                justifyContent="center"
                marginRight={12}
              >
                <Text style={{ color: "#4B5563", fontWeight: "600" }}>
                  {manager.name.charAt(0).toUpperCase()}
                </Text>
              </YStack>
              <YStack flex={1}>
                <Text style={{ color: "#111827", fontWeight: "500" }}>{manager.name}</Text>
                <Text variant="muted" size="xs">
                  {manager.roleName}
                </Text>
              </YStack>
            </TouchableOpacity>
          ))
        )}
      </YStack>

      {/* PIN Input */}
      <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8 }}>Enter PIN</Text>
      <TextInput
        ref={pinInputRef}
        style={{
          borderWidth: 1,
          borderColor: "#E5E7EB",
          borderRadius: 8,
          padding: 12,
          fontSize: 20,
          textAlign: "center",
          letterSpacing: 8,
        }}
        placeholder="••••"
        placeholderTextColor="#9CA3AF"
        value={pin}
        onChangeText={setPin}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        returnKeyType="go"
        onSubmitEditing={() => {
          if (selectedManagerId && pin) handleVerify();
        }}
      />

      <Button
        variant="primary"
        size="lg"
        loading={isVerifying}
        disabled={!selectedManagerId || !pin || isVerifying}
        onPress={handleVerify}
        style={{ marginTop: 20, opacity: !selectedManagerId || !pin ? 0.5 : 1 }}
      >
        Verify & Approve
      </Button>
    </Modal>
  );
};
