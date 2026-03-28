import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, TextInput, TouchableOpacity } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import type { KitchenTicketData } from "../../settings/services/escposFormatter";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { type ReceiptData, useFormatCurrency } from "../../shared";
import { PageHeader } from "../../shared/components/PageHeader";
import { Button, Card, Text } from "../../shared/components/ui";
import {
  DiscountModal,
  DiscountSection,
  ManagerPinModal,
  OrderSummary,
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

type DiscountType = "senior_citizen" | "pwd" | null;

interface PaymentLine {
  id: string;
  paymentMethod: "cash" | "card_ewallet";
  amount: string;
  cashReceived: string;
  cardPaymentType: string;
  cardReferenceNumber: string;
  customPaymentType: string;
}

const PAYMENT_TYPES = ["Credit/Debit Card", "GCash", "Maya", "Bank Transfer", "Other"] as const;
const QUICK_AMOUNTS = [50, 100, 200, 500, 1000, 2000];

export const CheckoutScreen = ({ navigation, route }: CheckoutScreenProps) => {
  const { orderId, tableName, orderType } = route.params;
  const isTakeout = orderType === "takeout";
  const { user, isLoading, isAuthenticated } = useAuth();
  const formatCurrency = useFormatCurrency();

  // Payment Lines State
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
    {
      id: "1",
      paymentMethod: "cash",
      amount: "",
      cashReceived: "",
      cardPaymentType: "",
      cardReferenceNumber: "",
      customPaymentType: "",
    },
  ]);
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
  const processPaymentMutation = useMutation(api.checkout.processPayment);
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

  // Payment calculations
  const totalPayments = useMemo(
    () => paymentLines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0),
    [paymentLines],
  );
  const remaining = useMemo(
    () => (order?.netSales ?? 0) - totalPayments,
    [order?.netSales, totalPayments],
  );

  // For single cash line: compute change (cash received minus total amount due)
  const firstCashLine = paymentLines.find((l) => l.paymentMethod === "cash");
  const cashChange = useMemo(() => {
    if (!firstCashLine || !firstCashLine.cashReceived) return 0;
    return Math.max(0, parseFloat(firstCashLine.cashReceived) - (order?.netSales ?? 0));
  }, [firstCashLine, order?.netSales]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  // Payment line helpers
  const addPaymentLine = useCallback(() => {
    setPaymentLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        paymentMethod: "card_ewallet",
        amount: "",
        cashReceived: "",
        cardPaymentType: "",
        cardReferenceNumber: "",
        customPaymentType: "",
      },
    ]);
  }, []);

  const removePaymentLine = useCallback((id: string) => {
    setPaymentLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const updatePaymentLine = useCallback((id: string, updates: Partial<PaymentLine>) => {
    setPaymentLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  }, []);

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
      .filter((item) => (discountedQtyByItem.get(item._id) ?? 0) === 0)
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
  const createReceiptData = useCallback((): ReceiptData => {
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

    // For receipt compatibility: use first cash line's tendered/change, or first line's method
    const primaryLine = paymentLines[0];
    const cashTendered =
      primaryLine?.paymentMethod === "cash" && primaryLine.cashReceived
        ? parseFloat(primaryLine.cashReceived)
        : undefined;
    const changeAmount =
      primaryLine?.paymentMethod === "cash" && cashTendered
        ? Math.max(0, cashTendered - (order?.netSales ?? 0))
        : 0;

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
      tableMarker: order?.tableMarker,
      orderCategory: order?.orderCategory,
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
      paymentMethod:
        paymentLines.length === 1 && primaryLine?.paymentMethod === "card_ewallet"
          ? "card_ewallet"
          : "cash",
      amountTendered: cashTendered,
      change: changeAmount,
      cardPaymentType:
        primaryLine?.paymentMethod === "card_ewallet"
          ? primaryLine.cardPaymentType || undefined
          : undefined,
      cardReferenceNumber:
        primaryLine?.paymentMethod === "card_ewallet"
          ? primaryLine.cardReferenceNumber || undefined
          : undefined,
      transactionDate: new Date(),
      receiptNumber: order?.orderNumber,
    };
  }, [discounts, store, order, tableName, user?.name, activeItems, paymentLines]);

  const handleProcessPayment = useCallback(async () => {
    if (!order) return;

    // Validate each payment line
    for (const line of paymentLines) {
      const lineAmount = parseFloat(line.amount) || 0;
      if (lineAmount <= 0) {
        Alert.alert("Error", "Each payment line must have an amount greater than zero");
        return;
      }
      if (line.paymentMethod === "cash") {
        const cashAmt = parseFloat(line.cashReceived) || 0;
        if (!line.cashReceived || Number.isNaN(cashAmt)) {
          Alert.alert("Error", "Please enter cash received amount");
          return;
        }
        if (cashAmt < lineAmount) {
          Alert.alert("Error", "Cash received cannot be less than the cash payment amount");
          return;
        }
      }
      if (line.paymentMethod === "card_ewallet") {
        if (!line.cardPaymentType || line.cardPaymentType === "Other") {
          Alert.alert("Error", "Please select a payment type for card/e-wallet");
          return;
        }
        if (!line.cardReferenceNumber.trim()) {
          Alert.alert("Error", "Please enter a reference number for card/e-wallet");
          return;
        }
      }
    }

    if (remaining > 0.005) {
      Alert.alert(
        "Error",
        `Payment is short by ${formatCurrency(remaining)}. Please add more payment.`,
      );
      return;
    }

    setIsProcessing(true);
    try {
      const payments = paymentLines.map((line) => ({
        paymentMethod: line.paymentMethod,
        amount: parseFloat(line.amount) || 0,
        cashReceived:
          line.paymentMethod === "cash" ? parseFloat(line.cashReceived) || undefined : undefined,
        cardPaymentType:
          line.paymentMethod === "card_ewallet"
            ? (line.cardPaymentType === "Other" ? line.customPaymentType : line.cardPaymentType) ||
              undefined
            : undefined,
        cardReferenceNumber:
          line.paymentMethod === "card_ewallet" ? line.cardReferenceNumber || undefined : undefined,
      }));

      await processPaymentMutation({ orderId, payments });

      const receiptData = createReceiptData();
      setCompletedReceiptData(receiptData);

      // Build kitchen ticket data for printing from the receipt modal
      if (order?.orderNumber) {
        const kitchenData: KitchenTicketData = {
          orderNumber: order.orderNumber,
          orderType: isTakeout ? "take_out" : "dine_in",
          tableMarker: order.tableMarker,
          customerName: order.customerName,
          orderCategory: order.orderCategory,
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
    paymentLines,
    remaining,
    activeItems,
    isTakeout,
    processPaymentMutation,
    orderId,
    createReceiptData,
    cashDrawerEnabled,
    openCashDrawer,
    formatCurrency,
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
      <PageHeader
        title="Checkout"
        subtitle={`${tableName ?? `Order #${order.orderNumber}`} · ${activeItems.length} line${
          activeItems.length === 1 ? "" : "s"
        }`}
        onBack={handleBack}
      />

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: 8, paddingBottom: 120 }}
      >
        <OrderSummary items={activeItems} />

        <DiscountSection
          discounts={discounts ?? []}
          onAddDiscount={handleOpenDiscountModal}
          onRemoveDiscount={handleRemoveDiscount}
        />

        {/* Payment Lines */}
        <YStack paddingHorizontal={16} paddingVertical={12}>
          <Text variant="heading" style={{ marginBottom: 12 }}>
            Payment
          </Text>

          {paymentLines.map((line, index) => (
            <PaymentLineCard
              key={line.id}
              line={line}
              lineIndex={index}
              totalLines={paymentLines.length}
              orderNetSales={order.netSales}
              onUpdate={(updates) => updatePaymentLine(line.id, updates)}
              onRemove={() => removePaymentLine(line.id)}
            />
          ))}

          {/* Remaining Balance */}
          {paymentLines.length > 1 && (
            <XStack
              justifyContent="space-between"
              alignItems="center"
              backgroundColor={remaining <= 0 ? "#DCFCE7" : "#FEF3C7"}
              borderRadius={12}
              paddingHorizontal={16}
              paddingVertical={12}
              marginBottom={12}
            >
              <Text
                style={{
                  fontWeight: "600",
                  color: remaining <= 0 ? "#16A34A" : "#92400E",
                  fontSize: 15,
                }}
              >
                {remaining <= 0 ? "Fully Covered" : "Remaining"}
              </Text>
              <Text
                style={{
                  fontWeight: "700",
                  fontSize: 18,
                  color: remaining <= 0 ? "#16A34A" : "#B45309",
                }}
              >
                {remaining <= 0 ? formatCurrency(0) : formatCurrency(remaining)}
              </Text>
            </XStack>
          )}

          {/* Add Payment Method Button */}
          <TouchableOpacity
            onPress={addPaymentLine}
            activeOpacity={0.7}
            style={{
              borderWidth: 1.5,
              borderColor: "#0D87E1",
              borderStyle: "dashed",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
            }}
          >
            <Ionicons name="add-circle-outline" size={20} color="#0D87E1" />
            <Text style={{ color: "#0D87E1", fontWeight: "600", fontSize: 15 }}>
              Add Payment Method
            </Text>
          </TouchableOpacity>
        </YStack>

        <TotalsSummary
          grossSales={order.grossSales}
          vatAmount={order.vatAmount}
          discountAmount={order.discountAmount}
          netSales={order.netSales}
          change={cashChange}
          showChange={
            paymentLines.length === 1 &&
            paymentLines[0].paymentMethod === "cash" &&
            !!paymentLines[0].cashReceived
          }
        />
      </KeyboardAwareScrollView>

      {/* Footer */}
      <YStack padding={16} backgroundColor="#FFFFFF" borderTopWidth={1} borderColor="#E5E7EB">
        <XStack justifyContent="space-between" alignItems="center" marginBottom={12}>
          <YStack>
            <Text variant="muted" size="xs">
              Amount Due
            </Text>
            <Text style={{ color: "#0F172A", fontWeight: "700", fontSize: 22 }}>
              {formatCurrency(order.netSales)}
            </Text>
          </YStack>
          {paymentLines.length === 1 ? (
            <YStack
              backgroundColor={paymentLines[0].paymentMethod === "cash" ? "#EFF6FF" : "#F3F4F6"}
              borderRadius={999}
              paddingHorizontal={12}
              paddingVertical={6}
            >
              <Text
                style={{
                  color: paymentLines[0].paymentMethod === "cash" ? "#0D87E1" : "#6B7280",
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                {paymentLines[0].paymentMethod === "cash" ? "Cash" : "Card/E-Wallet"}
              </Text>
            </YStack>
          ) : (
            <YStack
              backgroundColor="#EFF6FF"
              borderRadius={999}
              paddingHorizontal={12}
              paddingVertical={6}
            >
              <Text style={{ color: "#0D87E1", fontWeight: "700", fontSize: 12 }}>
                Split Payment
              </Text>
            </YStack>
          )}
        </XStack>
        <Button
          variant="success"
          size="lg"
          loading={isProcessing}
          disabled={isProcessing || remaining > 0.005}
          onPress={handleProcessPayment}
        >
          <XStack alignItems="center">
            <Ionicons name="checkmark-circle" size={24} color="#FFF" />
            <Text style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>
              Complete Payment
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

// ─── PaymentLineCard ────────────────────────────────────────────────────────

interface PaymentLineCardProps {
  line: PaymentLine;
  lineIndex: number;
  totalLines: number;
  orderNetSales: number;
  onUpdate: (updates: Partial<PaymentLine>) => void;
  onRemove: () => void;
}

const PaymentLineCard = ({
  line,
  lineIndex,
  totalLines,
  orderNetSales,
  onUpdate,
  onRemove,
}: PaymentLineCardProps) => {
  const amountValue = parseFloat(line.amount) || 0;
  const cashReceivedValue = parseFloat(line.cashReceived) || 0;
  const selectedCardType = PAYMENT_TYPES.includes(line.cardPaymentType as any)
    ? line.cardPaymentType
    : "Other";

  const handleQuickAdd = (amount: number) => {
    const newValue = cashReceivedValue + amount;
    onUpdate({ cashReceived: newValue.toString() });
  };

  const handleExactAmount = () => {
    onUpdate({
      cashReceived:
        amountValue > 0
          ? amountValue.toFixed(2).replace(/\.00$/, "")
          : orderNetSales.toFixed(2).replace(/\.00$/, ""),
    });
  };

  return (
    <Card variant="outlined" style={{ marginBottom: 12 }}>
      {/* Line Header: label + remove button */}
      <XStack justifyContent="space-between" alignItems="center" marginBottom={12}>
        <Text style={{ fontWeight: "700", color: "#374151", fontSize: 15 }}>
          {totalLines > 1 ? `Payment ${lineIndex + 1}` : "Payment Method"}
        </Text>
        {totalLines > 1 && (
          <TouchableOpacity
            onPress={onRemove}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              backgroundColor: "#FEE2E2",
              borderRadius: 8,
              padding: 6,
            }}
          >
            <Ionicons name="close" size={18} color="#DC2626" />
          </TouchableOpacity>
        )}
      </XStack>

      {/* Payment Method Toggle */}
      <Text variant="muted" size="xs" style={{ marginBottom: 10 }}>
        Choose how the customer will settle this portion
      </Text>
      <XStack gap={12} marginBottom={14}>
        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: line.paymentMethod === "cash" ? "#EFF6FF" : "#FFFFFF",
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 12,
            alignItems: "center",
            borderWidth: 1.5,
            borderColor: line.paymentMethod === "cash" ? "#0D87E1" : "#E5E7EB",
            minHeight: 68,
            justifyContent: "center",
          }}
          onPress={() => onUpdate({ paymentMethod: "cash" })}
          activeOpacity={0.7}
        >
          <Ionicons
            name="cash-outline"
            size={20}
            color={line.paymentMethod === "cash" ? "#0D87E1" : "#6B7280"}
          />
          <Text
            style={{
              marginTop: 6,
              fontWeight: "600",
              fontSize: 13,
              color: line.paymentMethod === "cash" ? "#0D87E1" : "#374151",
            }}
          >
            Cash
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: line.paymentMethod === "card_ewallet" ? "#EFF6FF" : "#FFFFFF",
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 12,
            alignItems: "center",
            borderWidth: 1.5,
            borderColor: line.paymentMethod === "card_ewallet" ? "#0D87E1" : "#E5E7EB",
            minHeight: 68,
            justifyContent: "center",
          }}
          onPress={() => onUpdate({ paymentMethod: "card_ewallet" })}
          activeOpacity={0.7}
        >
          <Ionicons
            name="card-outline"
            size={20}
            color={line.paymentMethod === "card_ewallet" ? "#0D87E1" : "#6B7280"}
          />
          <Text
            style={{
              marginTop: 6,
              fontWeight: "600",
              fontSize: 13,
              color: line.paymentMethod === "card_ewallet" ? "#0D87E1" : "#374151",
            }}
          >
            Card/E-Wallet
          </Text>
        </TouchableOpacity>
      </XStack>

      {/* Amount Input */}
      <Text variant="muted" size="sm" style={{ marginBottom: 8 }}>
        Amount
      </Text>
      <XStack
        alignItems="center"
        backgroundColor="#F9FAFB"
        borderRadius={12}
        paddingHorizontal={14}
        borderWidth={1}
        borderColor={amountValue > 0 ? "#0D87E1" : "#E5E7EB"}
        marginBottom={14}
      >
        <Text style={{ color: "#6B7280", fontWeight: "600", fontSize: 20 }}>₱</Text>
        <TextInput
          style={{
            flex: 1,
            padding: 14,
            fontWeight: "700",
            fontSize: 20,
            color: "#111827",
          }}
          placeholder="0.00"
          placeholderTextColor="#9CA3AF"
          value={line.amount}
          onChangeText={(val) => onUpdate({ amount: val })}
          keyboardType="numeric"
        />
      </XStack>

      {/* Cash-specific: Cash Received + Quick Amounts */}
      {line.paymentMethod === "cash" && (
        <>
          <Text variant="muted" size="sm" style={{ marginBottom: 8 }}>
            Cash Received
          </Text>
          <XStack
            alignItems="center"
            backgroundColor="#F9FAFB"
            borderRadius={12}
            paddingHorizontal={14}
            borderWidth={1}
            borderColor={
              cashReceivedValue >= amountValue && cashReceivedValue > 0 ? "#22C55E" : "#E5E7EB"
            }
            marginBottom={10}
          >
            <Text style={{ color: "#6B7280", fontWeight: "600", fontSize: 20 }}>₱</Text>
            <TextInput
              style={{
                flex: 1,
                padding: 14,
                fontWeight: "700",
                fontSize: 20,
                color:
                  cashReceivedValue >= amountValue && cashReceivedValue > 0 ? "#16A34A" : "#111827",
              }}
              placeholder="0.00"
              placeholderTextColor="#9CA3AF"
              value={line.cashReceived}
              onChangeText={(val) => onUpdate({ cashReceived: val })}
              keyboardType="numeric"
            />
            {line.cashReceived !== "" && (
              <TouchableOpacity
                onPress={() => onUpdate({ cashReceived: "" })}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                activeOpacity={0.6}
              >
                <Ionicons name="close-circle" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </XStack>

          {/* Exact Amount shortcut */}
          <TouchableOpacity
            style={{
              backgroundColor:
                cashReceivedValue === amountValue && amountValue > 0 ? "#DCFCE7" : "#F0FDF4",
              paddingVertical: 12,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor:
                cashReceivedValue === amountValue && amountValue > 0 ? "#22C55E" : "#BBF7D0",
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 10,
            }}
            onPress={handleExactAmount}
            activeOpacity={0.7}
          >
            <Text style={{ color: "#16A34A", fontWeight: "700", fontSize: 13 }}>Exact Amount</Text>
          </TouchableOpacity>

          {/* Quick add buttons */}
          <XStack flexWrap="wrap" gap={8}>
            {QUICK_AMOUNTS.map((amount) => (
              <TouchableOpacity
                key={amount}
                style={{
                  backgroundColor: "#FFFFFF",
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: "#E5E7EB",
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPress={() => handleQuickAdd(amount)}
                activeOpacity={0.7}
              >
                <Text style={{ color: "#374151", fontWeight: "600", fontSize: 14 }}>
                  +₱{amount.toLocaleString()}
                </Text>
              </TouchableOpacity>
            ))}
          </XStack>
        </>
      )}

      {/* Card/E-Wallet specific: payment type + reference */}
      {line.paymentMethod === "card_ewallet" && (
        <>
          <Text variant="muted" size="sm" style={{ marginBottom: 10 }}>
            Payment Type
          </Text>
          <XStack flexWrap="wrap" gap={8} marginBottom={12}>
            {PAYMENT_TYPES.map((type) => {
              const isOtherSelected =
                type === "Other" &&
                !PAYMENT_TYPES.slice(0, -1).includes(line.cardPaymentType as any) &&
                line.cardPaymentType !== "";
              const active = type === line.cardPaymentType || isOtherSelected;
              return (
                <TouchableOpacity
                  key={type}
                  onPress={() => {
                    if (type === "Other") {
                      onUpdate({ cardPaymentType: line.customPaymentType || "Other" });
                    } else {
                      onUpdate({ cardPaymentType: type });
                    }
                  }}
                  activeOpacity={0.7}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 9999,
                    borderWidth: 1.5,
                    backgroundColor: active ? "#EFF6FF" : "#FFFFFF",
                    borderColor: active ? "#0D87E1" : "#D1D5DB",
                    minHeight: 44,
                    justifyContent: "center",
                  }}
                >
                  <Text
                    size="sm"
                    style={{
                      color: active ? "#0D87E1" : "#374151",
                      fontWeight: "600",
                    }}
                  >
                    {type}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </XStack>

          {selectedCardType === "Other" &&
            !PAYMENT_TYPES.slice(0, -1).includes(line.cardPaymentType as any) && (
              <TextInput
                style={{
                  borderWidth: 1,
                  borderColor: "#D1D5DB",
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  marginBottom: 12,
                  fontSize: 16,
                  minHeight: 48,
                  backgroundColor: "#F9FAFB",
                }}
                placeholder="Enter payment type..."
                value={line.customPaymentType}
                onChangeText={(text) => {
                  onUpdate({
                    customPaymentType: text,
                    cardPaymentType: text || "Other",
                  });
                }}
                autoCapitalize="words"
              />
            )}

          <Text variant="muted" size="sm" style={{ marginBottom: 8 }}>
            Reference Number
          </Text>
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: "#D1D5DB",
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: 16,
              minHeight: 48,
              backgroundColor: "#F9FAFB",
            }}
            placeholder="Enter reference number..."
            value={line.cardReferenceNumber}
            onChangeText={(val) => onUpdate({ cardReferenceNumber: val })}
            autoCapitalize="characters"
          />
        </>
      )}
    </Card>
  );
};

export default CheckoutScreen;
