import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Card, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface Discount {
  _id: Id<"orderDiscounts">;
  discountType: string;
  customerName: string;
  discountAmount: number;
  itemName?: string;
}

interface DiscountSectionProps {
  discounts: Discount[];
  onAddDiscount: () => void;
  onRemoveDiscount: (discountId: Id<"orderDiscounts">) => void;
}

export const DiscountSection = ({
  discounts,
  onAddDiscount,
  onRemoveDiscount,
}: DiscountSectionProps) => {
  const formatCurrency = useFormatCurrency();

  return (
    <YStack paddingHorizontal={16} paddingVertical={12}>
      <Text variant="heading" style={{ marginBottom: 12 }}>
        Discounts
      </Text>
      <Card variant="elevated">
        {discounts.length > 0 ? (
          <>
            {discounts.map((discount) => (
              <XStack
                key={discount._id}
                justifyContent="space-between"
                alignItems="center"
                paddingVertical={8}
                borderBottomWidth={1}
                borderColor="#F3F4F6"
              >
                <YStack flex={1}>
                  <XStack alignItems="center">
                    <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                    <Text style={{ color: "#22C55E", fontWeight: "500", marginLeft: 8 }}>
                      {discount.discountType === "senior_citizen" ? "SC" : "PWD"}:{" "}
                      {discount.customerName}
                    </Text>
                  </XStack>
                  {discount.itemName && (
                    <Text variant="muted" size="xs" style={{ marginLeft: 28 }}>
                      Applied to: {discount.itemName}
                    </Text>
                  )}
                </YStack>
                <XStack alignItems="center">
                  <Text style={{ color: "#22C55E", fontWeight: "600", marginRight: 8 }}>
                    -{formatCurrency(discount.discountAmount)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => onRemoveDiscount(discount._id)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close-circle" size={20} color="#EF4444" />
                  </TouchableOpacity>
                </XStack>
              </XStack>
            ))}
            <TouchableOpacity
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 12,
                marginTop: 8,
                borderTopWidth: 1,
                borderColor: "#F3F4F6",
              }}
              onPress={onAddDiscount}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={20} color="#0D87E1" />
              <Text style={{ color: "#0D87E1", fontWeight: "500", marginLeft: 8 }}>
                Add Another Discount
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 12,
            }}
            onPress={onAddDiscount}
            activeOpacity={0.7}
          >
            <Ionicons name="pricetag-outline" size={20} color="#0D87E1" />
            <Text style={{ color: "#0D87E1", fontWeight: "500", marginLeft: 8 }}>
              Add SC/PWD Discount
            </Text>
          </TouchableOpacity>
        )}
      </Card>
    </YStack>
  );
};
