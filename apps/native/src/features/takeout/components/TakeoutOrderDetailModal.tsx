import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { FlatList } from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { ReceiptPreviewModal } from "../../checkout/components";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { Badge, Button, Modal, Separator, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import type { ReceiptData } from "../../shared/utils/receipt";

type TakeoutStatus = "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";

const statusConfig: Record<
  TakeoutStatus,
  { label: string; variant: "warning" | "primary" | "success" | "default" | "error" }
> = {
  pending: { label: "Pending", variant: "warning" },
  preparing: { label: "Preparing", variant: "primary" },
  ready_for_pickup: { label: "Ready for Pickup", variant: "success" },
  completed: { label: "Completed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "error" },
};

interface TakeoutOrderDetailModalProps {
  visible: boolean;
  orderId: Id<"orders"> | null;
  onClose: () => void;
}

export const TakeoutOrderDetailModal = ({
  visible,
  orderId,
  onClose,
}: TakeoutOrderDetailModalProps) => {
  const { user } = useAuth();
  const formatCurrency = useFormatCurrency();
  const { printReceipt: printToThermal } = usePrinterStore();

  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  const order = useQuery(api.orders.get, orderId ? { orderId } : "skip");
  const store = useQuery(api.stores.get, order?.storeId ? { storeId: order.storeId } : "skip");
  const discounts = useQuery(api.discounts.getOrderDiscounts, orderId ? { orderId } : "skip");

  const activeItems = useMemo(() => order?.items.filter((i) => !i.isVoided) ?? [], [order]);
  const takeoutStatus = (order?.takeoutStatus as TakeoutStatus | undefined) ?? "pending";
  const isPaid = order?.status === "paid";

  const buildReceiptData = useCallback((): ReceiptData => {
    const discountsList = (discounts ?? []).map((d) => ({
      type:
        d.discountType === "senior_citizen"
          ? ("sc" as const)
          : d.discountType === "pwd"
            ? ("pwd" as const)
            : ("custom" as const),
      customerName: d.customerName,
      customerId: d.customerId,
      itemName: d.itemName ?? "Order",
      amount: d.discountAmount,
    }));

    const storeAddress = store
      ? [store.address1, store.address2].filter(Boolean).join(", ")
      : undefined;

    return {
      storeName: store?.name ?? "Store",
      storeAddress,
      storeTin: store?.tin,
      orderNumber: order?.orderNumber ?? "",
      orderType: "take_out",
      cashierName: order?.createdByName ?? user?.name ?? "Cashier",
      items: activeItems.map((item) => ({
        name: item.productName,
        quantity: item.quantity,
        price: item.productPrice,
        total: item.lineTotal,
        modifiers: item.modifiers?.map((m) => ({
          optionName: m.optionName,
          priceAdjustment: m.priceAdjustment,
        })),
      })),
      subtotal: order?.grossSales ?? 0,
      discounts: discountsList,
      vatableSales: order?.vatableSales ?? 0,
      vatAmount: order?.vatAmount ?? 0,
      vatExemptSales: order?.vatExemptSales ?? 0,
      total: order?.netSales ?? 0,
      paymentMethod: order?.paymentMethod === "cash" ? "cash" : "card_ewallet",
      amountTendered: order?.cashReceived,
      change: order?.changeGiven,
      transactionDate: new Date(order?.paidAt ?? order?.createdAt ?? Date.now()),
      receiptNumber: order?.orderNumber,
      cardPaymentType: order?.cardPaymentType,
      cardReferenceNumber: order?.cardReferenceNumber,
      customerName: order?.customerName,
    };
  }, [order, store, discounts, activeItems, user?.name]);

  const handleReceiptPreview = useCallback(() => {
    setReceiptData(buildReceiptData());
    setShowReceiptPreview(true);
  }, [buildReceiptData]);

  const handleCloseReceiptPreview = useCallback(() => {
    setShowReceiptPreview(false);
    setReceiptData(null);
  }, []);

  if (!order) return null;

  const config = statusConfig[takeoutStatus];
  const orderTime = new Date(order.createdAt).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <>
      <Modal
        visible={visible && !showReceiptPreview}
        onClose={onClose}
        title="Order Details"
        position="center"
        wide
        scrollable={false}
      >
        {/* Header */}
        <XStack justifyContent="space-between" alignItems="flex-start" marginBottom={12}>
          <YStack>
            <Text variant="heading" size="lg">
              {order.orderNumber}
            </Text>
            {order.customerName ? (
              <Text variant="muted" size="sm">
                {order.customerName}
              </Text>
            ) : null}
            <Text variant="muted" size="xs" style={{ marginTop: 2 }}>
              {orderTime} · {order.createdByName}
            </Text>
          </YStack>
          <Badge variant={config.variant} size="md">
            {config.label}
          </Badge>
        </XStack>

        <Separator style={{ marginBottom: 12 }} />

        {/* Items */}
        <FlatList
          data={activeItems}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <YStack paddingVertical={8}>
              <XStack justifyContent="space-between" alignItems="center">
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
              {item.modifiers?.length > 0 && (
                <YStack marginLeft={12} marginTop={4}>
                  {item.modifiers.map((mod, idx) => (
                    <Text key={idx} style={{ color: "#9CA3AF", fontSize: 12 }}>
                      + {mod.optionName}
                      {mod.priceAdjustment > 0 ? ` (${formatCurrency(mod.priceAdjustment)})` : ""}
                    </Text>
                  ))}
                </YStack>
              )}
            </YStack>
          )}
          style={{ maxHeight: 250 }}
        />

        <Separator style={{ marginVertical: 12 }} />

        {/* Totals */}
        <YStack gap={4}>
          <XStack justifyContent="space-between">
            <Text style={{ color: "#6B7280", fontSize: 14 }}>Subtotal</Text>
            <Text style={{ color: "#374151", fontSize: 14 }}>
              {formatCurrency(order.grossSales)}
            </Text>
          </XStack>
          {order.discountAmount > 0 && (
            <XStack justifyContent="space-between">
              <Text style={{ color: "#EF4444", fontSize: 14 }}>Discount</Text>
              <Text style={{ color: "#EF4444", fontSize: 14 }}>
                -{formatCurrency(order.discountAmount)}
              </Text>
            </XStack>
          )}
          <XStack justifyContent="space-between">
            <Text style={{ color: "#6B7280", fontSize: 14 }}>VAT (12%)</Text>
            <Text style={{ color: "#374151", fontSize: 14 }}>
              {formatCurrency(order.vatAmount)}
            </Text>
          </XStack>
          <XStack justifyContent="space-between" marginTop={4}>
            <Text style={{ color: "#111827", fontWeight: "700", fontSize: 16 }}>Total</Text>
            <Text style={{ color: "#111827", fontWeight: "700", fontSize: 16 }}>
              {formatCurrency(order.netSales)}
            </Text>
          </XStack>
        </YStack>

        {/* Payment info for paid orders */}
        {isPaid && order.paymentMethod && (
          <>
            <Separator style={{ marginVertical: 12 }} />
            <YStack gap={4}>
              <XStack justifyContent="space-between">
                <Text style={{ color: "#6B7280", fontSize: 14 }}>Payment</Text>
                <Text style={{ color: "#374151", fontSize: 14 }}>
                  {order.paymentMethod === "cash" ? "Cash" : "Card/E-Wallet"}
                </Text>
              </XStack>
              {order.paymentMethod === "cash" && order.cashReceived != null && (
                <>
                  <XStack justifyContent="space-between">
                    <Text style={{ color: "#6B7280", fontSize: 14 }}>Tendered</Text>
                    <Text style={{ color: "#374151", fontSize: 14 }}>
                      {formatCurrency(order.cashReceived)}
                    </Text>
                  </XStack>
                  <XStack justifyContent="space-between">
                    <Text style={{ color: "#6B7280", fontSize: 14 }}>Change</Text>
                    <Text style={{ color: "#16A34A", fontSize: 14 }}>
                      {formatCurrency(order.changeGiven ?? 0)}
                    </Text>
                  </XStack>
                </>
              )}
            </YStack>
          </>
        )}

        {/* Actions */}
        <YStack marginTop={16} gap={8}>
          {isPaid && (
            <Button variant="primary" onPress={handleReceiptPreview}>
              <XStack alignItems="center" justifyContent="center">
                <Ionicons name="receipt-outline" size={18} color="#fff" />
                <Text style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>
                  Receipt Preview / Print
                </Text>
              </XStack>
            </Button>
          )}
          <Button variant="outline" onPress={onClose}>
            Close
          </Button>
        </YStack>
      </Modal>

      <ReceiptPreviewModal
        visible={showReceiptPreview}
        receiptData={receiptData}
        onPrint={async () => {
          if (!receiptData) return;
          await printToThermal(receiptData);
        }}
        onSkip={handleCloseReceiptPreview}
      />
    </>
  );
};
