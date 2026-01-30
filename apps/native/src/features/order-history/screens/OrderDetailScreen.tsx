import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { ActivityIndicator, ScrollView, TextInput, View } from "uniwind/components";
import { useAuth } from "../../auth/context";
import { ManagerPinModal } from "../../checkout/components";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import type { ReceiptData } from "../../shared";
import { Badge, Button, IconButton, Modal, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface OrderDetailScreenProps {
  navigation: any;
  route: {
    params: {
      orderId: Id<"orders">;
    };
  };
}

export const OrderDetailScreen = ({ navigation, route }: OrderDetailScreenProps) => {
  const { orderId } = route.params;
  const { user } = useAuth();
  const formatCurrency = useFormatCurrency();

  const [isReprinting, setIsReprinting] = useState(false);
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [showVoidReasonModal, setShowVoidReasonModal] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  // Queries
  const order = useQuery(api.orders.get, { orderId });
  const receipt = useQuery(api.checkout.getReceipt, { orderId });
  const discounts = useQuery(api.discounts.getOrderDiscounts, { orderId });

  // Mutations & Actions
  const logReprint = useMutation(api.checkout.logReceiptReprint);
  const voidOrderAction = useAction(api.voids.voidOrder);
  const { printReceipt: printToThermal } = usePrinterStore();

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleReprint = useCallback(async () => {
    if (!receipt || !order) return;

    setIsReprinting(true);
    try {
      await logReprint({ orderId });

      const storeAddress = [receipt.storeAddress1, receipt.storeAddress2]
        .filter(Boolean)
        .join(", ");

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

      const receiptData: ReceiptData = {
        storeName: receipt.storeName,
        storeAddress,
        storeTin: receipt.tin,
        orderNumber: receipt.orderNumber,
        tableName: receipt.tableName,
        orderType: receipt.orderType as "dine_in" | "take_out" | "delivery",
        cashierName: receipt.cashierName,
        items: receipt.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          price: i.unitPrice,
          total: i.lineTotal,
        })),
        subtotal: receipt.grossSales,
        discounts: discountsList,
        vatableSales: receipt.vatableSales,
        vatAmount: receipt.vatAmount,
        vatExemptSales: receipt.vatExemptSales,
        total: receipt.netSales,
        paymentMethod: receipt.paymentMethod === "cash" ? "cash" : "card_ewallet",
        amountTendered: receipt.cashReceived,
        change: receipt.changeGiven ?? 0,
        cardPaymentType: receipt.cardPaymentType,
        cardReferenceNumber: receipt.cardReferenceNumber,
        transactionDate: new Date(receipt.paidAt ?? receipt.createdAt),
        receiptNumber: receipt.orderNumber,
      };

      await printToThermal(receiptData);
      Alert.alert("Success", "Receipt reprinted successfully");
    } catch (error) {
      console.error("Reprint error:", error);
      Alert.alert("Error", "Failed to reprint receipt");
    } finally {
      setIsReprinting(false);
    }
  }, [receipt, order, discounts, logReprint, orderId, printToThermal]);

  const handleVoidPress = useCallback(() => {
    setVoidReason("");
    setShowVoidReasonModal(true);
  }, []);

  const handleVoidReasonSubmit = useCallback(() => {
    if (!voidReason.trim()) {
      Alert.alert("Required", "Please enter a reason for voiding this order");
      return;
    }
    setShowVoidReasonModal(false);
    setShowManagerPinModal(true);
  }, [voidReason]);

  const handleManagerPinSuccess = useCallback(
    async (managerId: Id<"users">, pin: string) => {
      setShowManagerPinModal(false);
      try {
        const result = await voidOrderAction({
          orderId,
          reason: voidReason.trim(),
          managerId,
          managerPin: pin,
        });

        if (result.success) {
          Alert.alert("Success", "Order has been voided", [
            { text: "OK", onPress: () => navigation.goBack() },
          ]);
        } else {
          const errorResult = result as { success: false; error: string };
          Alert.alert("Error", errorResult.error);
        }
      } catch (error: any) {
        Alert.alert("Error", error.message || "Failed to void order");
      }
    },
    [voidOrderAction, orderId, voidReason, navigation],
  );

  const formatDate = useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }, []);

  if (!order) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-100">
        <ActivityIndicator size="large" color="#0D87E1" />
      </View>
    );
  }

  const orderTypeLabel = order.orderType === "dine_in" ? "Dine-In" : "Take-out";
  const statusVariant =
    order.status === "paid" ? "success" : order.status === "voided" ? "error" : "default";
  const activeItems = order.items.filter((i) => !i.isVoided);
  const isPaid = order.status === "paid";

  return (
    <View className="flex-1 bg-gray-100">
      {/* Header */}
      <View className="bg-white flex-row items-center px-4 py-3 border-b border-gray-200">
        <IconButton icon="arrow-back" variant="ghost" onPress={handleBack} className="mr-2" />
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text variant="heading" size="lg">
              Order #{order.orderNumber}
            </Text>
            <Badge variant={statusVariant}>
              {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
            </Badge>
          </View>
          <Text variant="muted" size="sm">
            {orderTypeLabel}
          </Text>
        </View>
      </View>

      <ScrollView className="flex-1">
        {/* Order Info */}
        <View className="bg-white mx-3 mt-3 p-4 rounded-xl border border-gray-100">
          <Text className="text-gray-500 font-semibold text-xs mb-3 uppercase tracking-wider">
            Order Info
          </Text>
          <InfoRow label="Date" value={formatDate(order.createdAt)} />
          {order.tableName ? <InfoRow label="Table" value={order.tableName} /> : null}
          {order.customerName ? <InfoRow label="Customer" value={order.customerName} /> : null}
          <InfoRow label="Cashier" value={order.createdByName} />
          {order.paymentMethod ? (
            <InfoRow
              label="Payment"
              value={order.paymentMethod === "cash" ? "Cash" : "Card / E-Wallet"}
            />
          ) : null}
          {order.cashReceived ? (
            <InfoRow label="Amount Tendered" value={formatCurrency(order.cashReceived)} />
          ) : null}
          {order.changeGiven ? (
            <InfoRow label="Change" value={formatCurrency(order.changeGiven)} />
          ) : null}
          {order.paidAt ? <InfoRow label="Paid At" value={formatDate(order.paidAt)} /> : null}
        </View>

        {/* Items */}
        <View className="bg-white mx-3 mt-3 p-4 rounded-xl border border-gray-100">
          <Text className="text-gray-500 font-semibold text-xs mb-3 uppercase tracking-wider">
            Items
          </Text>
          {activeItems.map((item) => (
            <View
              key={item._id}
              className="flex-row justify-between items-center py-2 border-b border-gray-50"
            >
              <View className="flex-1">
                <Text className="text-gray-900 text-sm">
                  {item.quantity}x {item.productName}
                </Text>
                {item.notes ? (
                  <Text variant="muted" size="xs">
                    {item.notes}
                  </Text>
                ) : null}
              </View>
              <Text className="text-gray-900 font-medium text-sm">
                {formatCurrency(item.lineTotal)}
              </Text>
            </View>
          ))}
        </View>

        {/* Discounts */}
        {discounts && discounts.length > 0 ? (
          <View className="bg-white mx-3 mt-3 p-4 rounded-xl border border-gray-100">
            <Text className="text-gray-500 font-semibold text-xs mb-3 uppercase tracking-wider">
              Discounts
            </Text>
            {discounts.map((d) => (
              <View key={d._id} className="flex-row justify-between items-center py-2">
                <Text className="text-gray-900 text-sm">
                  {d.discountType === "senior_citizen" ? "SC" : "PWD"}: {d.customerName}
                </Text>
                <Text className="text-red-500 font-medium text-sm">
                  -{formatCurrency(d.discountAmount)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Summary */}
        <View className="bg-white mx-3 mt-3 mb-3 p-4 rounded-xl border border-gray-100">
          <Text className="text-gray-500 font-semibold text-xs mb-3 uppercase tracking-wider">
            Summary
          </Text>
          <SummaryRow label="Gross Sales" value={formatCurrency(order.grossSales)} />
          <SummaryRow label="VATable Sales" value={formatCurrency(order.vatableSales)} />
          <SummaryRow label="VAT (12%)" value={formatCurrency(order.vatAmount)} />
          <SummaryRow label="VAT-Exempt Sales" value={formatCurrency(order.vatExemptSales)} />
          {order.discountAmount > 0 ? (
            <SummaryRow
              label="Discount"
              value={`-${formatCurrency(order.discountAmount)}`}
              valueClassName="text-red-500"
            />
          ) : null}
          <View className="flex-row justify-between items-center pt-2 mt-2 border-t border-gray-200">
            <Text className="text-gray-900 font-bold text-base">Net Sales</Text>
            <Text className="text-gray-900 font-bold text-base">
              {formatCurrency(order.netSales)}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Actions */}
      {isPaid ? (
        <View className="p-4 bg-white border-t border-gray-200 flex-row gap-3">
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            loading={isReprinting}
            disabled={isReprinting}
            onPress={handleReprint}
          >
            <View className="flex-row items-center">
              <Ionicons name="print-outline" size={20} color="#FFF" />
              <Text className="text-white font-semibold ml-2">Reprint Receipt</Text>
            </View>
          </Button>

          <Button variant="destructive" size="lg" className="flex-1" onPress={handleVoidPress}>
            <View className="flex-row items-center">
              <Ionicons name="close-circle-outline" size={20} color="#FFF" />
              <Text className="text-white font-semibold ml-2">Void Order</Text>
            </View>
          </Button>
        </View>
      ) : null}

      {/* Void Reason Modal */}
      <Modal
        visible={showVoidReasonModal}
        title="Void Order"
        onClose={() => setShowVoidReasonModal(false)}
        onRequestClose={() => setShowVoidReasonModal(false)}
        position="center"
      >
        <Text variant="muted" className="mb-3">
          Please provide a reason for voiding this order.
        </Text>
        <TextInput
          className="border border-gray-200 rounded-lg p-3 text-base text-gray-900 min-h-[80px]"
          placeholder="Enter reason..."
          placeholderTextColor="#9CA3AF"
          value={voidReason}
          onChangeText={setVoidReason}
          multiline
          textAlignVertical="top"
        />
        <Button
          variant="destructive"
          size="lg"
          className="mt-4"
          disabled={!voidReason.trim()}
          onPress={handleVoidReasonSubmit}
        >
          Continue
        </Button>
      </Modal>

      {/* Manager PIN Modal */}
      <ManagerPinModal
        visible={showManagerPinModal}
        title="Approve Void"
        description="Manager PIN required to void this order"
        onClose={() => {
          setShowManagerPinModal(false);
        }}
        onSuccess={handleManagerPinSuccess}
      />
    </View>
  );
};

// Helper components
const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <View className="flex-row justify-between items-center py-1.5">
    <Text variant="muted" size="sm">
      {label}
    </Text>
    <Text className="text-gray-900 text-sm font-medium">{value}</Text>
  </View>
);

const SummaryRow = ({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) => (
  <View className="flex-row justify-between items-center py-1">
    <Text variant="muted" size="sm">
      {label}
    </Text>
    <Text className={`text-gray-900 text-sm ${valueClassName ?? ""}`}>{value}</Text>
  </View>
);

export default OrderDetailScreen;
