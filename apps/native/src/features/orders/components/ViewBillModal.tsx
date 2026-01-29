import { FlatList, View } from "uniwind/components";
import { Modal, Separator, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface BillItem {
  productName: string;
  quantity: number;
  productPrice: number;
  lineTotal: number;
  isVoided: boolean;
}

interface ViewBillModalProps {
  visible: boolean;
  orderNumber: string;
  tableName?: string;
  items: BillItem[];
  grossSales: number;
  vatAmount: number;
  netSales: number;
  onClose: () => void;
}

export const ViewBillModal = ({
  visible,
  orderNumber,
  tableName,
  items,
  grossSales,
  vatAmount,
  netSales,
  onClose,
}: ViewBillModalProps) => {
  const formatCurrency = useFormatCurrency();
  const activeItems = items.filter((i) => !i.isVoided);

  return (
    <Modal visible={visible} onClose={onClose} title="Current Bill" position="center" wide>
      <View className="mb-3">
        <Text variant="muted" size="sm">
          {tableName ? `${tableName} - ` : ""}Order #{orderNumber}
        </Text>
      </View>

      <Separator className="mb-3" />

      <FlatList
        data={activeItems}
        keyExtractor={(_, index) => index.toString()}
        renderItem={({ item }) => (
          <View className="flex-row justify-between items-center py-2">
            <View className="flex-1 mr-3">
              <Text className="text-gray-900 text-sm">{item.productName}</Text>
              <Text className="text-gray-400 text-xs">
                {item.quantity}x {formatCurrency(item.productPrice)}
              </Text>
            </View>
            <Text className="text-gray-900 font-medium text-sm">
              {formatCurrency(item.lineTotal)}
            </Text>
          </View>
        )}
        style={{ maxHeight: 300 }}
      />

      <Separator className="my-3" />

      <View className="gap-1">
        <View className="flex-row justify-between">
          <Text className="text-gray-500 text-sm">Subtotal</Text>
          <Text className="text-gray-700 text-sm">{formatCurrency(grossSales)}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-gray-500 text-sm">VAT (12%)</Text>
          <Text className="text-gray-700 text-sm">{formatCurrency(vatAmount)}</Text>
        </View>
        <View className="flex-row justify-between mt-1">
          <Text className="text-gray-900 font-bold text-base">Total</Text>
          <Text className="text-gray-900 font-bold text-base">{formatCurrency(netSales)}</Text>
        </View>
      </View>
    </Modal>
  );
};
