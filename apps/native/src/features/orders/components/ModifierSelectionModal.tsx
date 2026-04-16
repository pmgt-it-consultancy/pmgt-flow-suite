import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal as RNModal, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { GestureHandlerRootView, Pressable } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
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
  product: {
    id: Id<"products">;
    name: string;
    price: number;
    isOpenPrice?: boolean;
    minPrice?: number;
    maxPrice?: number;
  } | null;
  modifierGroups: ModifierGroup[];
  isLoading: boolean;
  onClose: () => void;
  onConfirm: (
    quantity: number,
    notes: string,
    modifiers: SelectedModifier[],
    customPrice?: number,
  ) => void;
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
  const [customPriceText, setCustomPriceText] = useState("");
  // Map of groupId -> Set of selected optionIds
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    if (!visible) return;

    if (product?.isOpenPrice) {
      setCustomPriceText(String(product.minPrice ?? ""));
      return;
    }

    setCustomPriceText("");
  }, [visible, product]);

  const customPrice = parseFloat(customPriceText) || 0;
  const isOpenPrice = product?.isOpenPrice ?? false;
  const openMinPrice = product?.minPrice ?? 0;
  const openMaxPrice = product?.maxPrice ?? Infinity;
  const isPriceValid =
    !isOpenPrice ||
    (customPriceText.trim() !== "" &&
      customPrice > 0 &&
      customPrice >= openMinPrice &&
      customPrice <= openMaxPrice);

  useEffect(() => {
    if (!visible || !product) return;
    const defaults: Record<string, Set<string>> = {};
    for (const group of modifierGroups) {
      const defaultOptions = group.options.filter((o) => o.isDefault);
      defaults[group.groupId] =
        defaultOptions.length > 0 ? new Set(defaultOptions.map((o) => o.optionId)) : new Set();
    }
    setSelections(defaults);
    setQuantity(1);
    setNotes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modifierGroups is derived per-product; resetting only when the user opens a different product is intentional.
  }, [product?.id, visible]);

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

    onConfirm(quantity, notes, modifiers, isOpenPrice ? customPrice : undefined);
  }, [product, modifierGroups, selections, quantity, notes, onConfirm, isOpenPrice, customPrice]);

  if (!product) return null;

  const basePrice = isOpenPrice ? customPrice : product.price;
  const unitTotal = basePrice + modifierTotal;
  const lineTotal = unitTotal * quantity;

  return (
    <RNModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          {/* Backdrop */}
          <Pressable
            onPress={onClose}
            style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)" }]}
          />

          <KeyboardAvoidingView
            behavior="padding"
            style={{
              backgroundColor: "#FFFFFF",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              maxHeight: "92%",
            }}
          >
            <View style={{ maxHeight: "100%" }}>
              {/* HEADER - Fixed */}
              <XStack
                paddingHorizontal={20}
                paddingTop={20}
                paddingBottom={16}
                borderBottomWidth={1}
                borderBottomColor="#E5E7EB"
                alignItems="flex-start"
              >
                <YStack flex={1}>
                  <Text variant="heading" size="lg">
                    Customize Order
                  </Text>
                  <Text size="lg" style={{ marginTop: 4 }}>
                    {product.name}
                  </Text>
                  {isOpenPrice ? (
                    <YStack marginTop={6}>
                      <XStack alignItems="center">
                        <Text
                          style={{
                            color: "#6B7280",
                            fontSize: 18,
                            fontWeight: "600",
                            marginRight: 4,
                          }}
                        >
                          ₱
                        </Text>
                        <TextInput
                          style={{
                            fontSize: 24,
                            fontWeight: "700",
                            color: "#0D87E1",
                            borderBottomWidth: 2,
                            borderBottomColor:
                              customPriceText && !isPriceValid ? "#EF4444" : "#0D87E1",
                            paddingVertical: 2,
                            paddingHorizontal: 4,
                            minWidth: 120,
                          }}
                          keyboardType="decimal-pad"
                          autoFocus
                          placeholder="0.00"
                          placeholderTextColor="#9CA3AF"
                          value={customPriceText}
                          onChangeText={setCustomPriceText}
                        />
                      </XStack>
                      <Text style={{ color: "#6B7280", fontSize: 12, marginTop: 4 }}>
                        {openMaxPrice !== Infinity
                          ? `Range: ${formatCurrency(openMinPrice)} – ${formatCurrency(openMaxPrice)}`
                          : `Min: ${formatCurrency(openMinPrice)}`}
                      </Text>
                    </YStack>
                  ) : (
                    <Text
                      style={{ color: "#0D87E1", fontWeight: "600", fontSize: 18, marginTop: 2 }}
                    >
                      {formatCurrency(product.price)}
                    </Text>
                  )}
                </YStack>
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  onPress={onClose}
                  style={({ pressed }) => [
                    { padding: 8, marginRight: -8, marginTop: -4 },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={24} color="#6B7280" />
                </Pressable>
              </XStack>

              {/* CONTENT - Scrollable */}
              <ScrollView
                contentContainerStyle={{ padding: 20, paddingBottom: 8 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={true}
              >
                {/* Modifier Groups */}
                {modifierGroups.map((group) => (
                  <YStack key={group.groupId} marginBottom={20}>
                    <XStack alignItems="center" marginBottom={10}>
                      <Text style={{ color: "#111827", fontWeight: "600", fontSize: 16 }}>
                        {group.groupName}
                      </Text>
                      {group.minSelections > 0 ? (
                        <YStack
                          backgroundColor="#FEE2E2"
                          borderRadius={6}
                          paddingHorizontal={10}
                          paddingVertical={4}
                          marginLeft={10}
                        >
                          <Text style={{ color: "#DC2626", fontSize: 12, fontWeight: "600" }}>
                            Required
                          </Text>
                        </YStack>
                      ) : (
                        <YStack
                          backgroundColor="#F3F4F6"
                          borderRadius={6}
                          paddingHorizontal={10}
                          paddingVertical={4}
                          marginLeft={10}
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
                        <Pressable
                          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                          key={option.optionId}
                          style={({ pressed }) => [
                            {
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              paddingVertical: 14,
                              paddingHorizontal: 14,
                              marginBottom: 6,
                              borderRadius: 10,
                              backgroundColor: isSelected ? "#EFF6FF" : "#F9FAFB",
                              borderWidth: 1.5,
                              borderColor: isSelected ? "#BFDBFE" : "#F3F4F6",
                              minHeight: 52,
                            },
                            { opacity: pressed ? 0.7 : 1 },
                          ]}
                          onPress={() => handleSelectOption(group, option.optionId)}
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
                              size={24}
                              color={isSelected ? "#3B82F6" : "#9CA3AF"}
                            />
                            <Text
                              style={{
                                marginLeft: 12,
                                fontSize: 16,
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
                                fontSize: 15,
                                color: isSelected ? "#2563EB" : "#6B7280",
                                fontWeight: isSelected ? "600" : "400",
                              }}
                            >
                              +{formatCurrency(option.priceAdjustment)}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </YStack>
                ))}

                {/* Notes */}
                <YStack marginBottom={8}>
                  <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8 }}>
                    Notes (optional)
                  </Text>
                  <TextInput
                    style={{
                      borderWidth: 1,
                      borderColor: "#E5E7EB",
                      borderRadius: 10,
                      padding: 14,
                      fontSize: 16,
                      minHeight: 72,
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

              {/* FOOTER - Fixed */}
              <YStack
                paddingHorizontal={20}
                paddingTop={16}
                paddingBottom={24}
                borderTopWidth={1}
                borderTopColor="#E5E7EB"
                backgroundColor="#FFFFFF"
              >
                {/* Quantity Controls - Large 56x56 buttons */}
                <XStack justifyContent="center" alignItems="center" gap={16}>
                  <Pressable
                    android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                    onPress={() => setQuantity(Math.max(1, quantity - 1))}
                    style={({ pressed }) => [
                      {
                        width: 56,
                        height: 56,
                        borderRadius: 12,
                        backgroundColor: "#FEE2E2",
                        justifyContent: "center",
                        alignItems: "center",
                      },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Ionicons name="remove" size={28} color="#EF4444" />
                  </Pressable>

                  <YStack
                    minWidth={80}
                    paddingVertical={12}
                    paddingHorizontal={24}
                    backgroundColor="#F3F4F6"
                    borderRadius={12}
                    alignItems="center"
                  >
                    <Text style={{ fontSize: 28, fontWeight: "700", color: "#111827" }}>
                      {quantity}
                    </Text>
                  </YStack>

                  <Pressable
                    android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                    onPress={() => setQuantity(quantity + 1)}
                    style={({ pressed }) => [
                      {
                        width: 56,
                        height: 56,
                        borderRadius: 12,
                        backgroundColor: "#DCFCE7",
                        justifyContent: "center",
                        alignItems: "center",
                      },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Ionicons name="add" size={28} color="#22C55E" />
                  </Pressable>
                </XStack>

                {/* Total */}
                <Text
                  style={{
                    color: "#111827",
                    fontWeight: "700",
                    fontSize: 20,
                    textAlign: "center",
                    marginTop: 12,
                  }}
                >
                  {formatCurrency(lineTotal)}
                </Text>

                {/* Full-width Add Button */}
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  onPress={handleConfirm}
                  disabled={!isValid || isLoading || (isOpenPrice && !isPriceValid)}
                  style={({ pressed }) => [
                    {
                      backgroundColor:
                        isValid && !isLoading && (!isOpenPrice || isPriceValid)
                          ? "#0D87E1"
                          : "#9CA3AF",
                      borderRadius: 12,
                      paddingVertical: 18,
                      width: "100%",
                      marginTop: 16,
                      opacity: isLoading || (isOpenPrice && !isPriceValid) ? 0.7 : 1,
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontWeight: "700",
                      fontSize: 18,
                      textAlign: "center",
                    }}
                  >
                    {isLoading ? "Adding..." : `Add ${quantity} to Order`}
                  </Text>
                </Pressable>
              </YStack>
            </View>
          </KeyboardAvoidingView>
        </View>
      </GestureHandlerRootView>
    </RNModal>
  );
};
