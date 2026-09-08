import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { memo, useEffect, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import { CartQuantityEdits } from "../hooks/useCartQuantityEdits";

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
  onSetQuantity?: (id: Id<"orderItems">, targetQty: number) => void | Promise<void>;
  quantityEdits?: CartQuantityEdits;
  disabled?: boolean;
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
    onSetQuantity,
    quantityEdits,
    disabled,
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

    const [localEdits] = useState(() => new CartQuantityEdits());
    const edits = quantityEdits ?? localEdits;
    const [displayQty, setDisplayQty] = useState(() => edits.pendingQuantity(id) ?? quantity);
    const displayQtyRef = useRef(displayQty);
    const callbacks = useRef({ onSetQuantity, onIncrement, onDecrement, quantity });
    callbacks.current = { onSetQuantity, onIncrement, onDecrement, quantity };

    // Keep displayQty synced with upstream quantity unless the user has a pending change.
    useEffect(() => {
      const next = edits.pendingQuantity(id) ?? quantity;
      displayQtyRef.current = next;
      setDisplayQty(next);
      edits.acknowledge(id);
    }, [quantity, id, edits]);

    const saveQuantity = async (target: number) => {
      const latest = callbacks.current;
      if (latest.onSetQuantity) await latest.onSetQuantity(id, target);
      else if (target > latest.quantity) await latest.onIncrement(id, latest.quantity);
      else if (target < latest.quantity) await latest.onDecrement(id, latest.quantity);
    };
    useEffect(() => {
      // Recycled rows may mount with a new callback while their edit still belongs to the screen.
      edits.updateSaver(id, saveQuantity);
    });

    const scheduleFlush = (nextQty: number) => {
      if (disabled) return;
      if (nextQty < 1) {
        // Keep one visible while the existing removal confirmation is open.
        onDecrement(id, 1);
        return;
      }
      displayQtyRef.current = nextQty;
      setDisplayQty(nextQty);
      edits.enqueue(id, nextQty, saveQuantity);
    };

    useEffect(() => {
      return () => {
        // Shared edits outlive virtualized rows; their owner flushes on screen exit.
        if (!quantityEdits) void localEdits.flush().catch(() => {});
      };
    }, [quantityEdits, localEdits]);

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
                  <Pressable
                    android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                    onPress={() => onVoidItem(id)}
                    style={({ pressed }) => [
                      {
                        backgroundColor: "#FEF2F2",
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: "#FECACA",
                      },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={{ color: "#DC2626", fontWeight: "600", fontSize: 13 }}>Void</Text>
                  </Pressable>
                )}
              </XStack>
              <XStack
                borderRadius={8}
                overflow="hidden"
                borderWidth={1}
                borderColor="#E5E7EB"
                opacity={0.5}
              >
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  disabled
                  style={({ pressed }) => [
                    {
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      backgroundColor: currentServiceType === "dine_in" ? "#DBEAFE" : "white",
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
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
                </Pressable>
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  disabled
                  style={({ pressed }) => [
                    {
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderLeftWidth: 1,
                      borderLeftColor: "#E5E7EB",
                      backgroundColor: currentServiceType === "takeout" ? "#DBEAFE" : "white",
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
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
                </Pressable>
              </XStack>
            </>
          ) : (
            <>
              <XStack alignItems="center" gap={8}>
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  disabled={disabled}
                  onPress={() => scheduleFlush(displayQtyRef.current - 1)}
                  style={({ pressed }) => [
                    {
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      backgroundColor: "#FEE2E2",
                      justifyContent: "center",
                      alignItems: "center",
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Ionicons name="remove" size={22} color="#EF4444" />
                </Pressable>

                <YStack
                  minWidth={48}
                  paddingVertical={10}
                  paddingHorizontal={14}
                  backgroundColor="#F3F4F6"
                  borderRadius={10}
                  alignItems="center"
                >
                  <Text style={{ fontSize: 18, fontWeight: "700", color: "#111827" }}>
                    {displayQty}
                  </Text>
                </YStack>

                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  disabled={disabled}
                  onPress={() => scheduleFlush(displayQtyRef.current + 1)}
                  style={({ pressed }) => [
                    {
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      backgroundColor: "#DCFCE7",
                      justifyContent: "center",
                      alignItems: "center",
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Ionicons name="add" size={22} color="#22C55E" />
                </Pressable>
              </XStack>
              <XStack
                borderRadius={8}
                overflow="hidden"
                borderWidth={1}
                borderColor="#E5E7EB"
                opacity={isUpdatingServiceType ? 0.6 : 1}
              >
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  onPress={() => handleServiceTypePress("dine_in")}
                  disabled={isUpdatingServiceType}
                  style={({ pressed }) => [
                    {
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 52,
                      minHeight: 24,
                      backgroundColor: currentServiceType === "dine_in" ? "#DBEAFE" : "white",
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
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
                </Pressable>
                <Pressable
                  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                  onPress={() => handleServiceTypePress("takeout")}
                  disabled={isUpdatingServiceType}
                  style={({ pressed }) => [
                    {
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 62,
                      minHeight: 24,
                      borderLeftWidth: 1,
                      borderLeftColor: "#E5E7EB",
                      backgroundColor: currentServiceType === "takeout" ? "#DBEAFE" : "white",
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
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
                </Pressable>
              </XStack>
            </>
          )}
        </XStack>
      </YStack>
    );
  },
  (previous, next) => {
    // Callback identity is significant: equal-looking rows must not retain stale handlers.
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      if (
        key !== "modifiers" &&
        previous[key as keyof CartItemProps] !== next[key as keyof CartItemProps]
      )
        return false;
    }
    const before = previous.modifiers ?? [];
    const after = next.modifiers ?? [];
    return (
      before.length === after.length &&
      before.every(
        (modifier, index) =>
          modifier.groupName === after[index].groupName &&
          modifier.optionName === after[index].optionName &&
          modifier.priceAdjustment === after[index].priceAdjustment,
      )
    );
  },
);
