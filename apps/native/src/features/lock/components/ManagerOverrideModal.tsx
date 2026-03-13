import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, TouchableOpacity } from "react-native";
import { YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { Button, Input, Modal, Text } from "../../shared/components/ui";

interface ManagerOverrideModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (managerId: Id<"users">, pin: string) => void;
  isVerifying?: boolean;
}

export function ManagerOverrideModal({
  visible,
  onClose,
  onSubmit,
  isVerifying = false,
}: ManagerOverrideModalProps) {
  const { user } = useAuth();
  const [selectedManagerId, setSelectedManagerId] = useState<Id<"users"> | null>(null);
  const [pin, setPin] = useState("");

  const managers = useQuery(
    api.helpers.usersHelpers.listManagers,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  const handleClose = useCallback(() => {
    setSelectedManagerId(null);
    setPin("");
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    if (!selectedManagerId || !pin) {
      return;
    }

    onSubmit(selectedManagerId, pin);
  }, [onSubmit, pin, selectedManagerId]);

  useEffect(() => {
    if (!visible || isVerifying) {
      return;
    }

    setPin("");
  }, [isVerifying, visible]);

  return (
    <Modal
      visible={visible}
      title="Manager Override"
      onClose={handleClose}
      onRequestClose={handleClose}
      position="center"
    >
      <YStack gap={16}>
        <Text style={{ fontSize: 14, color: "#6B7280" }}>
          A manager can unlock this screen with their PIN.
        </Text>

        <YStack gap={8}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: "#374151" }}>Select Manager</Text>
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
            {managers === undefined ? (
              <YStack paddingVertical={24} alignItems="center">
                <ActivityIndicator size="small" color="#0D87E1" />
              </YStack>
            ) : managers.length === 0 ? (
              <Text
                style={{
                  fontSize: 14,
                  color: "#6B7280",
                  textAlign: "center",
                  paddingVertical: 20,
                }}
              >
                No managers with PINs available. Contact your administrator.
              </Text>
            ) : (
              managers.map((manager) => (
                <TouchableOpacity
                  key={manager._id}
                  onPress={() => setSelectedManagerId(manager._id)}
                  activeOpacity={0.7}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderRadius: 10,
                    backgroundColor: selectedManagerId === manager._id ? "#DBEAFE" : "#F9FAFB",
                    borderWidth: 1,
                    borderColor: selectedManagerId === manager._id ? "#0D87E1" : "#E5E7EB",
                    marginBottom: 8,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <YStack>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: "#111827" }}>
                      {manager.name}
                    </Text>
                    <Text style={{ fontSize: 13, color: "#6B7280" }}>{manager.roleName}</Text>
                  </YStack>
                  {selectedManagerId === manager._id && (
                    <Ionicons name="checkmark-circle" size={20} color="#0D87E1" />
                  )}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </YStack>

        {selectedManagerId && (
          <YStack gap={8}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#374151" }}>Enter PIN</Text>
            <Input
              value={pin}
              onChangeText={setPin}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={6}
              placeholder="Enter manager PIN"
            />
          </YStack>
        )}

        <Button
          variant="primary"
          size="lg"
          onPress={handleSubmit}
          disabled={!selectedManagerId || !pin || isVerifying}
          loading={isVerifying}
        >
          {isVerifying ? "Verifying..." : "Unlock"}
        </Button>
      </YStack>
    </Modal>
  );
}
