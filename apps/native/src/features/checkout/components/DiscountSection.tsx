import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Pressable } from "react-native-gesture-handler";
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

      <Card variant="outlined">
        {discounts.length > 0 ? (
          <>
            {discounts.map((discount, index) => (
              <XStack
                key={discount._id}
                justifyContent="space-between"
                alignItems="center"
                paddingVertical={10}
                borderBottomWidth={index === discounts.length - 1 ? 0 : 1}
                borderColor="#F3F4F6"
              >
                <YStack flex={1} marginRight={12}>
                  <Text style={{ color: "#111827", fontWeight: "600" }}>
                    {discount.discountType === "senior_citizen" ? "SC" : "PWD"}:{" "}
                    {discount.customerName}
                  </Text>
                  {discount.itemName && (
                    <Text variant="muted" size="xs" style={{ marginTop: 2 }}>
                      Applied to: {discount.itemName}
                    </Text>
                  )}
                </YStack>

                <XStack alignItems="center">
                  <Text style={{ color: "#22C55E", fontWeight: "600", marginRight: 10 }}>
                    -{formatCurrency(discount.discountAmount)}
                  </Text>
                  <Pressable
                    android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
                    onPress={() => onRemoveDiscount(discount._id)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={({ pressed }) => [
                      {
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#F9FAFB",
                      },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Ionicons name="close" size={18} color="#6B7280" />
                  </Pressable>
                </XStack>
              </XStack>
            ))}

            <Pressable
              android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingTop: 12,
                  marginTop: 4,
                  borderTopWidth: 1,
                  borderColor: "#F3F4F6",
                },
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={onAddDiscount}
            >
              <Ionicons name="add" size={18} color="#0D87E1" />
              <Text style={{ color: "#0D87E1", fontWeight: "500", marginLeft: 8 }}>
                Add Another Discount
              </Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 12,
              },
              { opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={onAddDiscount}
          >
            <Ionicons name="pricetag-outline" size={20} color="#0D87E1" />
            <Text style={{ color: "#0D87E1", fontWeight: "500", marginLeft: 8 }}>
              Add SC/PWD Discount
            </Text>
          </Pressable>
        )}
      </Card>
    </YStack>
  );
};
