import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, TextInput, TouchableOpacity, View } from "uniwind/components";
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
      <ScrollView className="max-h-[400px]">
        {/* Product Header */}
        <Text variant="heading" size="xl" className="mb-1">
          {product.name}
        </Text>
        <Text className="text-blue-500 font-medium text-lg mb-4">
          {formatCurrency(product.price)}
        </Text>

        {/* Modifier Groups */}
        {modifierGroups.map((group) => (
          <View key={group.groupId} className="mb-4">
            <View className="flex-row items-center mb-2">
              <Text className="text-gray-900 font-semibold text-base">{group.groupName}</Text>
              {group.minSelections > 0 ? (
                <View className="bg-red-100 rounded px-2 py-0.5 ml-2">
                  <Text className="text-red-600 text-xs font-medium">Required</Text>
                </View>
              ) : (
                <View className="bg-gray-100 rounded px-2 py-0.5 ml-2">
                  <Text className="text-gray-500 text-xs font-medium">Optional</Text>
                </View>
              )}
              {group.selectionType === "multi" && group.maxSelections && (
                <Text className="text-gray-400 text-xs ml-2">(max {group.maxSelections})</Text>
              )}
            </View>

            {group.options.map((option) => {
              const isSelected = selections[group.groupId]?.has(option.optionId) ?? false;
              const isSingle = group.selectionType === "single";

              return (
                <TouchableOpacity
                  key={option.optionId}
                  className={`flex-row items-center justify-between py-3 px-3 mb-1 rounded-lg ${
                    isSelected
                      ? "bg-blue-50 border border-blue-200"
                      : "bg-gray-50 border border-gray-100"
                  }`}
                  onPress={() => handleSelectOption(group, option.optionId)}
                  activeOpacity={0.7}
                >
                  <View className="flex-row items-center flex-1">
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
                      className={`ml-3 text-sm ${isSelected ? "text-gray-900 font-medium" : "text-gray-700"}`}
                    >
                      {option.name}
                    </Text>
                  </View>
                  {option.priceAdjustment !== 0 && (
                    <Text
                      className={`text-sm ${isSelected ? "text-blue-600 font-medium" : "text-gray-500"}`}
                    >
                      +{formatCurrency(option.priceAdjustment)}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {/* Quantity */}
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-gray-700 font-medium">Quantity</Text>
          <View className="flex-row items-center bg-gray-100 rounded-lg">
            <IconButton
              icon="remove"
              size="md"
              variant="ghost"
              iconColor="#EF4444"
              onPress={() => setQuantity(Math.max(1, quantity - 1))}
            />
            <Text className="text-gray-900 font-semibold text-lg px-5">{quantity}</Text>
            <IconButton
              icon="add"
              size="md"
              variant="ghost"
              iconColor="#22C55E"
              onPress={() => setQuantity(quantity + 1)}
            />
          </View>
        </View>

        {/* Notes */}
        <View className="mb-4">
          <Text className="text-gray-700 font-medium mb-2">Notes (optional)</Text>
          <TextInput
            className="border border-gray-200 rounded-lg p-3 text-base min-h-[60px] text-top"
            placeholder="E.g., no ice, extra spicy..."
            placeholderTextColor="#9CA3AF"
            value={notes}
            onChangeText={setNotes}
            multiline
            returnKeyType="done"
            blurOnSubmit
          />
        </View>
      </ScrollView>

      {/* Footer */}
      <View className="flex-row justify-between items-center pt-4 border-t border-gray-200">
        <Text className="text-gray-900 font-bold text-lg">Total: {formatCurrency(lineTotal)}</Text>
        <Button
          variant="primary"
          loading={isLoading}
          disabled={isLoading || !isValid}
          onPress={handleConfirm}
          className="min-w-[120px]"
        >
          Add to Order
        </Button>
      </View>
    </Modal>
  );
};
