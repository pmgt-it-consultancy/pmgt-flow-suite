import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { FlatList, View } from "uniwind/components";
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
      >
        {/* Header */}
        <View className="flex-row justify-between items-start mb-3">
          <View>
            <Text variant="heading" size="lg">
              {order.orderNumber}
            </Text>
            {order.customerName ? (
              <Text variant="muted" size="sm">
                {order.customerName}
              </Text>
            ) : null}
            <Text variant="muted" size="xs" className="mt-0.5">
              {orderTime} · {order.createdByName}
            </Text>
          </View>
          <Badge variant={config.variant} size="md">
            {config.label}
          </Badge>
        </View>

        <Separator className="mb-3" />

        {/* Items */}
        <FlatList
          data={activeItems}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <View className="py-2">
              <View className="flex-row justify-between items-center">
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
              {item.modifiers?.length > 0 && (
                <View className="ml-3 mt-1">
                  {item.modifiers.map((mod, idx) => (
                    <Text key={idx} className="text-gray-400 text-xs">
                      + {mod.optionName}
                      {mod.priceAdjustment > 0 ? ` (${formatCurrency(mod.priceAdjustment)})` : ""}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}
          style={{ maxHeight: 250 }}
        />

        <Separator className="my-3" />

        {/* Totals */}
        <View className="gap-1">
          <View className="flex-row justify-between">
            <Text className="text-gray-500 text-sm">Subtotal</Text>
            <Text className="text-gray-700 text-sm">{formatCurrency(order.grossSales)}</Text>
          </View>
          {order.discountAmount > 0 && (
            <View className="flex-row justify-between">
              <Text className="text-red-500 text-sm">Discount</Text>
              <Text className="text-red-500 text-sm">-{formatCurrency(order.discountAmount)}</Text>
            </View>
          )}
          <View className="flex-row justify-between">
            <Text className="text-gray-500 text-sm">VAT (12%)</Text>
            <Text className="text-gray-700 text-sm">{formatCurrency(order.vatAmount)}</Text>
          </View>
          <View className="flex-row justify-between mt-1">
            <Text className="text-gray-900 font-bold text-base">Total</Text>
            <Text className="text-gray-900 font-bold text-base">
              {formatCurrency(order.netSales)}
            </Text>
          </View>
        </View>

        {/* Payment info for paid orders */}
        {isPaid && order.paymentMethod && (
          <>
            <Separator className="my-3" />
            <View className="gap-1">
              <View className="flex-row justify-between">
                <Text className="text-gray-500 text-sm">Payment</Text>
                <Text className="text-gray-700 text-sm">
                  {order.paymentMethod === "cash" ? "Cash" : "Card/E-Wallet"}
                </Text>
              </View>
              {order.paymentMethod === "cash" && order.cashReceived != null && (
                <>
                  <View className="flex-row justify-between">
                    <Text className="text-gray-500 text-sm">Tendered</Text>
                    <Text className="text-gray-700 text-sm">
                      {formatCurrency(order.cashReceived)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-gray-500 text-sm">Change</Text>
                    <Text className="text-green-600 text-sm">
                      {formatCurrency(order.changeGiven ?? 0)}
                    </Text>
                  </View>
                </>
              )}
            </View>
          </>
        )}

        {/* Actions */}
        <View className="mt-4 gap-2">
          {isPaid && (
            <Button variant="primary" onPress={handleReceiptPreview}>
              <View className="flex-row items-center justify-center">
                <Ionicons name="receipt-outline" size={18} color="#fff" />
                <Text className="text-white font-semibold ml-2">Receipt Preview / Print</Text>
              </View>
            </Button>
          )}
          <Button variant="outline" onPress={onClose}>
            Close
          </Button>
        </View>
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
