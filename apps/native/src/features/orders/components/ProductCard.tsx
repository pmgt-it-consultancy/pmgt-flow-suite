import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity, View } from "uniwind/components";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

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
      className="flex-1 bg-white rounded-xl p-4 m-1.5 max-w-[31.5%] min-h-[100px] border border-gray-200 shadow-sm justify-between"
      onPress={() => onPress({ id, name, price })}
      activeOpacity={0.7}
    >
      <Text className="text-gray-900 font-semibold text-base mb-3" numberOfLines={2}>
        {name}
      </Text>
      <View className="bg-blue-50 self-start px-3 py-1.5 rounded-lg">
        <Text className="text-blue-600 font-bold text-sm">{formatCurrency(price)}</Text>
      </View>
    </TouchableOpacity>
  );
};
