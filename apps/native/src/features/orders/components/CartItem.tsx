import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { IconButton, Text } from "../../shared/components/ui";
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
            <Text style={{ color: "#6B7280", fontSize: 14 }}>Qty: {quantity}</Text>
            {onVoidItem && (
              <TouchableOpacity
                onPress={() => onVoidItem(id)}
                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              >
                <Text style={{ color: "#EF4444", fontWeight: "500", fontSize: 12 }}>Void</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <XStack
            alignItems="center"
            backgroundColor="#F9FAFB"
            borderRadius={12}
            borderWidth={1}
            borderColor="#E5E7EB"
          >
            <IconButton
              icon="remove"
              size="md"
              variant="ghost"
              iconColor="#EF4444"
              onPress={() => onDecrement(id, quantity)}
            />
            <Text
              style={{
                color: "#111827",
                fontWeight: "700",
                fontSize: 16,
                paddingHorizontal: 16,
                minWidth: 40,
                textAlign: "center",
              }}
            >
              {quantity}
            </Text>
            <IconButton
              icon="add"
              size="md"
              variant="ghost"
              iconColor="#22C55E"
              onPress={() => onIncrement(id, quantity)}
            />
          </XStack>
        )}
      </XStack>
    </YStack>
  );
};
