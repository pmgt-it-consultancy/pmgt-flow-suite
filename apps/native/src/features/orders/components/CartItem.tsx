import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { memo, useState } from "react";
import { ActivityIndicator, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface CartItemModifier {
  groupName: string;
  optionName: string;
  priceAdjustment: number;
}

interface CartItemProps {
  id: Id<"orderItems">;
  productName: string;
  productPrice: number;
  quantity: number;
  lineTotal: number;
  notes?: string;
  modifiers?: CartItemModifier[];
  isSentToKitchen: boolean;
  onIncrement: (id: Id<"orderItems">, currentQty: number) => void;
  onDecrement: (id: Id<"orderItems">, currentQty: number) => void;
  onVoidItem?: (id: Id<"orderItems">) => void;
  serviceType?: "dine_in" | "takeout";
  orderDefaultServiceType?: "dine_in" | "takeout";
  onServiceTypeChange?: (
    id: Id<"orderItems">,
    serviceType: "dine_in" | "takeout",
  ) => void | Promise<void>;
}

export const CartItem = memo(
  ({
    id,
    productName,
    productPrice,
    quantity,
    lineTotal,
    notes,
    modifiers,
    isSentToKitchen,
    onIncrement,
    onDecrement,
    onVoidItem,
    serviceType,
    orderDefaultServiceType,
    onServiceTypeChange,
  }: CartItemProps) => {
    const formatCurrency = useFormatCurrency();
    const [isUpdatingServiceType, setIsUpdatingServiceType] = useState(false);
    const currentServiceType = serviceType ?? orderDefaultServiceType ?? "dine_in";

    const handleServiceTypePress = async (newType: "dine_in" | "takeout") => {
      if (isUpdatingServiceType || currentServiceType === newType) return;
      setIsUpdatingServiceType(true);
      try {
        await onServiceTypeChange?.(id, newType);
      } finally {
        setIsUpdatingServiceType(false);
      }
    };

    return (
      <YStack
        paddingHorizontal={12}
        paddingVertical={12}
        borderBottomWidth={1}
        borderBottomColor="#F3F4F6"
      >
        <XStack justifyContent="space-between" alignItems="flex-start" marginBottom={8}>
          <YStack flex={1} marginRight={12}>
            <XStack alignItems="center">
              <Text style={{ color: "#111827", fontWeight: "600", fontSize: 14 }} numberOfLines={1}>
                {productName}
              </Text>
              {isSentToKitchen && (
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color="#22C55E"
                  style={{ marginLeft: 4 }}
                />
              )}
            </XStack>
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 2 }}>
              {formatCurrency(productPrice)} each
            </Text>
            {modifiers && modifiers.length > 0 && (
              <YStack marginTop={2}>
                {modifiers.map((mod, idx) => (
                  <Text key={idx} style={{ color: "#6B7280", fontSize: 12 }}>
                    {mod.optionName}
                    {mod.priceAdjustment > 0 ? ` (+${formatCurrency(mod.priceAdjustment)})` : ""}
                  </Text>
                ))}
              </YStack>
            )}
            {notes && (
              <Text
                style={{ color: "#D97706", fontSize: 12, marginTop: 2, fontStyle: "italic" }}
                numberOfLines={1}
              >
                {notes}
              </Text>
            )}
          </YStack>
          <Text style={{ color: "#111827", fontWeight: "700", fontSize: 14 }}>
            {formatCurrency(lineTotal)}
          </Text>
        </XStack>

        <XStack alignItems="center" justifyContent="space-between">
          {isSentToKitchen ? (
            <>
              <XStack alignItems="center" gap={8}>
                <YStack
                  backgroundColor="#F3F4F6"
                  paddingHorizontal={14}
                  paddingVertical={8}
                  borderRadius={8}
                >
                  <Text style={{ color: "#374151", fontWeight: "600", fontSize: 14 }}>
                    Qty: {quantity}
                  </Text>
                </YStack>
                {onVoidItem && (
                  <TouchableOpacity
                    onPress={() => onVoidItem(id)}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: "#FEF2F2",
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: "#FECACA",
                    }}
                  >
                    <Text style={{ color: "#DC2626", fontWeight: "600", fontSize: 13 }}>Void</Text>
                  </TouchableOpacity>
                )}
              </XStack>
              <XStack
                borderRadius={8}
                overflow="hidden"
                borderWidth={1}
                borderColor="#E5E7EB"
                opacity={0.5}
              >
                <TouchableOpacity
                  disabled
                  activeOpacity={1}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    backgroundColor: currentServiceType === "dine_in" ? "#DBEAFE" : "white",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "600",
                      color: currentServiceType === "dine_in" ? "#0D87E1" : "#9CA3AF",
                    }}
                  >
                    DINE IN
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled
                  activeOpacity={1}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderLeftWidth: 1,
                    borderLeftColor: "#E5E7EB",
                    backgroundColor: currentServiceType === "takeout" ? "#DBEAFE" : "white",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "600",
                      color: currentServiceType === "takeout" ? "#0D87E1" : "#9CA3AF",
                    }}
                  >
                    TAKEOUT
                  </Text>
                </TouchableOpacity>
              </XStack>
            </>
          ) : (
            <>
              <XStack alignItems="center" gap={8}>
                <TouchableOpacity
                  onPress={() => onDecrement(id, quantity)}
                  activeOpacity={0.7}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    backgroundColor: "#FEE2E2",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons name="remove" size={22} color="#EF4444" />
                </TouchableOpacity>

                <YStack
                  minWidth={48}
                  paddingVertical={10}
                  paddingHorizontal={14}
                  backgroundColor="#F3F4F6"
                  borderRadius={10}
                  alignItems="center"
                >
                  <Text style={{ fontSize: 18, fontWeight: "700", color: "#111827" }}>
                    {quantity}
                  </Text>
                </YStack>

                <TouchableOpacity
                  onPress={() => onIncrement(id, quantity)}
                  activeOpacity={0.7}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    backgroundColor: "#DCFCE7",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons name="add" size={22} color="#22C55E" />
                </TouchableOpacity>
              </XStack>
              <XStack
                borderRadius={8}
                overflow="hidden"
                borderWidth={1}
                borderColor="#E5E7EB"
                opacity={isUpdatingServiceType ? 0.6 : 1}
              >
                <TouchableOpacity
                  onPress={() => handleServiceTypePress("dine_in")}
                  disabled={isUpdatingServiceType}
                  activeOpacity={0.7}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 52,
                    minHeight: 24,
                    backgroundColor: currentServiceType === "dine_in" ? "#DBEAFE" : "white",
                  }}
                >
                  {isUpdatingServiceType && currentServiceType !== "dine_in" ? (
                    <ActivityIndicator size="small" color="#0D87E1" />
                  ) : (
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: "600",
                        color: currentServiceType === "dine_in" ? "#0D87E1" : "#9CA3AF",
                      }}
                    >
                      DINE IN
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleServiceTypePress("takeout")}
                  disabled={isUpdatingServiceType}
                  activeOpacity={0.7}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 62,
                    minHeight: 24,
                    borderLeftWidth: 1,
                    borderLeftColor: "#E5E7EB",
                    backgroundColor: currentServiceType === "takeout" ? "#DBEAFE" : "white",
                  }}
                >
                  {isUpdatingServiceType && currentServiceType !== "takeout" ? (
                    <ActivityIndicator size="small" color="#0D87E1" />
                  ) : (
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: "600",
                        color: currentServiceType === "takeout" ? "#0D87E1" : "#9CA3AF",
                      }}
                    >
                      TAKEOUT
                    </Text>
                  )}
                </TouchableOpacity>
              </XStack>
            </>
          )}
        </XStack>
      </YStack>
    );
  },
);
