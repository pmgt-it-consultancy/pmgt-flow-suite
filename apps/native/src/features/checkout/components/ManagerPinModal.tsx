import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useCallback, useRef, useState } from "react";
import type { TextInput as RNTextInput } from "react-native";
import { Alert } from "react-native";
import { ActivityIndicator, TextInput, TouchableOpacity, View } from "uniwind/components";
import { useAuth } from "../../auth/context";
import { Button, Modal, Text } from "../../shared/components/ui";

interface ManagerPinModalProps {
  visible: boolean;
  title?: string;
  description?: string;
  onClose: () => void;
  onSuccess: (managerId: Id<"users">) => void;
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
        onSuccess(selectedManagerId);
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
      <Text variant="muted" className="mb-4">
        {description}
      </Text>

      {/* Manager Selection */}
      <Text className="text-gray-700 font-medium mb-2">Select Manager</Text>
      <View className="mb-4">
        {managers === undefined ? (
          <ActivityIndicator size="small" color="#0D87E1" />
        ) : managers.length === 0 ? (
          <Text variant="muted" className="text-center py-4">
            No managers found
          </Text>
        ) : (
          managers.map((manager) => (
            <TouchableOpacity
              key={manager._id}
              className={`flex-row items-center p-3 border rounded-lg mb-2 ${
                selectedManagerId === manager._id ? "border-blue-500 bg-blue-50" : "border-gray-200"
              }`}
              onPress={() => handleSelectManager(manager._id)}
              activeOpacity={0.7}
            >
              <View className="w-10 h-10 rounded-full bg-gray-200 items-center justify-center mr-3">
                <Text className="text-gray-600 font-semibold">
                  {manager.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 font-medium">{manager.name}</Text>
                <Text variant="muted" size="xs">
                  {manager.roleName}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* PIN Input */}
      <Text className="text-gray-700 font-medium mb-2">Enter PIN</Text>
      <TextInput
        ref={pinInputRef}
        className="border border-gray-200 rounded-lg p-3 text-xl text-center tracking-widest"
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
        className={`mt-5 ${!selectedManagerId || !pin ? "opacity-50" : ""}`}
      >
        Verify & Approve
      </Button>
    </Modal>
  );
};
