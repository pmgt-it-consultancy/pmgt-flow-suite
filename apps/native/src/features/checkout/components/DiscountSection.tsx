import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity, View } from "uniwind/components";
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
    <View className="px-4 py-3">
      <Text variant="heading" className="mb-3">
        Discounts
      </Text>
      <Card variant="elevated">
        {discounts.length > 0 ? (
          <>
            {discounts.map((discount) => (
              <View
                key={discount._id}
                className="flex-row justify-between items-center py-2 border-b border-gray-100"
              >
                <View className="flex-1">
                  <View className="flex-row items-center">
                    <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                    <Text className="text-green-500 font-medium ml-2">
                      {discount.discountType === "senior_citizen" ? "SC" : "PWD"}:{" "}
                      {discount.customerName}
                    </Text>
                  </View>
                  {discount.itemName && (
                    <Text variant="muted" size="xs" className="ml-7">
                      Applied to: {discount.itemName}
                    </Text>
                  )}
                </View>
                <View className="flex-row items-center">
                  <Text className="text-green-500 font-semibold mr-2">
                    -{formatCurrency(discount.discountAmount)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => onRemoveDiscount(discount._id)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close-circle" size={20} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <TouchableOpacity
              className="flex-row items-center justify-center py-3 mt-2 border-t border-gray-100"
              onPress={onAddDiscount}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={20} color="#0D87E1" />
              <Text className="text-blue-500 font-medium ml-2">Add Another Discount</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            className="flex-row items-center justify-center py-3"
            onPress={onAddDiscount}
            activeOpacity={0.7}
          >
            <Ionicons name="pricetag-outline" size={20} color="#0D87E1" />
            <Text className="text-blue-500 font-medium ml-2">Add SC/PWD Discount</Text>
          </TouchableOpacity>
        )}
      </Card>
    </View>
  );
};
