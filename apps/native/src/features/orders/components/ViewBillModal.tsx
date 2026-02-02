import { FlatList } from "react-native";
import { XStack, YStack } from "tamagui";
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
      <YStack marginBottom={12}>
        <Text variant="muted" size="sm">
          {tableName ? `${tableName} - ` : ""}Order #{orderNumber}
        </Text>
      </YStack>

      <Separator style={{ marginBottom: 12 }} />

      <FlatList
        data={activeItems}
        keyExtractor={(_, index) => index.toString()}
        renderItem={({ item }) => (
          <XStack justifyContent="space-between" alignItems="center" paddingVertical={8}>
            <YStack flex={1} marginRight={12}>
              <Text style={{ color: "#111827", fontSize: 14 }}>{item.productName}</Text>
              <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                {item.quantity}x {formatCurrency(item.productPrice)}
              </Text>
            </YStack>
            <Text style={{ color: "#111827", fontWeight: "500", fontSize: 14 }}>
              {formatCurrency(item.lineTotal)}
            </Text>
          </XStack>
        )}
        style={{ maxHeight: 300 }}
      />

      <Separator style={{ marginVertical: 12 }} />

      <YStack gap={4}>
        <XStack justifyContent="space-between">
          <Text style={{ color: "#6B7280", fontSize: 14 }}>Subtotal</Text>
          <Text style={{ color: "#374151", fontSize: 14 }}>{formatCurrency(grossSales)}</Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text style={{ color: "#6B7280", fontSize: 14 }}>VAT (12%)</Text>
          <Text style={{ color: "#374151", fontSize: 14 }}>{formatCurrency(vatAmount)}</Text>
        </XStack>
        <XStack justifyContent="space-between" marginTop={4}>
          <Text style={{ color: "#111827", fontWeight: "700", fontSize: 16 }}>Total</Text>
          <Text style={{ color: "#111827", fontWeight: "700", fontSize: 16 }}>
            {formatCurrency(netSales)}
          </Text>
        </XStack>
      </YStack>
    </Modal>
  );
};
