import React, { useState, useCallback, useMemo } from "react";
import { View, ScrollView, ActivityIndicator } from "uniwind/components";
import { Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAuth } from "../../auth/context";
import { Text, Button, IconButton } from "../../shared/components/ui";
import { useFormatCurrency, ReceiptData, printReceipt, shareReceipt } from "../../shared";
import {
  OrderSummary,
  PaymentMethodSelector,
  CashInput,
  TotalsSummary,
  DiscountSection,
  DiscountModal,
  ManagerPinModal,
} from "../components";

interface CheckoutScreenProps {
  navigation: any;
  route: {
    params: {
      orderId: Id<"orders">;
      tableId?: Id<"tables">;
      tableName?: string;
    };
  };
}

type PaymentMethod = "cash" | "card_ewallet";
type DiscountType = "senior_citizen" | "pwd" | null;

export const CheckoutScreen = ({ navigation, route }: CheckoutScreenProps) => {
  const { orderId, tableId, tableName } = route.params;
  const { user, isLoading, isAuthenticated } = useAuth();
  const formatCurrency = useFormatCurrency();

  // UI State
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Discount State
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>(null);
  const [selectedItemId, setSelectedItemId] = useState<Id<"orderItems"> | null>(null);
  const [discountIdNumber, setDiscountIdNumber] = useState("");
  const [discountName, setDiscountName] = useState("");

  // Manager PIN State
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [pendingManagerAction, setPendingManagerAction] = useState<"apply" | "remove" | null>(null);
  const [discountToRemove, setDiscountToRemove] = useState<Id<"orderDiscounts"> | null>(null);

  // Queries - auth is handled automatically by Convex Auth
  const order = useQuery(api.orders.get, { orderId });
  const store = useQuery(
    api.stores.get,
    order?.storeId ? { storeId: order.storeId } : "skip"
  );
  const discounts = useQuery(api.discounts.getOrderDiscounts, { orderId });

  // Mutations
  const processCashPayment = useMutation(api.checkout.processCashPayment);
  const processCardPayment = useMutation(api.checkout.processCardPayment);
  const applyScPwdDiscount = useMutation(api.discounts.applyScPwdDiscount);
  const removeDiscount = useMutation(api.discounts.removeDiscount);

  // Computed values
  const activeItems = useMemo(() => order?.items.filter((i) => !i.isVoided) ?? [], [order]);
  const appliedDiscountItemIds = useMemo(
    () => discounts?.map((d) => d.orderItemId).filter(Boolean) as Id<"orderItems">[] ?? [],
    [discounts]
  );
  const change = useMemo(() => {
    if (paymentMethod !== "cash" || !cashReceived) return 0;
    return Math.max(0, parseFloat(cashReceived) - (order?.netSales ?? 0));
  }, [paymentMethod, cashReceived, order?.netSales]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  // Discount handlers
  const handleOpenDiscountModal = useCallback(() => {
    setDiscountType(null);
    setSelectedItemId(null);
    setDiscountIdNumber("");
    setDiscountName("");
    setShowDiscountModal(true);
  }, []);

  const handleApplyDiscount = useCallback(() => {
    if (!discountType || !selectedItemId || !discountIdNumber.trim() || !discountName.trim()) {
      return;
    }
    setPendingManagerAction("apply");
    setShowDiscountModal(false);
    setShowManagerPinModal(true);
  }, [discountType, selectedItemId, discountIdNumber, discountName]);

  const handleRemoveDiscount = useCallback((discountId: Id<"orderDiscounts">) => {
    Alert.alert("Remove Discount", "Are you sure you want to remove this discount?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          setDiscountToRemove(discountId);
          setPendingManagerAction("remove");
          setShowManagerPinModal(true);
        },
      },
    ]);
  }, []);

  const handleManagerPinSuccess = useCallback(
    async (managerId: Id<"users">) => {
      setShowManagerPinModal(false);

      if (pendingManagerAction === "apply" && discountType && selectedItemId) {
        try {
          await applyScPwdDiscount({
            orderId,
            orderItemId: selectedItemId,
            discountType,
            customerName: discountName.trim(),
            customerId: discountIdNumber.trim(),
            quantityApplied: 1,
            managerId,
          });
          Alert.alert("Success", "Discount applied successfully");
        } catch (error: any) {
          Alert.alert("Error", error.message || "Failed to apply discount");
        }
      } else if (pendingManagerAction === "remove" && discountToRemove) {
        try {
          await removeDiscount({ discountId: discountToRemove, managerId });
        } catch (error: any) {
          Alert.alert("Error", error.message || "Failed to remove discount");
        }
      }

      setPendingManagerAction(null);
      setDiscountToRemove(null);
    },
    [pendingManagerAction, discountType, selectedItemId, discountName, discountIdNumber, discountToRemove, orderId, applyScPwdDiscount, removeDiscount]
  );

  // Receipt helpers
  const createReceiptData = useCallback(
    (changeAmount: number, cashAmount?: number): ReceiptData => {
      const discountInfo =
        discounts && discounts.length > 0
          ? {
              type: discounts[0].discountType === "senior_citizen" ? ("sc" as const) : ("pwd" as const),
              description: discounts.map((d) => `${d.discountType === "senior_citizen" ? "SC" : "PWD"}: ${d.customerName}`).join(", "),
              amount: discounts.reduce((sum, d) => sum + d.discountAmount, 0),
            }
          : undefined;

      const storeAddress = store ? [store.address1, store.address2].filter(Boolean).join(", ") : undefined;

      return {
        storeName: store?.name ?? "Store",
        storeAddress,
        storeTin: store?.tin,
        orderNumber: order?.orderNumber ?? "",
        tableName,
        orderType: (order?.orderType as "dine_in" | "take_out" | "delivery") ?? "dine_in",
        cashierName: user?.name ?? "Cashier",
        items: activeItems.map((item) => ({
          name: item.productName,
          quantity: item.quantity,
          price: item.productPrice,
          total: item.lineTotal,
        })),
        subtotal: order?.grossSales ?? 0,
        discount: discountInfo,
        vatableSales: order?.vatableSales ?? 0,
        vatAmount: order?.vatAmount ?? 0,
        vatExemptSales: order?.vatExemptSales ?? 0,
        total: order?.netSales ?? 0,
        paymentMethod: paymentMethod === "cash" ? "cash" : "card",
        amountTendered: cashAmount,
        change: changeAmount,
        transactionDate: new Date(),
        receiptNumber: order?.orderNumber,
        customerName: discounts?.[0]?.customerName,
        customerId: discounts?.[0]?.customerId,
      };
    },
    [discounts, store, order, tableName, user?.name, activeItems, paymentMethod]
  );

  const handleProcessPayment = useCallback(async () => {
    if (!order) return;

    const cashAmount = parseFloat(cashReceived);

    if (paymentMethod === "cash") {
      if (!cashReceived || isNaN(cashAmount)) {
        Alert.alert("Error", "Please enter cash received amount");
        return;
      }
      if (cashAmount < order.netSales) {
        Alert.alert("Error", "Cash received is less than the total amount");
        return;
      }
    }

    setIsProcessing(true);
    try {
      let finalChange = 0;

      if (paymentMethod === "cash") {
        const result = await processCashPayment({ orderId, cashReceived: cashAmount });
        finalChange = result.changeGiven;
      } else {
        await processCardPayment({ orderId });
      }

      Alert.alert(
        "Payment Successful",
        paymentMethod === "cash" ? `Change: ${formatCurrency(finalChange)}` : "Payment processed successfully",
        [
          {
            text: "Print Receipt",
            onPress: async () => {
              try {
                await printReceipt(createReceiptData(finalChange, paymentMethod === "cash" ? cashAmount : undefined));
              } catch (e) {}
              navigation.reset({ index: 0, routes: [{ name: "TablesScreen" }] });
            },
          },
          {
            text: "Share Receipt",
            onPress: async () => {
              try {
                await shareReceipt(createReceiptData(finalChange, paymentMethod === "cash" ? cashAmount : undefined));
              } catch (e) {}
              navigation.reset({ index: 0, routes: [{ name: "TablesScreen" }] });
            },
          },
          {
            text: "Skip",
            style: "cancel",
            onPress: () => navigation.reset({ index: 0, routes: [{ name: "TablesScreen" }] }),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert("Error", error.message || "Payment failed");
    } finally {
      setIsProcessing(false);
    }
  }, [order, cashReceived, paymentMethod, processCashPayment, processCardPayment, orderId, formatCurrency, createReceiptData, navigation]);

  if (isLoading || !isAuthenticated || !order) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-100">
        <ActivityIndicator size="large" color="#0D87E1" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-100">
      {/* Header */}
      <View className="bg-white flex-row items-center px-4 py-3 border-b border-gray-200">
        <IconButton icon="arrow-back" variant="ghost" onPress={handleBack} className="mr-2" />
        <View className="flex-1">
          <Text variant="heading" size="lg">Checkout</Text>
          <Text variant="muted" size="sm">{tableName ?? `Order #${order.orderNumber}`}</Text>
        </View>
      </View>

      <ScrollView className="flex-1">
        <OrderSummary items={activeItems} />

        <DiscountSection
          discounts={discounts ?? []}
          onAddDiscount={handleOpenDiscountModal}
          onRemoveDiscount={handleRemoveDiscount}
        />

        <PaymentMethodSelector selected={paymentMethod} onSelect={setPaymentMethod} />

        {paymentMethod === "cash" && (
          <CashInput value={cashReceived} onChange={setCashReceived} />
        )}

        <TotalsSummary
          grossSales={order.grossSales}
          vatAmount={order.vatAmount}
          discountAmount={order.discountAmount}
          netSales={order.netSales}
          change={change}
          showChange={paymentMethod === "cash" && !!cashReceived}
        />
      </ScrollView>

      {/* Footer */}
      <View className="p-4 bg-white border-t border-gray-200">
        <Button variant="success" size="lg" loading={isProcessing} disabled={isProcessing} onPress={handleProcessPayment}>
          <View className="flex-row items-center">
            <Ionicons name="checkmark-circle" size={24} color="#FFF" />
            <Text className="text-white font-semibold ml-2">
              Complete Payment - {formatCurrency(order.netSales)}
            </Text>
          </View>
        </Button>
      </View>

      {/* Modals */}
      <DiscountModal
        visible={showDiscountModal}
        items={activeItems}
        appliedDiscountItemIds={appliedDiscountItemIds}
        discountType={discountType}
        selectedItemId={selectedItemId}
        idNumber={discountIdNumber}
        customerName={discountName}
        onClose={() => setShowDiscountModal(false)}
        onDiscountTypeChange={setDiscountType}
        onItemSelect={setSelectedItemId}
        onIdNumberChange={setDiscountIdNumber}
        onCustomerNameChange={setDiscountName}
        onApply={handleApplyDiscount}
      />

      <ManagerPinModal
        visible={showManagerPinModal}
        title={pendingManagerAction === "apply" ? "Approve Discount" : "Approve Removal"}
        description="Manager PIN required to proceed"
        onClose={() => {
          setShowManagerPinModal(false);
          setPendingManagerAction(null);
        }}
        onSuccess={handleManagerPinSuccess}
      />
    </View>
  );
};

export default CheckoutScreen;
