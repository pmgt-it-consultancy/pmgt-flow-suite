import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, TextInput } from "react-native";
import { XStack, YStack } from "tamagui";
import { ManagerPinModal } from "../../checkout/components";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import type { ReceiptData } from "../../shared";
import { PageHeader } from "../../shared/components/PageHeader";
import { Badge, Button, Modal, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import { RefundItemModal } from "../components/RefundItemModal";

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
  const formatCurrency = useFormatCurrency();

  const [isReprinting, setIsReprinting] = useState(false);
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [showVoidReasonModal, setShowVoidReasonModal] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundData, setRefundData] = useState<{
    itemIds: Id<"orderItems">[];
    reason: string;
    refundMethod: "cash" | "card_ewallet";
  } | null>(null);
  const [showRefundPinModal, setShowRefundPinModal] = useState(false);

  // Queries
  const order = useQuery(api.orders.get, { orderId });
  const receipt = useQuery(api.checkout.getReceipt, { orderId });
  const discounts = useQuery(api.discounts.getOrderDiscounts, { orderId });

  // Mutations & Actions
  const logReprint = useMutation(api.checkout.logReceiptReprint);
  const voidOrderAction = useAction(api.voids.voidOrder);
  const voidPaidOrderAction = useAction(api.voids.voidPaidOrder);
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
        pax: receipt.pax,
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
        tableMarker: receipt.tableMarker,
        orderCategory: receipt.orderCategory,
        payments: receipt.payments,
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

  const handleRefundConfirm = useCallback(
    async (itemIds: Id<"orderItems">[], reason: string, refundMethod: "cash" | "card_ewallet") => {
      setRefundData({ itemIds, reason, refundMethod });
      setShowRefundModal(false);
      setShowRefundPinModal(true);
    },
    [],
  );

  const handleRefundPinSuccess = useCallback(
    async (managerId: Id<"users">, pin: string) => {
      if (!refundData) return;
      setShowRefundPinModal(false);
      try {
        const result = await voidPaidOrderAction({
          orderId,
          refundedItemIds: refundData.itemIds,
          reason: refundData.reason,
          refundMethod: refundData.refundMethod,
          managerId,
          managerPin: pin,
        });

        if (result.success) {
          const successResult = result as {
            success: true;
            refundAmount: number;
            replacementOrderId?: Id<"orders">;
          };
          Alert.alert(
            "Refund Processed",
            `Refund of ${formatCurrency(successResult.refundAmount)} has been processed.${
              successResult.replacementOrderId
                ? " A new order has been created with the remaining items."
                : ""
            }`,
            [{ text: "OK", onPress: () => navigation.goBack() }],
          );
        } else {
          const errorResult = result as { success: false; error: string };
          Alert.alert("Error", errorResult.error);
        }
      } catch (error: any) {
        Alert.alert("Error", error.message || "Failed to process refund");
      } finally {
        setRefundData(null);
      }
    },
    [voidPaidOrderAction, orderId, refundData, formatCurrency, navigation],
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
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#F3F4F6">
        <ActivityIndicator size="large" color="#0D87E1" />
      </YStack>
    );
  }

  const orderTypeLabel = order.orderType === "dine_in" ? "Dine-In" : "Take-out";
  const statusVariant =
    order.status === "paid" ? "success" : order.status === "voided" ? "error" : "default";
  const activeItems = order.items.filter((i) => !i.isVoided);
  const isPaid = order.status === "paid";

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      <PageHeader
        onBack={handleBack}
        titleContent={
          <YStack width="100%">
            <XStack alignItems="center" gap={8}>
              <Text variant="heading" size="lg" numberOfLines={1}>
                Order #{order.orderNumber}
              </Text>
              <Badge variant={statusVariant}>
                {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
              </Badge>
            </XStack>
            <Text variant="muted" size="sm" numberOfLines={1}>
              {orderTypeLabel}
            </Text>
          </YStack>
        }
      />

      <ScrollView style={{ flex: 1 }}>
        {/* Order Info */}
        <YStack
          backgroundColor="#FFFFFF"
          marginHorizontal={12}
          marginTop={12}
          padding={16}
          borderRadius={12}
          borderWidth={1}
          borderColor="#F3F4F6"
        >
          <Text
            style={{
              color: "#6B7280",
              fontWeight: "600",
              fontSize: 12,
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Order Info
          </Text>
          <InfoRow label="Date" value={formatDate(order.createdAt)} />
          {order.tableName ? <InfoRow label="Table" value={order.tableName} /> : null}
          {order.customerName ? <InfoRow label="Customer" value={order.customerName} /> : null}
          <InfoRow label="Cashier" value={order.createdByName} />
          {/* Payment breakdown — supports split payments */}
          {receipt?.payments && receipt.payments.length > 0 ? (
            <>
              {receipt.payments.map((p, i) => (
                <InfoRow
                  key={i}
                  label={p.paymentMethod === "cash" ? "Cash" : p.cardPaymentType || "Card/E-Wallet"}
                  value={formatCurrency(p.amount)}
                />
              ))}
              {(() => {
                const totalCashReceived = receipt.payments
                  .filter((p) => p.paymentMethod === "cash")
                  .reduce((sum, p) => sum + (p.cashReceived ?? 0), 0);
                const totalChange = receipt.payments
                  .filter((p) => p.paymentMethod === "cash")
                  .reduce((sum, p) => sum + (p.changeGiven ?? 0), 0);
                return (
                  <>
                    {totalCashReceived > 0 && (
                      <InfoRow label="Cash Tendered" value={formatCurrency(totalCashReceived)} />
                    )}
                    {totalChange > 0 && (
                      <InfoRow label="Change" value={formatCurrency(totalChange)} />
                    )}
                  </>
                );
              })()}
              {receipt.payments
                .filter((p) => p.paymentMethod === "card_ewallet" && p.cardReferenceNumber)
                .map((p, i) => (
                  <InfoRow
                    key={`ref-${i}`}
                    label={`Ref # (${p.cardPaymentType})`}
                    value={p.cardReferenceNumber!}
                  />
                ))}
            </>
          ) : (
            <>
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
            </>
          )}
          {order.paidAt ? <InfoRow label="Paid At" value={formatDate(order.paidAt)} /> : null}
        </YStack>

        {/* Items */}
        <YStack
          backgroundColor="#FFFFFF"
          marginHorizontal={12}
          marginTop={12}
          padding={16}
          borderRadius={12}
          borderWidth={1}
          borderColor="#F3F4F6"
        >
          <Text
            style={{
              color: "#6B7280",
              fontWeight: "600",
              fontSize: 12,
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Items
          </Text>
          {activeItems.map((item) => (
            <XStack
              key={item._id}
              justifyContent="space-between"
              alignItems="center"
              paddingVertical={8}
              borderBottomWidth={1}
              borderColor="#F9FAFB"
            >
              <YStack flex={1}>
                <Text style={{ color: "#111827", fontSize: 14 }}>
                  {item.quantity}x {item.productName}
                </Text>
                {item.notes ? (
                  <Text variant="muted" size="xs">
                    {item.notes}
                  </Text>
                ) : null}
              </YStack>
              <Text style={{ color: "#111827", fontWeight: "500", fontSize: 14 }}>
                {formatCurrency(item.lineTotal)}
              </Text>
            </XStack>
          ))}
        </YStack>

        {/* Discounts */}
        {discounts && discounts.length > 0 ? (
          <YStack
            backgroundColor="#FFFFFF"
            marginHorizontal={12}
            marginTop={12}
            padding={16}
            borderRadius={12}
            borderWidth={1}
            borderColor="#F3F4F6"
          >
            <Text
              style={{
                color: "#6B7280",
                fontWeight: "600",
                fontSize: 12,
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Discounts
            </Text>
            {discounts.map((d) => (
              <XStack
                key={d._id}
                justifyContent="space-between"
                alignItems="center"
                paddingVertical={8}
              >
                <Text style={{ color: "#111827", fontSize: 14 }}>
                  {d.discountType === "senior_citizen" ? "SC" : "PWD"}: {d.customerName}
                </Text>
                <Text style={{ color: "#EF4444", fontWeight: "500", fontSize: 14 }}>
                  -{formatCurrency(d.discountAmount)}
                </Text>
              </XStack>
            ))}
          </YStack>
        ) : null}

        {/* Summary */}
        <YStack
          backgroundColor="#FFFFFF"
          marginHorizontal={12}
          marginTop={12}
          marginBottom={12}
          padding={16}
          borderRadius={12}
          borderWidth={1}
          borderColor="#F3F4F6"
        >
          <Text
            style={{
              color: "#6B7280",
              fontWeight: "600",
              fontSize: 12,
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
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
              valueColor="#EF4444"
            />
          ) : null}
          <XStack
            justifyContent="space-between"
            alignItems="center"
            paddingTop={8}
            marginTop={8}
            borderTopWidth={1}
            borderColor="#E5E7EB"
          >
            <Text style={{ color: "#111827", fontWeight: "700", fontSize: 16 }}>Net Sales</Text>
            <Text style={{ color: "#111827", fontWeight: "700", fontSize: 16 }}>
              {formatCurrency(order.netSales)}
            </Text>
          </XStack>
        </YStack>
      </ScrollView>

      {/* Actions */}
      {isPaid ? (
        <XStack
          padding={16}
          backgroundColor="#FFFFFF"
          borderTopWidth={1}
          borderColor="#E5E7EB"
          gap={12}
        >
          <Button
            variant="primary"
            size="lg"
            style={{ flex: 1 }}
            loading={isReprinting}
            disabled={isReprinting}
            onPress={handleReprint}
          >
            <XStack alignItems="center">
              <Ionicons name="print-outline" size={20} color="#FFF" />
              <Text style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>Reprint</Text>
            </XStack>
          </Button>

          <Button
            variant="outline"
            size="lg"
            style={{ flex: 1 }}
            onPress={() => setShowRefundModal(true)}
          >
            <XStack alignItems="center">
              <Ionicons name="return-down-back-outline" size={20} color="#0D87E1" />
              <Text style={{ color: "#0D87E1", fontWeight: "600", marginLeft: 8 }}>
                Refund Item
              </Text>
            </XStack>
          </Button>

          <Button variant="destructive" size="lg" style={{ flex: 1 }} onPress={handleVoidPress}>
            <XStack alignItems="center">
              <Ionicons name="close-circle-outline" size={20} color="#FFF" />
              <Text style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>Void</Text>
            </XStack>
          </Button>
        </XStack>
      ) : null}

      {/* Void Reason Modal */}
      <Modal
        visible={showVoidReasonModal}
        title="Void Order"
        onClose={() => setShowVoidReasonModal(false)}
        onRequestClose={() => setShowVoidReasonModal(false)}
        position="center"
      >
        <Text variant="muted" style={{ marginBottom: 12 }}>
          Please provide a reason for voiding this order.
        </Text>
        <TextInput
          style={{
            borderWidth: 1,
            borderColor: "#E5E7EB",
            borderRadius: 8,
            padding: 12,
            fontSize: 16,
            color: "#111827",
            minHeight: 80,
          }}
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
          style={{ marginTop: 16 }}
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

      {/* Refund Item Modal */}
      <RefundItemModal
        visible={showRefundModal}
        items={activeItems.map((i) => ({
          _id: i._id,
          productName: i.productName,
          productPrice: i.productPrice,
          quantity: i.quantity,
          lineTotal: i.lineTotal,
        }))}
        onConfirm={handleRefundConfirm}
        onClose={() => setShowRefundModal(false)}
      />

      {/* Refund Manager PIN Modal */}
      <ManagerPinModal
        visible={showRefundPinModal}
        title="Approve Refund"
        description="Manager PIN required to process this refund"
        onClose={() => {
          setShowRefundPinModal(false);
          setRefundData(null);
        }}
        onSuccess={handleRefundPinSuccess}
      />
    </YStack>
  );
};

// Helper components
const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <XStack justifyContent="space-between" alignItems="center" paddingVertical={6}>
    <Text variant="muted" size="sm">
      {label}
    </Text>
    <Text style={{ color: "#111827", fontSize: 14, fontWeight: "500" }}>{value}</Text>
  </XStack>
);

const SummaryRow = ({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) => (
  <XStack justifyContent="space-between" alignItems="center" paddingVertical={4}>
    <Text variant="muted" size="sm">
      {label}
    </Text>
    <Text style={{ color: valueColor ?? "#111827", fontSize: 14 }}>{value}</Text>
  </XStack>
);

export default OrderDetailScreen;
