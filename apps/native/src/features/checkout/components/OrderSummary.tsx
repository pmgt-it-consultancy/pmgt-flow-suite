import { View } from "uniwind/components";
import { Card, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface OrderItem {
  _id: string;
  productName: string;
  quantity: number;
  lineTotal: number;
}

interface OrderSummaryProps {
  items: OrderItem[];
}

export const OrderSummary = ({ items }: OrderSummaryProps) => {
  const formatCurrency = useFormatCurrency();

  return (
    <View className="px-4 py-3">
      <Text variant="heading" className="mb-3">
        Order Summary
      </Text>
      <Card variant="elevated">
        {items.map((item) => (
          <View key={item._id} className="flex-row justify-between py-2 border-b border-gray-100">
            <Text className="text-gray-700 flex-1">
              {item.quantity}x {item.productName}
            </Text>
            <Text className="text-gray-900 font-medium">{formatCurrency(item.lineTotal)}</Text>
          </View>
        ))}
      </Card>
    </View>
  );
};
