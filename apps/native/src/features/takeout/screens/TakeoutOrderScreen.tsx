import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActivityIndicator, Alert, FlatList, TextInput, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import type { SelectedModifier } from "../../orders/components";
import {
  AddItemModal,
  CartItem,
  CategoryGrid,
  ModifierSelectionModal,
  VoidItemModal,
} from "../../orders/components";
import type { KitchenTicketData } from "../../settings/services/escposFormatter";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { PageHeader } from "../../shared/components/PageHeader";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface TakeoutOrderScreenProps {
  navigation: any;
  route: {
    params: {
      storeId: Id<"stores">;
      orderId: Id<"orders">;
    };
  };
}

interface SelectedProduct {
  id: Id<"products">;
  name: string;
  price: number;
  hasModifiers: boolean;
  isOpenPrice: boolean;
  minPrice?: number;
  maxPrice?: number;
}

export const TakeoutOrderScreen = ({ navigation, route }: TakeoutOrderScreenProps) => {
  const { storeId, orderId } = route.params;
  const { isLoading, isAuthenticated } = useAuth();

  // Customer name local state (synced to backend on blur)
  const [customerName, setCustomerName] = useState("");
  const [orderCategory, setOrderCategory] = useState<"dine_in" | "takeout">("takeout");
  const [tableMarker, setTableMarker] = useState("");

  // Shared UI state
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const addItemLockRef = useRef(false);
  const checkoutLockRef = useRef(false);
  const cancelOrderLockRef = useRef(false);

  // Modal state
  const [voidingItem, setVoidingItem] = useState<{
    id: Id<"orderItems">;
    name: string;
    quantity: number;
  } | null>(null);

  // Queries
  const order = useQuery(api.orders.get, { orderId });
  const products = useQuery(api.products.list, { storeId });

  // Prefetch all modifier data for the store — available instantly on product tap
  const allModifiers = useQuery(api.modifierAssignments.getForStore, { storeId });
  const modifiersByProduct = useMemo(() => {
    const map = new Map<string, NonNullable<typeof allModifiers>[number]["groups"]>();
    if (allModifiers) {
      for (const entry of allModifiers) {
        map.set(entry.productId, entry.groups);
      }
    }
    return map;
  }, [allModifiers]);

  const modifierGroups = selectedProduct ? (modifiersByProduct.get(selectedProduct.id) ?? []) : [];

  // Mutations
  const addItemMutation = useMutation(api.orders.addItem);
  const updateItemQuantity = useMutation(api.orders.updateItemQuantity);
  const removeItemMutation = useMutation(api.orders.removeItem);
  const cancelOrderMutation = useMutation(api.checkout.cancelOrder);
  const discardDraftMutation = useMutation(api.orders.discardDraft);
  const submitDraftMutation = useMutation(api.orders.submitDraft);
  const updateCustomerNameMutation = useMutation(api.orders.updateCustomerName);
  const updateItemServiceTypeMutation = useMutation(api.orders.updateItemServiceType);
  const sendToKitchenMutation = useMutation(api.orders.sendToKitchenWithoutPayment);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      checkoutLockRef.current = false;
      setIsSending(false);
    });

    return unsubscribe;
  }, [navigation]);

  // Sync customer name from backend when order loads
  useEffect(() => {
    if (order?.customerName !== undefined) {
      setCustomerName(order.customerName ?? "");
    }
  }, [order?.customerName]);

  const handleCustomerNameBlur = useCallback(() => {
    updateCustomerNameMutation({
      orderId,
      customerName: customerName.trim() || undefined,
    });
  }, [orderId, customerName, updateCustomerNameMutation]);

  const handleCategoryChange = useCallback(
    async (category: "dine_in" | "takeout") => {
      setOrderCategory(category);
      if (orderId) {
        await updateCustomerNameMutation({
          orderId,
          orderCategory: category,
        });
      }
    },
    [orderId, updateCustomerNameMutation],
  );

  const handleServiceTypeChange = useCallback(
    async (itemId: Id<"orderItems">, serviceType: "dine_in" | "takeout") => {
      try {
        await updateItemServiceTypeMutation({ orderItemId: itemId, serviceType });
      } catch (error) {
        console.error("Failed to update service type:", error);
      }
    },
    [updateItemServiceTypeMutation],
  );

  const handleTableMarkerBlur = useCallback(async () => {
    if (orderId) {
      await updateCustomerNameMutation({
        orderId,
        tableMarker: tableMarker || undefined,
      });
    }
  }, [orderId, tableMarker, updateCustomerNameMutation]);

  // Set default category on screen load
  useEffect(() => {
    if (orderId) {
      updateCustomerNameMutation({ orderId, orderCategory: "takeout" });
    }
  }, [orderId]);

  // Cart data — always derived from order
  const activeItems = useMemo(() => {
    return order?.items.filter((i) => !i.isVoided) ?? [];
  }, [order]);

  const cartTotal = useMemo(
    () => activeItems.reduce((sum, item) => sum + item.lineTotal, 0),
    [activeItems],
  );
  const cartItemCount = useMemo(
    () => activeItems.reduce((sum, item) => sum + item.quantity, 0),
    [activeItems],
  );
  const hasItems = activeItems.length > 0;
  const isOpenTakeout =
    (order?.status === "open" || order?.status === "draft") && order?.orderType === "takeout";
  const isAdvanceOrder =
    isOpenTakeout &&
    (order?.takeoutStatus === "preparing" || order?.takeoutStatus === "ready_for_pickup");
  const hasUnsentItems = useMemo(() => activeItems.some((i) => !i.isSentToKitchen), [activeItems]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleCancelOrder = useCallback(() => {
    if (cancelOrderLockRef.current) return;

    const isDraftOrder = order?.status === "draft";

    Alert.alert(
      isDraftOrder ? "Discard Draft" : "Cancel Order",
      isDraftOrder
        ? "If you just need to take another customer's order, tap Keep Draft and go back. Only discard this draft if you're sure you no longer need this cart."
        : "Are you sure you want to cancel this order? All items will be removed.",
      [
        {
          text: isDraftOrder ? "Keep Draft" : "No",
          style: "cancel",
          onPress: isDraftOrder ? () => navigation.goBack() : undefined,
        },
        {
          text: isDraftOrder ? "Yes, Discard" : "Yes, Cancel",
          style: "destructive",
          onPress: async () => {
            if (cancelOrderLockRef.current) return;

            cancelOrderLockRef.current = true;
            setIsCancelling(true);
            try {
              if (isDraftOrder) {
                await discardDraftMutation({ orderId });
              } else {
                await cancelOrderMutation({ orderId });
              }
              navigation.goBack();
            } catch (error: any) {
              Alert.alert(
                "Error",
                error.message ||
                  (isDraftOrder ? "Failed to discard draft" : "Failed to cancel order"),
              );
            } finally {
              cancelOrderLockRef.current = false;
              setIsCancelling(false);
            }
          },
        },
      ],
    );
  }, [cancelOrderMutation, discardDraftMutation, navigation, order?.status, orderId]);

  const handleAddProduct = useCallback((product: SelectedProduct) => {
    setSelectedProduct(product);
    setQuantity(1);
    setNotes("");
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedProduct(null);
  }, []);

  const handleConfirmAdd = useCallback(
    async (customPrice?: number) => {
      if (!selectedProduct || addItemLockRef.current) return;

      addItemLockRef.current = true;
      setIsAddingItem(true);
      try {
        await addItemMutation({
          orderId,
          productId: selectedProduct.id,
          quantity,
          notes: notes || undefined,
          ...(selectedProduct.isOpenPrice && customPrice !== undefined ? { customPrice } : {}),
        });
        setSelectedProduct(null);
      } catch (error) {
        console.error("Add item error:", error);
        Alert.alert("Error", "Failed to add item to order");
      } finally {
        addItemLockRef.current = false;
        setIsAddingItem(false);
      }
    },
    [selectedProduct, orderId, quantity, notes, addItemMutation],
  );

  const handleConfirmModifiers = useCallback(
    async (qty: number, itemNotes: string, modifiers: SelectedModifier[], customPrice?: number) => {
      if (!selectedProduct || addItemLockRef.current) return;

      addItemLockRef.current = true;
      setIsAddingItem(true);
      try {
        await addItemMutation({
          orderId,
          productId: selectedProduct.id,
          quantity: qty,
          notes: itemNotes || undefined,
          modifiers,
          ...(selectedProduct.isOpenPrice && customPrice !== undefined ? { customPrice } : {}),
        });
        setSelectedProduct(null);
      } catch (error) {
        console.error("Add item error:", error);
        Alert.alert("Error", "Failed to add item to order");
      } finally {
        addItemLockRef.current = false;
        setIsAddingItem(false);
      }
    },
    [selectedProduct, orderId, addItemMutation],
  );

  const handleIncrement = useCallback(
    async (itemId: Id<"orderItems">, currentQty: number) => {
      try {
        await updateItemQuantity({ orderItemId: itemId, quantity: currentQty + 1 });
      } catch (error) {
        console.error("Update quantity error:", error);
        Alert.alert("Error", "Failed to update quantity");
      }
    },
    [updateItemQuantity],
  );

  const handleDecrement = useCallback(
    async (itemId: Id<"orderItems">, currentQty: number) => {
      if (currentQty <= 1) {
        Alert.alert("Remove Item", "Are you sure you want to remove this item?", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                await removeItemMutation({ orderItemId: itemId });
              } catch (error) {
                console.error("Remove item error:", error);
                Alert.alert("Error", "Failed to remove item");
              }
            },
          },
        ]);
        return;
      }

      try {
        await updateItemQuantity({ orderItemId: itemId, quantity: currentQty - 1 });
      } catch (error) {
        console.error("Update quantity error:", error);
        Alert.alert("Error", "Failed to update quantity");
      }
    },
    [updateItemQuantity, removeItemMutation],
  );

  const handleVoidItem = useCallback(
    (itemId: Id<"orderItems">) => {
      const item = activeItems.find((i) => i._id === itemId);
      if (!item) return;
      setVoidingItem({ id: itemId, name: item.productName, quantity: item.quantity });
    },
    [activeItems],
  );

  const handleConfirmVoid = useCallback(
    async (reason: string) => {
      if (!voidingItem) return;
      try {
        await removeItemMutation({ orderItemId: voidingItem.id, voidReason: reason });
      } catch (error: any) {
        Alert.alert("Error", error.message || "Failed to void item");
      }
      setVoidingItem(null);
    },
    [voidingItem, removeItemMutation],
  );

  const handleCheckout = useCallback(async () => {
    if (checkoutLockRef.current) return;

    const items = order?.items.filter((i) => !i.isVoided) ?? [];
    if (items.length === 0) {
      Alert.alert("No Items", "Please add items before proceeding to payment.");
      return;
    }

    checkoutLockRef.current = true;
    setIsSending(true);
    let shouldReleaseLock = true;
    try {
      if (order?.status === "draft") {
        await submitDraftMutation({ orderId });
      }

      navigation.navigate("CheckoutScreen", {
        orderId,
        orderType: "takeout",
        orderCategory,
        tableMarker: tableMarker || undefined,
      });
      shouldReleaseLock = false;
    } catch (error: any) {
      console.error("Checkout error:", error);
      Alert.alert("Error", error.message || "Failed to proceed to payment");
    } finally {
      if (shouldReleaseLock) {
        checkoutLockRef.current = false;
        setIsSending(false);
      }
    }
  }, [order, orderId, submitDraftMutation, navigation]);

  // Send new items to kitchen (first-time or running bill)
  const handleSendToKitchen = useCallback(async () => {
    if (!order || !hasUnsentItems || isSending) return;

    setIsSending(true);
    try {
      // Submit draft first if needed
      if (order.status === "draft") {
        await submitDraftMutation({ orderId });
      }

      await sendToKitchenMutation({
        orderId,
        storeId,
      });

      // Print kitchen ticket with only the newly sent items
      const unsentItems = activeItems.filter((i) => !i.isSentToKitchen);
      if (order.orderNumber && unsentItems.length > 0) {
        const kitchenData: KitchenTicketData = {
          orderNumber: order.orderNumber,
          orderType: "take_out",
          tableMarker: order.tableMarker,
          customerName: order.customerName,
          orderCategory: order.orderCategory,
          orderDefaultServiceType: "takeout",
          items: unsentItems.map((i) => ({
            name: i.productName,
            quantity: i.quantity,
            notes: i.notes,
            serviceType: i.serviceType ?? "takeout",
            modifiers: i.modifiers?.map((m) => ({
              optionName: m.optionName,
              priceAdjustment: m.priceAdjustment,
            })),
          })),
          timestamp: new Date(),
        };

        const { kitchenPrintingEnabled, printKitchenTicket } = usePrinterStore.getState();
        if (!kitchenPrintingEnabled) {
          Alert.alert(
            "Kitchen Printing Disabled",
            "Kitchen printing is turned off. Enable it in Settings > Printer to auto-print kitchen receipts.",
          );
        } else {
          try {
            await printKitchenTicket(kitchenData);
          } catch (printErr) {
            console.log("Kitchen print error (non-blocking):", printErr);
          }
        }
      }

      Alert.alert("Sent", "New items sent to kitchen", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to send to kitchen");
    } finally {
      setIsSending(false);
    }
  }, [
    order,
    orderId,
    storeId,
    hasUnsentItems,
    isSending,
    submitDraftMutation,
    sendToKitchenMutation,
    activeItems,
    navigation,
  ]);

  // Reprint full kitchen receipt (all items)
  const handleReprintKitchenReceipt = useCallback(async () => {
    if (!order?.orderNumber || activeItems.length === 0 || isSending) return;

    setIsSending(true);
    try {
      const kitchenData: KitchenTicketData = {
        orderNumber: order.orderNumber,
        orderType: "take_out",
        tableMarker: order.tableMarker,
        customerName: order.customerName,
        orderCategory: order.orderCategory,
        orderDefaultServiceType: "takeout",
        items: activeItems.map((i) => ({
          name: i.productName,
          quantity: i.quantity,
          notes: i.notes,
          serviceType: i.serviceType ?? "takeout",
          modifiers: i.modifiers?.map((m) => ({
            optionName: m.optionName,
            priceAdjustment: m.priceAdjustment,
          })),
        })),
        timestamp: new Date(),
      };

      const { kitchenPrintingEnabled, printKitchenTicket } = usePrinterStore.getState();
      if (!kitchenPrintingEnabled) {
        Alert.alert(
          "Kitchen Printing Disabled",
          "Kitchen printing is turned off. Enable it in Settings > Printer to auto-print kitchen receipts.",
        );
      } else {
        await printKitchenTicket(kitchenData);
      }
    } catch (printErr) {
      console.log("Kitchen reprint error:", printErr);
      Alert.alert("Error", "Failed to print kitchen receipt");
    } finally {
      setIsSending(false);
    }
  }, [order, activeItems, isSending]);

  const formatCurrency = useFormatCurrency();

  if (isLoading || !isAuthenticated) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#F8FAFC">
        <YStack
          backgroundColor="#FFFFFF"
          padding={32}
          borderRadius={16}
          alignItems="center"
          shadowColor="#000"
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.08}
          shadowRadius={12}
          elevation={3}
        >
          <ActivityIndicator size="large" color="#F97316" />
          <Text variant="muted" size="sm" style={{ marginTop: 12 }}>
            Loading...
          </Text>
        </YStack>
      </YStack>
    );
  }

  return (
    <YStack flex={1} backgroundColor="#F1F5F9">
      <PageHeader
        onBack={handleBack}
        titleContent={
          <YStack width="100%">
            <XStack alignItems="center" gap={10}>
              <Text variant="heading" size="xl" numberOfLines={1}>
                {customerName.trim() || "Takeout Order"}
              </Text>
              <YStack
                backgroundColor="#FFF7ED"
                borderRadius={999}
                paddingHorizontal={10}
                paddingVertical={4}
                borderWidth={1}
                borderColor="#FDBA74"
              >
                <Text
                  numberOfLines={1}
                  style={{ color: "#EA580C", fontWeight: "700", fontSize: 12 }}
                >
                  Takeout
                </Text>
              </YStack>
            </XStack>
            <Text variant="muted" size="sm" style={{ marginTop: 2 }} numberOfLines={1}>
              {order?.status === "draft" ? "Draft order" : "Order in progress"}
            </Text>
          </YStack>
        }
      />

      <XStack flex={1}>
        {/* Menu Section */}
        <YStack flex={2} borderRightWidth={1} borderRightColor="#E2E8F0">
          {/* Customer Name Input - Always visible for takeout orders */}
          <YStack
            backgroundColor="#FFFFFF"
            borderBottomWidth={1}
            borderBottomColor="#E2E8F0"
            paddingBottom={12}
          >
            {/* Order Category Toggle */}
            <XStack gap={10} paddingHorizontal={16} paddingTop={12}>
              <TouchableOpacity
                onPress={() => handleCategoryChange("dine_in")}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: orderCategory === "dine_in" ? "#F97316" : "#F3F4F6",
                  borderWidth: orderCategory === "dine_in" ? 0 : 1.5,
                  borderColor: "#E5E7EB",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  shadowColor: orderCategory === "dine_in" ? "#F97316" : "transparent",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 4,
                  elevation: orderCategory === "dine_in" ? 3 : 0,
                }}
              >
                <Ionicons
                  name="restaurant-outline"
                  size={20}
                  color={orderCategory === "dine_in" ? "#FFFFFF" : "#6B7280"}
                />
                <Text
                  style={{
                    fontWeight: "700",
                    fontSize: 16,
                    color: orderCategory === "dine_in" ? "#FFFFFF" : "#6B7280",
                  }}
                >
                  Dine-in
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleCategoryChange("takeout")}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: orderCategory === "takeout" ? "#F97316" : "#F3F4F6",
                  borderWidth: orderCategory === "takeout" ? 0 : 1.5,
                  borderColor: "#E5E7EB",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  shadowColor: orderCategory === "takeout" ? "#F97316" : "transparent",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 4,
                  elevation: orderCategory === "takeout" ? 3 : 0,
                }}
              >
                <Ionicons
                  name="bag-handle-outline"
                  size={20}
                  color={orderCategory === "takeout" ? "#FFFFFF" : "#6B7280"}
                />
                <Text
                  style={{
                    fontWeight: "700",
                    fontSize: 16,
                    color: orderCategory === "takeout" ? "#FFFFFF" : "#6B7280",
                  }}
                >
                  Takeout
                </Text>
              </TouchableOpacity>
            </XStack>

            {/* Table Marker + Customer Name Row */}
            <XStack gap={10} paddingHorizontal={16} paddingTop={10}>
              {/* Table Marker — prominent input */}
              <YStack flex={0} width={120}>
                <Text
                  style={{ fontSize: 13, fontWeight: "700", color: "#EA580C", marginBottom: 6 }}
                >
                  Table Marker
                </Text>
                <TextInput
                  value={tableMarker}
                  onChangeText={setTableMarker}
                  onBlur={handleTableMarkerBlur}
                  placeholder="e.g. 15"
                  placeholderTextColor="#C2956B"
                  style={{
                    backgroundColor: "#FFF7ED",
                    borderWidth: 2,
                    borderColor: "#F97316",
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 52,
                    fontSize: 20,
                    fontWeight: "700",
                    textAlign: "center",
                    color: "#9A3412",
                  }}
                />
              </YStack>

              {/* Customer Name — flex fill */}
              <YStack flex={1}>
                <Text
                  style={{ fontSize: 13, fontWeight: "700", color: "#EA580C", marginBottom: 6 }}
                >
                  Customer Name
                </Text>
                <TextInput
                  placeholder="Enter customer name (optional)"
                  value={customerName}
                  onChangeText={setCustomerName}
                  onBlur={handleCustomerNameBlur}
                  placeholderTextColor="#C2956B"
                  style={{
                    backgroundColor: "#FFF7ED",
                    borderWidth: 2,
                    borderColor: "#F97316",
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 52,
                    fontSize: 16,
                    fontWeight: "600",
                    color: "#9A3412",
                  }}
                />
              </YStack>
            </XStack>
          </YStack>

          <CategoryGrid storeId={storeId} products={products} onSelectProduct={handleAddProduct} />
        </YStack>

        {/* Cart Section - Enhanced */}
        <YStack
          flex={1}
          backgroundColor="#FFFFFF"
          shadowColor="#000"
          shadowOffset={{ width: -2, height: 0 }}
          shadowOpacity={0.03}
          shadowRadius={8}
          elevation={1}
        >
          {/* Cart Header */}
          <YStack
            paddingHorizontal={16}
            paddingVertical={14}
            borderBottomWidth={1}
            borderBottomColor="#E2E8F0"
            backgroundColor="#FAFAFA"
          >
            <XStack justifyContent="space-between" alignItems="center">
              <XStack alignItems="center">
                <YStack backgroundColor="#FFF7ED" borderRadius={8} padding={8} marginRight={10}>
                  <Ionicons name="cart" size={18} color="#EA580C" />
                </YStack>
                <YStack>
                  <Text variant="heading" size="base">
                    Order Items
                  </Text>
                  <Text variant="muted" size="xs">
                    {cartItemCount} {cartItemCount === 1 ? "item" : "items"}
                  </Text>
                </YStack>
              </XStack>
              <YStack
                backgroundColor="#F97316"
                borderRadius={20}
                paddingHorizontal={14}
                paddingVertical={6}
                shadowColor="#F97316"
                shadowOffset={{ width: 0, height: 2 }}
                shadowOpacity={0.3}
                shadowRadius={4}
                elevation={2}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 }}>
                  {formatCurrency(cartTotal)}
                </Text>
              </YStack>
            </XStack>
          </YStack>

          {/* Cart Items List */}
          <FlatList
            data={activeItems}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{ flexGrow: 1 }}
            renderItem={({ item }) => (
              <CartItem
                id={item._id}
                productName={item.productName}
                productPrice={item.productPrice}
                quantity={item.quantity}
                lineTotal={item.lineTotal}
                notes={item.notes}
                modifiers={item.modifiers}
                isSentToKitchen={item.isSentToKitchen}
                serviceType={item.serviceType}
                orderDefaultServiceType={orderCategory}
                onServiceTypeChange={handleServiceTypeChange}
                onIncrement={handleIncrement}
                onDecrement={handleDecrement}
                onVoidItem={item.isSentToKitchen ? handleVoidItem : undefined}
              />
            )}
            ListEmptyComponent={
              <YStack flex={1} alignItems="center" justifyContent="center" paddingVertical={48}>
                <YStack
                  backgroundColor="#FFF7ED"
                  borderRadius={24}
                  padding={24}
                  marginBottom={16}
                  borderWidth={2}
                  borderColor="#FDBA74"
                  borderStyle="dashed"
                >
                  <Ionicons name="bag-add-outline" size={48} color="#F97316" />
                </YStack>
                <Text variant="heading" size="base" style={{ marginBottom: 4 }}>
                  No items yet
                </Text>
                <Text
                  variant="muted"
                  size="sm"
                  style={{ textAlign: "center", paddingHorizontal: 24 }}
                >
                  Tap products from the menu to add them to this takeout order
                </Text>
              </YStack>
            }
          />

          {/* Enhanced Footer */}
          <YStack
            paddingHorizontal={16}
            paddingVertical={16}
            borderTopWidth={1}
            borderTopColor="#E2E8F0"
            backgroundColor="#FAFAFA"
          >
            {/* Order Summary */}
            <YStack
              backgroundColor="#FFFFFF"
              borderRadius={12}
              padding={14}
              marginBottom={14}
              borderWidth={1}
              borderColor="#E2E8F0"
            >
              <XStack justifyContent="space-between" alignItems="center" marginBottom={8}>
                <Text style={{ color: "#64748B", fontSize: 14 }}>Items</Text>
                <Text style={{ color: "#334155", fontWeight: "500", fontSize: 14 }}>
                  {cartItemCount}
                </Text>
              </XStack>
              <XStack justifyContent="space-between" alignItems="center">
                <Text style={{ color: "#64748B", fontSize: 14 }}>Subtotal</Text>
                <Text style={{ color: "#0F172A", fontWeight: "700", fontSize: 22 }}>
                  {formatCurrency(cartTotal)}
                </Text>
              </XStack>
            </YStack>

            {/* Action Buttons */}
            {isOpenTakeout && hasUnsentItems && (
              <TouchableOpacity
                onPress={handleSendToKitchen}
                disabled={!hasItems || isSending}
                activeOpacity={0.8}
                style={{
                  backgroundColor: hasItems && !isSending ? "#F97316" : "#CBD5E1",
                  borderRadius: 12,
                  paddingVertical: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 10,
                  shadowColor: hasItems ? "#F97316" : "transparent",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: hasItems ? 4 : 0,
                }}
              >
                <Ionicons
                  name="restaurant-outline"
                  size={22}
                  color="#FFFFFF"
                  style={{ marginRight: 10 }}
                />
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 17 }}>
                  Send to Kitchen
                </Text>
              </TouchableOpacity>
            )}
            {isAdvanceOrder && !hasUnsentItems && (
              <TouchableOpacity
                onPress={handleReprintKitchenReceipt}
                disabled={isSending}
                activeOpacity={0.7}
                style={{
                  backgroundColor: isSending ? "#9CA3AF" : "#FFF7ED",
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#FDBA74",
                  paddingVertical: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 10,
                }}
              >
                <Ionicons
                  name="print-outline"
                  size={20}
                  color={isSending ? "#FFFFFF" : "#EA580C"}
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={{
                    color: isSending ? "#FFFFFF" : "#EA580C",
                    fontWeight: "600",
                    fontSize: 15,
                  }}
                >
                  {isSending ? "Printing..." : "Reprint Kitchen Receipt"}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleCheckout}
              disabled={!hasItems || isSending}
              activeOpacity={0.8}
              style={{
                backgroundColor:
                  hasItems && !isSending
                    ? isOpenTakeout && hasUnsentItems
                      ? "#0D87E1"
                      : "#F97316"
                    : "#CBD5E1",
                borderRadius: 12,
                paddingVertical: 16,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: hasItems
                  ? isOpenTakeout && hasUnsentItems
                    ? "#0D87E1"
                    : "#F97316"
                  : "transparent",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: hasItems ? 4 : 0,
              }}
            >
              <Ionicons name="card-outline" size={22} color="#FFFFFF" style={{ marginRight: 10 }} />
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 17 }}>
                Proceed to Payment
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleCancelOrder}
              disabled={isCancelling}
              activeOpacity={0.7}
              style={{
                marginTop: 12,
                paddingVertical: 14,
                paddingHorizontal: 20,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                backgroundColor: "#FEF2F2",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#FECACA",
                opacity: isCancelling ? 0.6 : 1,
              }}
            >
              <Ionicons
                name="close-circle-outline"
                size={20}
                color="#DC2626"
                style={{ marginRight: 8 }}
              />
              <Text style={{ color: "#DC2626", fontWeight: "600", fontSize: 15 }}>
                {isCancelling ? "Cancelling..." : "Cancel Order"}
              </Text>
            </TouchableOpacity>
          </YStack>
        </YStack>
      </XStack>

      {/* Modals */}
      <ModifierSelectionModal
        visible={!!selectedProduct && allModifiers !== undefined && modifierGroups.length > 0}
        product={selectedProduct}
        modifierGroups={modifierGroups}
        isLoading={isAddingItem || isSending}
        onClose={handleCloseModal}
        onConfirm={handleConfirmModifiers}
      />
      <AddItemModal
        visible={!!selectedProduct && allModifiers !== undefined && modifierGroups.length === 0}
        product={selectedProduct}
        quantity={quantity}
        notes={notes}
        isLoading={isAddingItem || isSending}
        onClose={handleCloseModal}
        onQuantityChange={setQuantity}
        onNotesChange={setNotes}
        onConfirm={handleConfirmAdd}
      />
      <VoidItemModal
        visible={!!voidingItem}
        itemName={voidingItem?.name ?? ""}
        itemQuantity={voidingItem?.quantity ?? 0}
        onConfirm={handleConfirmVoid}
        onClose={() => setVoidingItem(null)}
      />
    </YStack>
  );
};

export default TakeoutOrderScreen;
