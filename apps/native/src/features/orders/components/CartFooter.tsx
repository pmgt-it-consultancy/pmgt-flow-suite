import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Button, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface CartFooterProps {
  subtotal: number;
  itemCount: number;
  hasUnsentItems: boolean;
  hasSentItems: boolean;
  isDraftMode: boolean;
  orderType?: "dine_in" | "takeout";
  onSendToKitchen: () => void;
  onCloseTable?: () => void;
  onViewBill?: () => void;
  onCancelOrder: () => void;
}

export const CartFooter = ({
  subtotal,
  itemCount,
  hasUnsentItems,
  hasSentItems,
  isDraftMode,
  orderType,
  onSendToKitchen,
  onCloseTable,
  onViewBill,
  onCancelOrder,
}: CartFooterProps) => {
  const formatCurrency = useFormatCurrency();

  const isTakeout = orderType === "takeout";
  const canSendToKitchen = hasUnsentItems;
  const canCloseTable = !isDraftMode && itemCount > 0 && !!onCloseTable;
  const canViewBill = !isDraftMode && itemCount > 0 && !!onViewBill;
  const canCancel = !hasSentItems;

  return (
    <YStack
      paddingHorizontal={12}
      paddingVertical={12}
      borderTopWidth={1}
      borderTopColor="#E5E7EB"
      backgroundColor="#FFFFFF"
    >
      <XStack justifyContent="space-between" alignItems="center" marginBottom={12}>
        <Text style={{ color: "#6B7280", fontWeight: "500", fontSize: 14 }}>Subtotal</Text>
        <Text style={{ color: "#111827", fontWeight: "700", fontSize: 20 }}>
          {formatCurrency(subtotal)}
        </Text>
      </XStack>

      <Button
        variant="success"
        size="lg"
        disabled={!canSendToKitchen}
        onPress={onSendToKitchen}
        style={!canSendToKitchen ? { opacity: 0.4 } : undefined}
      >
        <XStack alignItems="center">
          <Ionicons
            name={isTakeout ? "card-outline" : "restaurant-outline"}
            size={20}
            color="#FFF"
          />
          <Text style={{ color: "#FFFFFF", fontWeight: "700", marginLeft: 8, fontSize: 16 }}>
            {isTakeout ? "Proceed to Payment" : "Send to Kitchen"}
          </Text>
        </XStack>
      </Button>

      {canCloseTable && (
        <Button variant="primary" size="lg" onPress={onCloseTable} style={{ marginTop: 8 }}>
          <XStack alignItems="center">
            <Ionicons name="card-outline" size={20} color="#FFF" />
            <Text style={{ color: "#FFFFFF", fontWeight: "700", marginLeft: 8, fontSize: 16 }}>
              Close Table
            </Text>
          </XStack>
        </Button>
      )}

      {canViewBill && (
        <Button variant="outline" size="lg" onPress={onViewBill} style={{ marginTop: 8 }}>
          <XStack alignItems="center">
            <Ionicons name="receipt-outline" size={20} color="#374151" />
            <Text style={{ color: "#374151", fontWeight: "700", marginLeft: 8, fontSize: 16 }}>
              View Bill
            </Text>
          </XStack>
        </Button>
      )}

      {canCancel && (
        <TouchableOpacity
          onPress={onCancelOrder}
          activeOpacity={0.7}
          style={{
            marginTop: 10,
            paddingVertical: 14,
            paddingHorizontal: 20,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            backgroundColor: "#FEF2F2",
            borderRadius: 10,
            borderWidth: 1,
            borderColor: "#FECACA",
          }}
        >
          <Ionicons
            name="close-circle-outline"
            size={20}
            color="#DC2626"
            style={{ marginRight: 8 }}
          />
          <Text style={{ color: "#DC2626", fontWeight: "600", fontSize: 15 }}>Cancel Order</Text>
        </TouchableOpacity>
      )}
    </YStack>
  );
};
