import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import type { KitchenTicketData } from "../../settings/services/escposFormatter";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { type ReceiptData, useFormatCurrency } from "../../shared";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { Button, IconButton, Text } from "../../shared/components/ui";
import {
  CardPaymentDetails,
  CashInput,
  DiscountModal,
  DiscountSection,
  ManagerPinModal,
  OrderSummary,
  PaymentMethodSelector,
  ReceiptPreviewModal,
  TotalsSummary,
} from "../components";

interface CheckoutScreenProps {
  navigation: any;
  route: {
    params: {
      orderId: Id<"orders">;
      tableId?: Id<"tables">;
      tableName?: string;
      orderType?: "dine_in" | "takeout";
    };
  };
}

type PaymentMethod = "cash" | "card_ewallet";
type DiscountType = "senior_citizen" | "pwd" | null;

export const CheckoutScreen = ({ navigation, route }: CheckoutScreenProps) => {
  const { orderId, tableId, tableName, orderType } = route.params;
  const isTakeout = orderType === "takeout";
  const { user, isLoading, isAuthenticated } = useAuth();
  const formatCurrency = useFormatCurrency();

  // UI State
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [cardPaymentType, setCardPaymentType] = useState("");
  const [cardReferenceNumber, setCardReferenceNumber] = useState("");
  const [customPaymentType, setCustomPaymentType] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Receipt Preview State
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [completedReceiptData, setCompletedReceiptData] = useState<ReceiptData | null>(null);
  const [completedKitchenData, setCompletedKitchenData] = useState<KitchenTicketData | null>(null);

  // Printer Store
  const { printReceipt: printToThermal, openCashDrawer, cashDrawerEnabled } = usePrinterStore();

  // Discount State
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [discountIdNumber, setDiscountIdNumber] = useState("");
  const [discountName, setDiscountName] = useState("");

  // Manager PIN State
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [pendingManagerAction, setPendingManagerAction] = useState<"apply" | "remove" | null>(null);
  const [discountToRemove, setDiscountToRemove] = useState<Id<"orderDiscounts"> | null>(null);

  // Queries - auth is handled automatically by Convex Auth
  const order = useQuery(api.orders.get, { orderId });
  const store = useQuery(api.stores.get, order?.storeId ? { storeId: order.storeId } : "skip");
  const discounts = useQuery(api.discounts.getOrderDiscounts, { orderId });

  // Mutations
  const processCashPayment = useMutation(api.checkout.processCashPayment);
  const processCardPayment = useMutation(api.checkout.processCardPayment);
  const applyBulkScPwdDiscount = useMutation(api.discounts.applyBulkScPwdDiscount);
  const removeDiscount = useMutation(api.discounts.removeDiscount);

  // Computed values
  const activeItems = useMemo(() => order?.items.filter((i) => !i.isVoided) ?? [], [order]);
  const discountedQtyByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of discounts ?? []) {
      if (d.orderItemId) {
        map.set(d.orderItemId, (map.get(d.orderItemId) ?? 0) + d.quantityApplied);
      }
    }
    return map;
  }, [discounts]);
  const change = useMemo(() => {
    if (paymentMethod !== "cash" || !cashReceived) return 0;
    return Math.max(0, parseFloat(cashReceived) - (order?.netSales ?? 0));
  }, [paymentMethod, cashReceived, order?.netSales]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  // Discount handlers
  const handleOpenDiscountModal = useCallback(() => {
    setDiscountType(null);
    setSelectedItemIds(new Set());
    setDiscountIdNumber("");
    setDiscountName("");
    setShowDiscountModal(true);
  }, []);

  const handleItemToggle = useCallback((itemId: Id<"orderItems">) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const availableItemIds = useMemo(() => {
    return activeItems
      .filter((item) => (discountedQtyByItem.get(item._id) ?? 0) < item.quantity)
      .map((item) => item._id);
  }, [activeItems, discountedQtyByItem]);

  const handleSelectAll = useCallback(() => {
    setSelectedItemIds((prev) => {
      const allSelected = availableItemIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(availableItemIds);
    });
  }, [availableItemIds]);

  const handleApplyDiscount = useCallback(() => {
    if (
      !discountType ||
      selectedItemIds.size === 0 ||
      !discountIdNumber.trim() ||
      !discountName.trim()
    ) {
      return;
    }
    setPendingManagerAction("apply");
    setShowDiscountModal(false);
    setShowManagerPinModal(true);
  }, [discountType, selectedItemIds, discountIdNumber, discountName]);

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
    async (managerId: Id<"users">, _pin: string) => {
      setShowManagerPinModal(false);

      if (pendingManagerAction === "apply" && discountType && selectedItemIds.size > 0) {
        try {
          const items = Array.from(selectedItemIds).map((itemId) => ({
            orderItemId: itemId as Id<"orderItems">,
            quantityApplied: 1,
          }));
          await applyBulkScPwdDiscount({
            orderId,
            items,
            discountType,
            customerName: discountName.trim(),
            customerId: discountIdNumber.trim(),
            managerId,
          });
          Alert.alert(
            "Success",
            `Discount applied to ${items.length} item${items.length > 1 ? "s" : ""}`,
          );
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
    [
      pendingManagerAction,
      discountType,
      selectedItemIds,
      discountName,
      discountIdNumber,
      discountToRemove,
      orderId,
      applyBulkScPwdDiscount,
      removeDiscount,
    ],
  );

  // Receipt helpers
  const createReceiptData = useCallback(
    (changeAmount: number, cashAmount?: number): ReceiptData => {
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
        storeContactNumber: store?.contactNumber,
        storeTelephone: store?.telephone,
        storeEmail: store?.email,
        storeWebsite: store?.website,
        storeSocials: store?.socials,
        storeFooter: store?.footer,
        orderNumber: order?.orderNumber ?? "",
        tableName,
        pax: order?.pax,
        orderType: (order?.orderType as "dine_in" | "take_out" | "delivery") ?? "dine_in",
        cashierName: user?.name ?? "Cashier",
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
        paymentMethod: paymentMethod === "cash" ? "cash" : "card_ewallet",
        amountTendered: cashAmount,
        change: changeAmount,
        cardPaymentType: paymentMethod === "card_ewallet" ? cardPaymentType : undefined,
        cardReferenceNumber: paymentMethod === "card_ewallet" ? cardReferenceNumber : undefined,
        transactionDate: new Date(),
        receiptNumber: order?.orderNumber,
      };
    },
    [
      discounts,
      store,
      order,
      tableName,
      user?.name,
      activeItems,
      paymentMethod,
      cardPaymentType,
      cardReferenceNumber,
    ],
  );

  const handleProcessPayment = useCallback(async () => {
    if (!order) return;

    const cashAmount = parseFloat(cashReceived);

    if (paymentMethod === "cash") {
      if (!cashReceived || Number.isNaN(cashAmount)) {
        Alert.alert("Error", "Please enter cash received amount");
        return;
      }
      if (cashAmount < order.netSales) {
        Alert.alert("Error", "Cash received is less than the total amount");
        return;
      }
    }

    if (paymentMethod === "card_ewallet") {
      if (!cardPaymentType || cardPaymentType === "Other") {
        Alert.alert("Error", "Please select a payment type");
        return;
      }
      if (!cardReferenceNumber.trim()) {
        Alert.alert("Error", "Please enter a reference number");
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
        await processCardPayment({
          orderId,
          paymentType: cardPaymentType,
          referenceNumber: cardReferenceNumber.trim(),
        });
      }

      const receiptData = createReceiptData(
        finalChange,
        paymentMethod === "cash" ? cashAmount : undefined,
      );
      setCompletedReceiptData(receiptData);

      // Build kitchen ticket data for printing from the receipt modal
      if (order?.orderNumber) {
        const kitchenData: KitchenTicketData = {
          orderNumber: order.orderNumber,
          tableName: isTakeout ? order.customerName || "Takeout" : tableName || "",
          orderType: isTakeout ? "take_out" : "dine_in",
          items: activeItems.map((i) => ({
            name: i.productName,
            quantity: i.quantity,
            notes: i.notes,
            modifiers: i.modifiers?.map((m) => ({
              optionName: m.optionName,
              priceAdjustment: m.priceAdjustment,
            })),
          })),
          timestamp: new Date(),
        };
        setCompletedKitchenData(kitchenData);
      }

      // Auto-open cash drawer after payment
      if (cashDrawerEnabled) {
        try {
          await openCashDrawer();
        } catch {
          // Don't block checkout if drawer fails to open
        }
      }

      setShowReceiptPreview(true);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Payment failed");
    } finally {
      setIsProcessing(false);
    }
  }, [
    order,
    cashReceived,
    paymentMethod,
    cardPaymentType,
    cardReferenceNumber,
    processCashPayment,
    processCardPayment,
    orderId,
    createReceiptData,
    cashDrawerEnabled,
    openCashDrawer,
  ]);

  if (isLoading || !isAuthenticated || !order) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#F3F4F6">
        <ActivityIndicator size="large" color="#0D87E1" />
      </YStack>
    );
  }

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      {/* Header */}
      <XStack
        backgroundColor="#FFFFFF"
        alignItems="center"
        paddingHorizontal={16}
        paddingVertical={12}
        borderBottomWidth={1}
        borderColor="#E5E7EB"
      >
        <IconButton
          icon="arrow-back"
          variant="ghost"
          onPress={handleBack}
          style={{ marginRight: 8 }}
        />
        <YStack flex={1}>
          <Text variant="heading" size="lg">
            Checkout
          </Text>
          <Text variant="muted" size="sm">
            {tableName ?? `Order #${order.orderNumber}`}
          </Text>
        </YStack>
        <SystemStatusBar />
      </XStack>

      <KeyboardAwareScrollView style={{ flex: 1 }}>
        <OrderSummary items={activeItems} />

        <DiscountSection
          discounts={discounts ?? []}
          onAddDiscount={handleOpenDiscountModal}
          onRemoveDiscount={handleRemoveDiscount}
        />

        <PaymentMethodSelector selected={paymentMethod} onSelect={setPaymentMethod} />

        {paymentMethod === "cash" && <CashInput value={cashReceived} onChange={setCashReceived} />}

        {paymentMethod === "card_ewallet" && (
          <CardPaymentDetails
            paymentType={cardPaymentType}
            referenceNumber={cardReferenceNumber}
            customPaymentType={customPaymentType}
            onPaymentTypeChange={setCardPaymentType}
            onReferenceNumberChange={setCardReferenceNumber}
            onCustomPaymentTypeChange={setCustomPaymentType}
          />
        )}

        <TotalsSummary
          grossSales={order.grossSales}
          vatAmount={order.vatAmount}
          discountAmount={order.discountAmount}
          netSales={order.netSales}
          change={change}
          showChange={paymentMethod === "cash" && !!cashReceived}
        />
      </KeyboardAwareScrollView>

      {/* Footer */}
      <YStack padding={16} backgroundColor="#FFFFFF" borderTopWidth={1} borderColor="#E5E7EB">
        <Button
          variant="success"
          size="lg"
          loading={isProcessing}
          disabled={isProcessing}
          onPress={handleProcessPayment}
        >
          <XStack alignItems="center">
            <Ionicons name="checkmark-circle" size={24} color="#FFF" />
            <Text style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>
              Complete Payment - {formatCurrency(order.netSales)}
            </Text>
          </XStack>
        </Button>
      </YStack>

      {/* Modals */}
      <DiscountModal
        visible={showDiscountModal}
        items={activeItems}
        discountedQtyByItem={discountedQtyByItem}
        discountType={discountType}
        selectedItemIds={selectedItemIds}
        idNumber={discountIdNumber}
        customerName={discountName}
        onClose={() => setShowDiscountModal(false)}
        onDiscountTypeChange={setDiscountType}
        onItemToggle={handleItemToggle}
        onSelectAll={handleSelectAll}
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

      <ReceiptPreviewModal
        visible={showReceiptPreview}
        receiptData={completedReceiptData}
        kitchenTicketData={completedKitchenData}
        onPrint={async () => {
          if (!completedReceiptData) return;
          await printToThermal(completedReceiptData);
        }}
        onSkip={() => {
          if (isTakeout) {
            navigation.reset({
              index: 0,
              routes: [{ name: "HomeScreen" }, { name: "TakeoutListScreen" }],
            });
          } else {
            navigation.reset({
              index: 0,
              routes: [{ name: "HomeScreen" }, { name: "TablesScreen" }],
            });
          }
        }}
      />
    </YStack>
  );
};

export default CheckoutScreen;
