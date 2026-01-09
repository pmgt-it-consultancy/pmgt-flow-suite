import React, { useState, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Modal,
} from "react-native";
import { RFValue } from "react-native-responsive-fontsize";
import { useQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAuth, useSessionToken } from "../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import ManagerPinModal from "../components/ManagerPinModal";
import { ReceiptData, printReceipt, shareReceipt } from "../utils/receipt";

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

const CheckoutScreen = ({ navigation, route }: CheckoutScreenProps) => {
  const { orderId, tableId, tableName } = route.params;
  const { user } = useAuth();
  const token = useSessionToken();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>(null);
  const [discountIdNumber, setDiscountIdNumber] = useState("");
  const [discountName, setDiscountName] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<Id<"orderItems"> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [pendingManagerAction, setPendingManagerAction] = useState<"apply" | "remove" | null>(null);
  const [discountToRemove, setDiscountToRemove] = useState<Id<"orderDiscounts"> | null>(null);

  // Query order
  const order = useQuery(
    api.orders.get,
    token ? { token, orderId } : "skip"
  );

  // Query store for receipt details
  const store = useQuery(
    api.stores.get,
    token && order?.storeId ? { token, storeId: order.storeId } : "skip"
  );

  // Query existing discounts
  const discounts = useQuery(
    api.discounts.getOrderDiscounts,
    token ? { token, orderId } : "skip"
  );

  // Mutations
  const processCashPayment = useMutation(api.checkout.processCashPayment);
  const processCardPayment = useMutation(api.checkout.processCardPayment);
  const applyScPwdDiscount = useMutation(api.discounts.applyScPwdDiscount);
  const removeDiscount = useMutation(api.discounts.removeDiscount);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(amount);
  };

  const handleApplyDiscount = () => {
    if (!discountType) {
      Alert.alert("Error", "Please select a discount type");
      return;
    }

    if (!discountIdNumber.trim()) {
      Alert.alert("Error", "Please enter the ID number");
      return;
    }

    if (!discountName.trim()) {
      Alert.alert("Error", "Please enter the customer name");
      return;
    }

    if (!selectedItemId) {
      Alert.alert("Error", "Please select an item to apply discount");
      return;
    }

    // Show manager PIN modal
    setPendingManagerAction("apply");
    setShowManagerPinModal(true);
  };

  const handleConfirmApplyDiscount = async (managerId: Id<"users">) => {
    if (!token || !order || !discountType || !selectedItemId) return;

    try {
      await applyScPwdDiscount({
        token,
        orderId,
        orderItemId: selectedItemId,
        discountType,
        customerName: discountName.trim(),
        customerId: discountIdNumber.trim(),
        quantityApplied: 1,
        managerId,
      });
      setShowDiscountModal(false);
      setDiscountType(null);
      setDiscountIdNumber("");
      setDiscountName("");
      setSelectedItemId(null);
      Alert.alert("Success", "Discount applied successfully");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to apply discount");
    }
  };

  const handleRemoveDiscount = (discountId: Id<"orderDiscounts">) => {
    Alert.alert(
      "Remove Discount",
      "Are you sure you want to remove the discount?",
      [
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
      ]
    );
  };

  const handleConfirmRemoveDiscount = async (managerId: Id<"users">) => {
    if (!token || !discountToRemove) return;

    try {
      await removeDiscount({ token, discountId: discountToRemove, managerId });
      setDiscountToRemove(null);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to remove discount");
    }
  };

  const handleManagerPinSuccess = async (managerId: Id<"users">) => {
    setShowManagerPinModal(false);
    if (pendingManagerAction === "apply") {
      await handleConfirmApplyDiscount(managerId);
    } else if (pendingManagerAction === "remove") {
      await handleConfirmRemoveDiscount(managerId);
    }
    setPendingManagerAction(null);
  };

  const createReceiptData = (changeAmount: number, cashAmount?: number): ReceiptData => {
    const activeItems = order?.items.filter(i => !i.isVoided) ?? [];

    // Get discount info for receipt
    const discountInfo = discounts && discounts.length > 0
      ? {
          type: discounts[0].discountType === "senior_citizen" ? "sc" as const : "pwd" as const,
          description: discounts.map(d =>
            `${d.discountType === "senior_citizen" ? "SC" : "PWD"}: ${d.customerName}`
          ).join(", "),
          amount: discounts.reduce((sum, d) => sum + d.discountAmount, 0),
        }
      : undefined;

    // Combine address1 and address2 for full store address
    const storeAddress = store
      ? [store.address1, store.address2].filter(Boolean).join(", ")
      : undefined;

    return {
      storeName: store?.name ?? "Store",
      storeAddress,
      storeTin: store?.tin,
      orderNumber: order?.orderNumber ?? "",
      tableName,
      orderType: order?.orderType as "dine_in" | "take_out" | "delivery" ?? "dine_in",
      cashierName: user?.name ?? "Cashier",
      items: activeItems.map(item => ({
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
  };

  const handlePrintReceipt = async (changeAmount: number, cashAmount?: number) => {
    try {
      const receiptData = createReceiptData(changeAmount, cashAmount);
      await printReceipt(receiptData);
    } catch (error: any) {
      Alert.alert("Print Error", error.message || "Failed to print receipt");
    }
  };

  const handleShareReceipt = async (changeAmount: number, cashAmount?: number) => {
    try {
      const receiptData = createReceiptData(changeAmount, cashAmount);
      await shareReceipt(receiptData);
    } catch (error: any) {
      Alert.alert("Share Error", error.message || "Failed to share receipt");
    }
  };

  const handleProcessPayment = async () => {
    if (!token || !order) return;

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
      let change = 0;

      if (paymentMethod === "cash") {
        const result = await processCashPayment({
          token,
          orderId,
          cashReceived: cashAmount,
        });
        change = result.changeGiven;
      } else {
        await processCardPayment({
          token,
          orderId,
        });
      }

      const showReceiptOptions = () => {
        Alert.alert(
          "Payment Successful",
          paymentMethod === "cash"
            ? `Change: ${formatCurrency(change)}`
            : "Payment processed successfully",
          [
            {
              text: "Print Receipt",
              onPress: async () => {
                await handlePrintReceipt(change, paymentMethod === "cash" ? cashAmount : undefined);
                navigation.reset({
                  index: 0,
                  routes: [{ name: "TablesScreen" }],
                });
              },
            },
            {
              text: "Share Receipt",
              onPress: async () => {
                await handleShareReceipt(change, paymentMethod === "cash" ? cashAmount : undefined);
                navigation.reset({
                  index: 0,
                  routes: [{ name: "TablesScreen" }],
                });
              },
            },
            {
              text: "Skip",
              style: "cancel",
              onPress: () => {
                navigation.reset({
                  index: 0,
                  routes: [{ name: "TablesScreen" }],
                });
              },
            },
          ]
        );
      };

      showReceiptOptions();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Payment failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = () => {
    navigation.goBack();
  };

  const change = paymentMethod === "cash" && cashReceived
    ? Math.max(0, parseFloat(cashReceived) - (order?.netSales || 0))
    : 0;

  const activeItems = order?.items.filter(i => !i.isVoided) ?? [];
  const totalDiscountAmount = discounts?.reduce((sum, d) => sum + d.discountAmount, 0) ?? 0;

  if (!token || !order) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0D87E1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Checkout</Text>
          <Text style={styles.headerSubtitle}>
            {tableName ?? `Order #${order.orderNumber}`}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        {/* Order Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <View style={styles.card}>
            {activeItems.map((item) => (
              <View key={item._id} style={styles.summaryItem}>
                <Text style={styles.summaryItemName}>
                  {item.quantity}x {item.productName}
                </Text>
                <Text style={styles.summaryItemPrice}>
                  {formatCurrency(item.lineTotal)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Discount Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Discounts</Text>
          </View>
          <View style={styles.card}>
            {discounts && discounts.length > 0 ? (
              discounts.map((discount) => (
                <View key={discount._id} style={styles.appliedDiscount}>
                  <View style={styles.discountInfo}>
                    <View style={styles.discountBadge}>
                      <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                      <Text style={styles.discountBadgeText}>
                        {discount.discountType === "senior_citizen" ? "SC" : "PWD"}: {discount.customerName}
                      </Text>
                    </View>
                    {discount.itemName && (
                      <Text style={styles.discountItemText}>
                        Applied to: {discount.itemName}
                      </Text>
                    )}
                  </View>
                  <View style={styles.discountActions}>
                    <Text style={styles.discountAmount}>
                      -{formatCurrency(discount.discountAmount)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleRemoveDiscount(discount._id)}
                      style={styles.removeDiscountButton}
                    >
                      <Ionicons name="close-circle" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            ) : (
              <TouchableOpacity
                style={styles.addDiscountButton}
                onPress={() => setShowDiscountModal(true)}
              >
                <Ionicons name="pricetag-outline" size={20} color="#0D87E1" />
                <Text style={styles.addDiscountText}>Add SC/PWD Discount</Text>
              </TouchableOpacity>
            )}
            {discounts && discounts.length > 0 && (
              <TouchableOpacity
                style={[styles.addDiscountButton, styles.addMoreDiscountButton]}
                onPress={() => setShowDiscountModal(true)}
              >
                <Ionicons name="add" size={20} color="#0D87E1" />
                <Text style={styles.addDiscountText}>Add Another Discount</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Payment Method */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          <View style={styles.paymentMethods}>
            <TouchableOpacity
              style={[
                styles.paymentOption,
                paymentMethod === "cash" && styles.paymentOptionActive,
              ]}
              onPress={() => setPaymentMethod("cash")}
            >
              <Ionicons
                name="cash-outline"
                size={24}
                color={paymentMethod === "cash" ? "#0D87E1" : "#6B7280"}
              />
              <Text
                style={[
                  styles.paymentOptionText,
                  paymentMethod === "cash" && styles.paymentOptionTextActive,
                ]}
              >
                Cash
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.paymentOption,
                paymentMethod === "card_ewallet" && styles.paymentOptionActive,
              ]}
              onPress={() => setPaymentMethod("card_ewallet")}
            >
              <Ionicons
                name="card-outline"
                size={24}
                color={paymentMethod === "card_ewallet" ? "#0D87E1" : "#6B7280"}
              />
              <Text
                style={[
                  styles.paymentOptionText,
                  paymentMethod === "card_ewallet" && styles.paymentOptionTextActive,
                ]}
              >
                Card/E-Wallet
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Cash Input */}
        {paymentMethod === "cash" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cash Received</Text>
            <View style={styles.cashInputContainer}>
              <Text style={styles.currencySymbol}>₱</Text>
              <TextInput
                style={styles.cashInput}
                placeholder="0.00"
                value={cashReceived}
                onChangeText={setCashReceived}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.quickAmounts}>
              {[100, 200, 500, 1000, 2000].map((amount) => (
                <TouchableOpacity
                  key={amount}
                  style={styles.quickAmountButton}
                  onPress={() => setCashReceived(amount.toString())}
                >
                  <Text style={styles.quickAmountText}>{amount}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Totals */}
        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Gross Sales</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(order.grossSales)}
              </Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>VAT (12%)</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(order.vatAmount)}
              </Text>
            </View>
            {order.discountAmount > 0 && (
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: "#22C55E" }]}>
                  Discount
                </Text>
                <Text style={[styles.totalValue, { color: "#22C55E" }]}>
                  -{formatCurrency(order.discountAmount)}
                </Text>
              </View>
            )}
            <View style={[styles.totalRow, styles.grandTotalRow]}>
              <Text style={styles.grandTotalLabel}>Total Due</Text>
              <Text style={styles.grandTotalValue}>
                {formatCurrency(order.netSales)}
              </Text>
            </View>
            {paymentMethod === "cash" && cashReceived && (
              <View style={styles.totalRow}>
                <Text style={styles.changeLabel}>Change</Text>
                <Text style={styles.changeValue}>{formatCurrency(change)}</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.payButton, isProcessing && styles.payButtonDisabled]}
          onPress={handleProcessPayment}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={24} color="#FFF" />
              <Text style={styles.payButtonText}>
                Complete Payment - {formatCurrency(order.netSales)}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Discount Modal */}
      <Modal
        visible={showDiscountModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDiscountModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Apply SC/PWD Discount</Text>
              <TouchableOpacity onPress={() => setShowDiscountModal(false)}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Discount Type</Text>
            <View style={styles.discountTypes}>
              <TouchableOpacity
                style={[
                  styles.discountTypeButton,
                  discountType === "senior_citizen" && styles.discountTypeActive,
                ]}
                onPress={() => setDiscountType("senior_citizen")}
              >
                <Text
                  style={[
                    styles.discountTypeText,
                    discountType === "senior_citizen" && styles.discountTypeTextActive,
                  ]}
                >
                  Senior Citizen
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.discountTypeButton,
                  discountType === "pwd" && styles.discountTypeActive,
                ]}
                onPress={() => setDiscountType("pwd")}
              >
                <Text
                  style={[
                    styles.discountTypeText,
                    discountType === "pwd" && styles.discountTypeTextActive,
                  ]}
                >
                  PWD
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Select Item</Text>
            <ScrollView style={styles.itemList} horizontal={false}>
              {activeItems.filter(item => {
                // Filter out items that already have discounts
                const hasDiscount = discounts?.some(d => d.orderItemId === item._id);
                return !hasDiscount;
              }).map((item) => (
                <TouchableOpacity
                  key={item._id}
                  style={[
                    styles.itemOption,
                    selectedItemId === item._id && styles.itemOptionActive,
                  ]}
                  onPress={() => setSelectedItemId(item._id)}
                >
                  <Text style={styles.itemOptionText}>
                    {item.quantity}x {item.productName}
                  </Text>
                  <Text style={styles.itemOptionPrice}>
                    {formatCurrency(item.lineTotal)}
                  </Text>
                  {selectedItemId === item._id && (
                    <Ionicons name="checkmark-circle" size={20} color="#0D87E1" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.modalLabel}>ID Number</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter SC/PWD ID number"
              value={discountIdNumber}
              onChangeText={setDiscountIdNumber}
            />

            <Text style={styles.modalLabel}>Customer Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter customer name"
              value={discountName}
              onChangeText={setDiscountName}
            />

            <Text style={styles.modalHint}>
              BIR rule: 20% discount applies only to items consumed by SC/PWD
            </Text>

            <TouchableOpacity
              style={[
                styles.modalApplyButton,
                (!discountType || !discountIdNumber || !discountName || !selectedItemId) &&
                  styles.modalApplyButtonDisabled,
              ]}
              onPress={handleApplyDiscount}
              disabled={!discountType || !discountIdNumber || !discountName || !selectedItemId}
            >
              <Text style={styles.modalApplyButtonText}>Apply Discount</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Manager PIN Modal */}
      <ManagerPinModal
        visible={showManagerPinModal}
        onClose={() => {
          setShowManagerPinModal(false);
          setPendingManagerAction(null);
        }}
        onSuccess={handleManagerPinSuccess}
        title={pendingManagerAction === "apply" ? "Approve Discount" : "Approve Removal"}
        description="Manager PIN required to proceed"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: RFValue(16),
    fontFamily: "SemiBold",
    color: "#111827",
  },
  headerSubtitle: {
    fontSize: RFValue(12),
    fontFamily: "Regular",
    color: "#6B7280",
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: RFValue(14),
    fontFamily: "SemiBold",
    color: "#111827",
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  summaryItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  summaryItemName: {
    fontFamily: "Regular",
    fontSize: RFValue(12),
    color: "#374151",
    flex: 1,
  },
  summaryItemPrice: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#111827",
  },
  appliedDiscount: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  discountInfo: {
    flex: 1,
  },
  discountBadge: {
    flexDirection: "row",
    alignItems: "center",
  },
  discountBadgeText: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#22C55E",
    marginLeft: 8,
  },
  discountItemText: {
    fontFamily: "Regular",
    fontSize: RFValue(10),
    color: "#6B7280",
    marginLeft: 28,
  },
  discountActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  discountAmount: {
    fontFamily: "SemiBold",
    fontSize: RFValue(12),
    color: "#22C55E",
    marginRight: 8,
  },
  removeDiscountButton: {
    padding: 4,
  },
  addDiscountButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  addMoreDiscountButton: {
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    marginTop: 8,
    paddingTop: 16,
  },
  addDiscountText: {
    fontFamily: "Medium",
    fontSize: RFValue(13),
    color: "#0D87E1",
    marginLeft: 8,
  },
  paymentMethods: {
    flexDirection: "row",
    gap: 12,
  },
  paymentOption: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#E5E7EB",
  },
  paymentOptionActive: {
    borderColor: "#0D87E1",
    backgroundColor: "#EFF6FF",
  },
  paymentOptionText: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#6B7280",
    marginTop: 8,
  },
  paymentOptionTextActive: {
    color: "#0D87E1",
  },
  cashInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  currencySymbol: {
    fontFamily: "SemiBold",
    fontSize: RFValue(24),
    color: "#6B7280",
  },
  cashInput: {
    flex: 1,
    padding: 16,
    fontFamily: "SemiBold",
    fontSize: RFValue(24),
    color: "#111827",
  },
  quickAmounts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  quickAmountButton: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  quickAmountText: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#374151",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  totalLabel: {
    fontFamily: "Regular",
    fontSize: RFValue(12),
    color: "#6B7280",
  },
  totalValue: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#111827",
  },
  grandTotalRow: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    marginTop: 8,
    paddingTop: 12,
  },
  grandTotalLabel: {
    fontFamily: "SemiBold",
    fontSize: RFValue(16),
    color: "#111827",
  },
  grandTotalValue: {
    fontFamily: "Bold",
    fontSize: RFValue(20),
    color: "#0D87E1",
  },
  changeLabel: {
    fontFamily: "Medium",
    fontSize: RFValue(14),
    color: "#22C55E",
  },
  changeValue: {
    fontFamily: "Bold",
    fontSize: RFValue(16),
    color: "#22C55E",
  },
  footer: {
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  payButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#22C55E",
    padding: 16,
    borderRadius: 12,
  },
  payButtonDisabled: {
    backgroundColor: "#D1D5DB",
  },
  payButtonText: {
    fontFamily: "SemiBold",
    fontSize: RFValue(14),
    color: "#FFFFFF",
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontFamily: "SemiBold",
    fontSize: RFValue(16),
    color: "#111827",
  },
  modalLabel: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#374151",
    marginBottom: 8,
    marginTop: 12,
  },
  discountTypes: {
    flexDirection: "row",
    gap: 12,
  },
  discountTypeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
  },
  discountTypeActive: {
    backgroundColor: "#0D87E1",
  },
  discountTypeText: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#6B7280",
  },
  discountTypeTextActive: {
    color: "#FFFFFF",
  },
  itemList: {
    maxHeight: 120,
  },
  itemOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    marginBottom: 8,
  },
  itemOptionActive: {
    borderColor: "#0D87E1",
    backgroundColor: "#EFF6FF",
  },
  itemOptionText: {
    flex: 1,
    fontFamily: "Regular",
    fontSize: RFValue(12),
    color: "#374151",
  },
  itemOptionPrice: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#111827",
    marginRight: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    padding: 12,
    fontFamily: "Regular",
    fontSize: RFValue(13),
  },
  modalHint: {
    fontFamily: "Regular",
    fontSize: RFValue(10),
    color: "#9CA3AF",
    marginTop: 12,
  },
  modalApplyButton: {
    backgroundColor: "#0D87E1",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 20,
  },
  modalApplyButtonDisabled: {
    backgroundColor: "#D1D5DB",
  },
  modalApplyButtonText: {
    fontFamily: "SemiBold",
    fontSize: RFValue(14),
    color: "#FFFFFF",
  },
});

export default CheckoutScreen;
