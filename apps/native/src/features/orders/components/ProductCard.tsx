import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface ProductCardProps {
  id: Id<"products">;
  name: string;
  price: number;
  hasModifiers?: boolean;
  isOpenPrice?: boolean;
  minPrice?: number;
  maxPrice?: number;
  onPress: (product: {
    id: Id<"products">;
    name: string;
    price: number;
    hasModifiers: boolean;
    isOpenPrice: boolean;
    minPrice?: number;
    maxPrice?: number;
  }) => void;
}

export const ProductCard = ({
  id,
  name,
  price,
  hasModifiers,
  isOpenPrice,
  minPrice,
  maxPrice,
  onPress,
}: ProductCardProps) => {
  const formatCurrency = useFormatCurrency();

  return (
    <TouchableOpacity
      style={{
        flex: 1,
        backgroundColor: "#FFFFFF",
        borderRadius: 12,
        padding: 16,
        margin: 6,
        maxWidth: "31.5%",
        minHeight: 100,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        justifyContent: "space-between",
      }}
      onPress={() =>
        onPress({
          id,
          name,
          price,
          hasModifiers: !!hasModifiers,
          isOpenPrice: isOpenPrice ?? false,
          minPrice,
          maxPrice,
        })
      }
      activeOpacity={0.7}
    >
      <Text
        style={{ color: "#111827", fontWeight: "600", fontSize: 16, marginBottom: 12 }}
        numberOfLines={2}
      >
        {name}
      </Text>
      <XStack alignItems="center">
        <YStack
          alignSelf="flex-start"
          paddingHorizontal={12}
          paddingVertical={6}
          borderRadius={8}
          backgroundColor={isOpenPrice ? "#ECFDF5" : "#EFF6FF"}
        >
          <Text
            style={{ color: isOpenPrice ? "#059669" : "#2563EB", fontWeight: "700", fontSize: 14 }}
          >
            {isOpenPrice ? "Enter Price" : formatCurrency(price)}
          </Text>
        </YStack>
        {hasModifiers && (
          <YStack
            backgroundColor="#FFFBEB"
            paddingHorizontal={8}
            paddingVertical={4}
            borderRadius={4}
            marginLeft={6}
          >
            <Text style={{ color: "#D97706", fontWeight: "500", fontSize: 10 }}>Custom</Text>
          </YStack>
        )}
      </XStack>
    </TouchableOpacity>
  );
};
