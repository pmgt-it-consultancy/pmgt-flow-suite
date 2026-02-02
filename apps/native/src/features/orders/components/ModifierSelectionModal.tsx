import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, TextInput, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Button, IconButton, Modal, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface ModifierGroup {
  groupId: Id<"modifierGroups">;
  groupName: string;
  selectionType: "single" | "multi";
  minSelections: number;
  maxSelections?: number;
  sortOrder: number;
  options: {
    optionId: Id<"modifierOptions">;
    name: string;
    priceAdjustment: number;
    isDefault: boolean;
  }[];
}

export interface SelectedModifier {
  modifierGroupName: string;
  modifierOptionName: string;
  priceAdjustment: number;
}

interface ModifierSelectionModalProps {
  visible: boolean;
  product: { id: Id<"products">; name: string; price: number } | null;
  modifierGroups: ModifierGroup[];
  isLoading: boolean;
  onClose: () => void;
  onConfirm: (quantity: number, notes: string, modifiers: SelectedModifier[]) => void;
}

export const ModifierSelectionModal = ({
  visible,
  product,
  modifierGroups,
  isLoading,
  onClose,
  onConfirm,
}: ModifierSelectionModalProps) => {
  const formatCurrency = useFormatCurrency();
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  // Map of groupId -> Set of selected optionIds
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});

  // Initialize defaults when modal opens
  const initializedRef = useState<string | null>(null);
  if (product && initializedRef[0] !== product.id) {
    const defaults: Record<string, Set<string>> = {};
    for (const group of modifierGroups) {
      const defaultOptions = group.options.filter((o) => o.isDefault);
      if (defaultOptions.length > 0) {
        defaults[group.groupId] = new Set(defaultOptions.map((o) => o.optionId));
      } else {
        defaults[group.groupId] = new Set();
      }
    }
    setSelections(defaults);
    setQuantity(1);
    setNotes("");
    initializedRef[1](product.id);
  }

  const handleSelectOption = useCallback((group: ModifierGroup, optionId: string) => {
    setSelections((prev) => {
      const current = new Set(prev[group.groupId] ?? []);

      if (group.selectionType === "single") {
        // Single select: replace
        return { ...prev, [group.groupId]: new Set([optionId]) };
      }

      // Multi select: toggle
      if (current.has(optionId)) {
        current.delete(optionId);
      } else {
        // Check max
        if (group.maxSelections && current.size >= group.maxSelections) {
          return prev;
        }
        current.add(optionId);
      }
      return { ...prev, [group.groupId]: current };
    });
  }, []);

  // Calculate modifier total
  const modifierTotal = useMemo(() => {
    let total = 0;
    for (const group of modifierGroups) {
      const selected = selections[group.groupId];
      if (!selected) continue;
      for (const option of group.options) {
        if (selected.has(option.optionId)) {
          total += option.priceAdjustment;
        }
      }
    }
    return total;
  }, [modifierGroups, selections]);

  // Check if all required groups are satisfied
  const isValid = useMemo(() => {
    for (const group of modifierGroups) {
      const selected = selections[group.groupId];
      const count = selected?.size ?? 0;
      if (count < group.minSelections) return false;
    }
    return true;
  }, [modifierGroups, selections]);

  const handleConfirm = useCallback(() => {
    if (!product) return;

    const modifiers: SelectedModifier[] = [];
    for (const group of modifierGroups) {
      const selected = selections[group.groupId];
      if (!selected) continue;
      for (const option of group.options) {
        if (selected.has(option.optionId)) {
          modifiers.push({
            modifierGroupName: group.groupName,
            modifierOptionName: option.name,
            priceAdjustment: option.priceAdjustment,
          });
        }
      }
    }

    onConfirm(quantity, notes, modifiers);
  }, [product, modifierGroups, selections, quantity, notes, onConfirm]);

  if (!product) return null;

  const unitTotal = product.price + modifierTotal;
  const lineTotal = unitTotal * quantity;

  return (
    <Modal visible={visible} title="Customize Order" onClose={onClose} onRequestClose={onClose}>
      <ScrollView style={{ maxHeight: 400 }}>
        {/* Product Header */}
        <Text variant="heading" size="xl" style={{ marginBottom: 4 }}>
          {product.name}
        </Text>
        <Text style={{ color: "#0D87E1", fontWeight: "500", fontSize: 18, marginBottom: 16 }}>
          {formatCurrency(product.price)}
        </Text>

        {/* Modifier Groups */}
        {modifierGroups.map((group) => (
          <YStack key={group.groupId} marginBottom={16}>
            <XStack alignItems="center" marginBottom={8}>
              <Text style={{ color: "#111827", fontWeight: "600", fontSize: 16 }}>
                {group.groupName}
              </Text>
              {group.minSelections > 0 ? (
                <YStack
                  backgroundColor="#FEE2E2"
                  borderRadius={4}
                  paddingHorizontal={8}
                  paddingVertical={2}
                  marginLeft={8}
                >
                  <Text style={{ color: "#DC2626", fontSize: 12, fontWeight: "500" }}>
                    Required
                  </Text>
                </YStack>
              ) : (
                <YStack
                  backgroundColor="#F3F4F6"
                  borderRadius={4}
                  paddingHorizontal={8}
                  paddingVertical={2}
                  marginLeft={8}
                >
                  <Text style={{ color: "#6B7280", fontSize: 12, fontWeight: "500" }}>
                    Optional
                  </Text>
                </YStack>
              )}
              {group.selectionType === "multi" && group.maxSelections && (
                <Text style={{ color: "#9CA3AF", fontSize: 12, marginLeft: 8 }}>
                  (max {group.maxSelections})
                </Text>
              )}
            </XStack>

            {group.options.map((option) => {
              const isSelected = selections[group.groupId]?.has(option.optionId) ?? false;
              const isSingle = group.selectionType === "single";

              return (
                <TouchableOpacity
                  key={option.optionId}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    marginBottom: 4,
                    borderRadius: 8,
                    backgroundColor: isSelected ? "#EFF6FF" : "#F9FAFB",
                    borderWidth: 1,
                    borderColor: isSelected ? "#BFDBFE" : "#F3F4F6",
                  }}
                  onPress={() => handleSelectOption(group, option.optionId)}
                  activeOpacity={0.7}
                >
                  <XStack alignItems="center" flex={1}>
                    <Ionicons
                      name={
                        isSelected
                          ? isSingle
                            ? "radio-button-on"
                            : "checkbox"
                          : isSingle
                            ? "radio-button-off"
                            : "square-outline"
                      }
                      size={20}
                      color={isSelected ? "#3B82F6" : "#9CA3AF"}
                    />
                    <Text
                      style={{
                        marginLeft: 12,
                        fontSize: 14,
                        color: isSelected ? "#111827" : "#374151",
                        fontWeight: isSelected ? "500" : "400",
                      }}
                    >
                      {option.name}
                    </Text>
                  </XStack>
                  {option.priceAdjustment !== 0 && (
                    <Text
                      style={{
                        fontSize: 14,
                        color: isSelected ? "#2563EB" : "#6B7280",
                        fontWeight: isSelected ? "500" : "400",
                      }}
                    >
                      +{formatCurrency(option.priceAdjustment)}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </YStack>
        ))}

        {/* Quantity */}
        <XStack justifyContent="space-between" alignItems="center" marginBottom={16}>
          <Text style={{ color: "#374151", fontWeight: "500" }}>Quantity</Text>
          <XStack alignItems="center" backgroundColor="#F3F4F6" borderRadius={8}>
            <IconButton
              icon="remove"
              size="md"
              variant="ghost"
              iconColor="#EF4444"
              onPress={() => setQuantity(Math.max(1, quantity - 1))}
            />
            <Text
              style={{ color: "#111827", fontWeight: "600", fontSize: 18, paddingHorizontal: 20 }}
            >
              {quantity}
            </Text>
            <IconButton
              icon="add"
              size="md"
              variant="ghost"
              iconColor="#22C55E"
              onPress={() => setQuantity(quantity + 1)}
            />
          </XStack>
        </XStack>

        {/* Notes */}
        <YStack marginBottom={16}>
          <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8 }}>
            Notes (optional)
          </Text>
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: "#E5E7EB",
              borderRadius: 8,
              padding: 12,
              fontSize: 16,
              minHeight: 60,
              textAlignVertical: "top",
            }}
            placeholder="E.g., no ice, extra spicy..."
            placeholderTextColor="#9CA3AF"
            value={notes}
            onChangeText={setNotes}
            multiline
            returnKeyType="done"
            blurOnSubmit
          />
        </YStack>
      </ScrollView>

      {/* Footer */}
      <XStack
        justifyContent="space-between"
        alignItems="center"
        paddingTop={16}
        borderTopWidth={1}
        borderTopColor="#E5E7EB"
      >
        <Text style={{ color: "#111827", fontWeight: "700", fontSize: 18 }}>
          Total: {formatCurrency(lineTotal)}
        </Text>
        <Button
          variant="primary"
          loading={isLoading}
          disabled={isLoading || !isValid}
          onPress={handleConfirm}
          style={{ minWidth: 120 }}
        >
          Add to Order
        </Button>
      </XStack>
    </Modal>
  );
};
