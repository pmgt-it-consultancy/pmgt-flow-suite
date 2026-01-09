import React from "react";
import { TouchableOpacity } from "uniwind/components";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import { Id } from "@packages/backend/convex/_generated/dataModel";

interface ProductCardProps {
  id: Id<"products">;
  name: string;
  price: number;
  onPress: (product: { id: Id<"products">; name: string; price: number }) => void;
}

export const ProductCard = ({ id, name, price, onPress }: ProductCardProps) => {
  const formatCurrency = useFormatCurrency();

  return (
    <TouchableOpacity
      className="flex-1 bg-white rounded-lg p-3 m-1 max-w-[48%] border border-gray-200"
      onPress={() => onPress({ id, name, price })}
      activeOpacity={0.7}
    >
      <Text className="text-gray-900 font-medium text-sm mb-1 min-h-[40px]" numberOfLines={2}>
        {name}
      </Text>
      <Text className="text-blue-500 font-semibold">
        {formatCurrency(price)}
      </Text>
    </TouchableOpacity>
  );
};
