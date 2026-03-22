import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useEffect, useState } from "react";
import {
  Pressable,
  Modal as RNModal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface SelectedProduct {
  id: Id<"products">;
  name: string;
  price: number;
  isOpenPrice?: boolean;
  minPrice?: number;
  maxPrice?: number;
}

interface AddItemModalProps {
  visible: boolean;
  product: SelectedProduct | null;
  quantity: number;
  notes: string;
  isLoading: boolean;
  onClose: () => void;
  onQuantityChange: (qty: number) => void;
  onNotesChange: (notes: string) => void;
  onConfirm: (customPrice?: number) => void;
}

export const AddItemModal = ({
  visible,
  product,
  quantity,
  notes,
  isLoading,
  onClose,
  onQuantityChange,
  onNotesChange,
  onConfirm,
}: AddItemModalProps) => {
  const formatCurrency = useFormatCurrency();
  const [customPriceText, setCustomPriceText] = useState("");

  useEffect(() => {
    if (visible) setCustomPriceText("");
  }, [visible]);

  if (!product) return null;

  const customPrice = parseFloat(customPriceText) || 0;
  const isOpenPrice = product.isOpenPrice ?? false;
  const minPrice = product.minPrice ?? 0;
  const maxPrice = product.maxPrice ?? Infinity;
  const isPriceValid = !isOpenPrice || (customPrice >= minPrice && customPrice <= maxPrice);
  const effectivePrice = isOpenPrice ? customPrice : product.price;
  const total = effectivePrice * quantity;

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
              maxHeight: "80%",
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
                    Add to Order
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
                        {maxPrice !== Infinity
                          ? `Range: ${formatCurrency(minPrice)} – ${formatCurrency(maxPrice)}`
                          : `Min: ${formatCurrency(minPrice)}`}
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
                <TouchableOpacity
                  onPress={onClose}
                  style={{ padding: 8, marginRight: -8, marginTop: -4 }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={24} color="#6B7280" />
                </TouchableOpacity>
              </XStack>

              {/* CONTENT - Scrollable */}
              <ScrollView
                contentContainerStyle={{ padding: 20 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Notes */}
                <YStack>
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
                    onChangeText={onNotesChange}
                    multiline
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={() => onConfirm(isOpenPrice ? customPrice : undefined)}
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
                  <TouchableOpacity
                    onPress={() => onQuantityChange(Math.max(1, quantity - 1))}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      backgroundColor: "#FEE2E2",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="remove" size={28} color="#EF4444" />
                  </TouchableOpacity>

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

                  <TouchableOpacity
                    onPress={() => onQuantityChange(quantity + 1)}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      backgroundColor: "#DCFCE7",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add" size={28} color="#22C55E" />
                  </TouchableOpacity>
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
                  {formatCurrency(total)}
                </Text>

                {/* Full-width Add Button */}
                <TouchableOpacity
                  onPress={() => onConfirm(isOpenPrice ? customPrice : undefined)}
                  disabled={isLoading || (isOpenPrice && !isPriceValid)}
                  style={{
                    backgroundColor:
                      isLoading || (isOpenPrice && !isPriceValid) ? "#9CA3AF" : "#0D87E1",
                    borderRadius: 12,
                    paddingVertical: 18,
                    width: "100%",
                    marginTop: 16,
                    opacity: isLoading || (isOpenPrice && !isPriceValid) ? 0.7 : 1,
                  }}
                  activeOpacity={0.8}
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
                </TouchableOpacity>
              </YStack>
            </View>
          </KeyboardAvoidingView>
        </View>
      </GestureHandlerRootView>
    </RNModal>
  );
};
