import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity } from "react-native";
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
}

export const CartItem = ({
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
}: CartItemProps) => {
  const formatCurrency = useFormatCurrency();

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
          </>
        ) : (
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
              <Text style={{ fontSize: 18, fontWeight: "700", color: "#111827" }}>{quantity}</Text>
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
        )}
      </XStack>
    </YStack>
  );
};
