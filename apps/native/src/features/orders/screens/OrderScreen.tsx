import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import type { KitchenTicketData } from "../../settings/services/escposFormatter";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { Text } from "../../shared/components/ui";
import type { SelectedModifier } from "../components";
import {
  AddItemModal,
  CartFooter,
  CartItem,
  CategoryGrid,
  EditTabNameModal,
  ModifierSelectionModal,
  OrderHeader,
  TransferTableModal,
  ViewBillModal,
  VoidItemModal,
} from "../components";

interface OrderScreenProps {
  navigation: any;
  route: {
    params: {
      orderId?: Id<"orders">;
      tableId: Id<"tables">;
      tableName: string;
      storeId: Id<"stores">;
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

interface DraftItem {
  localId: string;
  productId: Id<"products">;
  productName: string;
  productPrice: number;
  quantity: number;
  notes?: string;
  modifiers?: SelectedModifier[];
  customPrice?: number;
}

let draftIdCounter = 0;

const cartEmptyComponent = (
  <YStack flex={1} alignItems="center" justifyContent="center" paddingVertical={64}>
    <Ionicons name="cart-outline" size={48} color="#D1D5DB" />
    <Text variant="muted" style={{ marginTop: 8 }}>
      No items in order
    </Text>
  </YStack>
);

export const OrderScreen = ({ navigation, route }: OrderScreenProps) => {
  const { tableId, storeId } = route.params;
  const [currentOrderId, setCurrentOrderId] = useState<Id<"orders"> | undefined>(
    route.params.orderId,
  );
  const [currentTableName, setCurrentTableName] = useState(route.params.tableName);
  const { isLoading, isAuthenticated } = useAuth();

  const isDraftMode = !currentOrderId;

  // Draft mode state
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);

  // Shared UI state
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isCreatingTab, setIsCreatingTab] = useState(false);
  const [isClosingTable, setIsClosingTable] = useState(false);
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);
  const [isUpdatingPax, setIsUpdatingPax] = useState(false);
  const addItemLockRef = useRef(false);
  const sendToKitchenLockRef = useRef(false);
  const cancelOrderLockRef = useRef(false);
  const createTabLockRef = useRef(false);
  const closeTableLockRef = useRef(false);
  const paxLockRef = useRef(false);

  // PAX state
  const [showPaxModal, setShowPaxModal] = useState(false);
  const [paxInput, setPaxInput] = useState("");
  const [pendingPaxAction, setPendingPaxAction] = useState<"send" | "update" | null>(null);

  // Modal state
  const [voidingItem, setVoidingItem] = useState<{
    id: Id<"orderItems">;
    name: string;
    quantity: number;
  } | null>(null);
  const [showViewBill, setShowViewBill] = useState(false);
  const [showTransferTable, setShowTransferTable] = useState(false);
  const [showEditTabName, setShowEditTabName] = useState(false);

  // Queries
  const order = useQuery(api.orders.get, currentOrderId ? { orderId: currentOrderId } : "skip");
  const products = useQuery(api.products.list, { storeId });

  // Prefetch all modifier data for the store — available instantly on product tap
  const allModifiers = useQuery(api.modifierAssignments.getForStore, { storeId });
  const modifiersByProduct = useMemo(() => {
    const map = new Map<string, typeof modifierGroups>();
    if (allModifiers) {
      for (const entry of allModifiers) {
        map.set(entry.productId, entry.groups);
      }
    }
    return map;
  }, [allModifiers]);

  // Get modifier groups for the selected product from prefetched data
  type ModifierGroup = NonNullable<typeof allModifiers>[number]["groups"];
  const modifierGroups: ModifierGroup = selectedProduct
    ? (modifiersByProduct.get(selectedProduct.id) ?? [])
    : [];

  // Mutations
  const addItem = useMutation(api.orders.addItem);
  const updateItemQuantity = useMutation(api.orders.updateItemQuantity);
  const removeItemMutation = useMutation(api.orders.removeItem);
  const cancelOrderMutation = useMutation(api.checkout.cancelOrder);
  const sendToKitchenMutation = useMutation(api.orders.sendToKitchen);
  const createAndSendMutation = useMutation(api.orders.createAndSendToKitchen);
  const createOrderMutation = useMutation(api.orders.create);
  const updatePaxMutation = useMutation(api.orders.updatePax);
  const updateTabNameMutation = useMutation(api.orders.updateTabName);
  const updateItemServiceType = useMutation(api.orders.updateItemServiceType);

  // Printer
  const { printKitchenTicket } = usePrinterStore();

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      sendToKitchenLockRef.current = false;
      cancelOrderLockRef.current = false;
      createTabLockRef.current = false;
      closeTableLockRef.current = false;
      setIsCreatingTab(false);
      setIsClosingTable(false);
      setIsSending(false);
      setIsUpdatingPax(false);
      paxLockRef.current = false;
    });

    return unsubscribe;
  }, [navigation]);

  // Cart data — unified from draft or server
  const activeItems = useMemo(() => {
    if (isDraftMode) {
      return draftItems.map((d) => ({
        _id: d.localId as unknown as Id<"orderItems">,
        productId: d.productId,
        productName: d.productName,
        productPrice: d.productPrice,
        quantity: d.quantity,
        notes: d.notes,
        isVoided: false,
        isSentToKitchen: false,
        serviceType: "dine_in" as "dine_in" | "takeout" | undefined,
        lineTotal: d.productPrice * d.quantity,
        modifiers: d.modifiers?.map((m) => ({
          groupName: m.modifierGroupName,
          optionName: m.modifierOptionName,
          priceAdjustment: m.priceAdjustment,
        })),
      }));
    }
    return order?.items.filter((i) => !i.isVoided) ?? [];
  }, [isDraftMode, draftItems, order]);

  const cartTotal = useMemo(
    () => activeItems.reduce((sum, item) => sum + item.lineTotal, 0),
    [activeItems],
  );
  const cartItemCount = useMemo(
    () => activeItems.reduce((sum, item) => sum + item.quantity, 0),
    [activeItems],
  );
  const hasUnsentItems = useMemo(() => {
    // In non-draft mode, require order to be loaded before enabling send
    if (!isDraftMode && !order) return false;
    return activeItems.some((i) => !i.isSentToKitchen);
  }, [activeItems, isDraftMode, order]);
  const hasSentItems = useMemo(() => activeItems.some((i) => i.isSentToKitchen), [activeItems]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleAddProduct = useCallback((product: SelectedProduct) => {
    setSelectedProduct(product);
    setQuantity(1);
    setNotes("");
    // The modal shown (AddItem vs Modifier) is determined by hasModifiers
    // which updates reactively when selectedProduct changes
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedProduct(null);
  }, []);

  const handleConfirmAdd = useCallback(
    async (customPrice?: number) => {
      if (!selectedProduct || addItemLockRef.current) return;

      addItemLockRef.current = true;
      const productPrice =
        selectedProduct.isOpenPrice && customPrice !== undefined
          ? customPrice
          : selectedProduct.price;

      try {
        if (isDraftMode) {
          setDraftItems((prev) => [
            ...prev,
            {
              localId: `draft-${++draftIdCounter}`,
              productId: selectedProduct.id,
              productName: selectedProduct.name,
              productPrice,
              quantity,
              notes: notes || undefined,
              customPrice: selectedProduct.isOpenPrice ? customPrice : undefined,
            },
          ]);
          setSelectedProduct(null);
          return;
        }

        setIsAddingItem(true);
        await addItem({
          orderId: currentOrderId!,
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
    [selectedProduct, isDraftMode, currentOrderId, quantity, notes, addItem],
  );

  const handleConfirmModifiers = useCallback(
    async (qty: number, itemNotes: string, modifiers: SelectedModifier[], customPrice?: number) => {
      if (!selectedProduct || addItemLockRef.current) return;

      addItemLockRef.current = true;
      const basePrice =
        selectedProduct.isOpenPrice && customPrice !== undefined
          ? customPrice
          : selectedProduct.price;

      try {
        if (isDraftMode) {
          const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
          setDraftItems((prev) => [
            ...prev,
            {
              localId: `draft-${++draftIdCounter}`,
              productId: selectedProduct.id,
              productName: selectedProduct.name,
              productPrice: basePrice + modifierTotal,
              quantity: qty,
              notes: itemNotes || undefined,
              modifiers,
              customPrice: selectedProduct.isOpenPrice ? customPrice : undefined,
            },
          ]);
          setSelectedProduct(null);
          return;
        }

        setIsAddingItem(true);
        await addItem({
          orderId: currentOrderId!,
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
    [selectedProduct, isDraftMode, currentOrderId, addItem],
  );

  const handleIncrement = useCallback(
    async (itemId: Id<"orderItems">, currentQty: number) => {
      if (isDraftMode) {
        setDraftItems((prev) =>
          prev.map((d) =>
            (d.localId as unknown as Id<"orderItems">) === itemId
              ? { ...d, quantity: d.quantity + 1 }
              : d,
          ),
        );
        return;
      }
      try {
        await updateItemQuantity({ orderItemId: itemId, quantity: currentQty + 1 });
      } catch (error) {
        console.error("Update quantity error:", error);
        Alert.alert("Error", "Failed to update quantity");
      }
    },
    [isDraftMode, updateItemQuantity],
  );

  const handleDecrement = useCallback(
    async (itemId: Id<"orderItems">, currentQty: number) => {
      if (isDraftMode) {
        if (currentQty <= 1) {
          setDraftItems((prev) =>
            prev.filter((d) => (d.localId as unknown as Id<"orderItems">) !== itemId),
          );
        } else {
          setDraftItems((prev) =>
            prev.map((d) =>
              (d.localId as unknown as Id<"orderItems">) === itemId
                ? { ...d, quantity: d.quantity - 1 }
                : d,
            ),
          );
        }
        return;
      }

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
    [isDraftMode, updateItemQuantity, removeItemMutation],
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

  const handleServiceTypeChange = useCallback(
    async (itemId: Id<"orderItems">, serviceType: "dine_in" | "takeout") => {
      try {
        await updateItemServiceType({ orderItemId: itemId, serviceType });
      } catch (error) {
        console.error("Failed to update service type:", error);
      }
    },
    [updateItemServiceType],
  );

  const executeSendToKitchen = useCallback(
    async (paxValue?: number) => {
      if (sendToKitchenLockRef.current) return;

      console.log("[SendToKitchen] Starting. isDraftMode:", isDraftMode, "paxValue:", paxValue);
      sendToKitchenLockRef.current = true;
      setIsSending(true);
      let shouldReleaseLock = true;
      try {
        let orderNumber: string;
        let sentItemNames: { name: string; quantity: number; notes?: string }[];

        if (isDraftMode) {
          // Validate required params
          console.log("[SendToKitchen] Draft mode - validating params:", {
            tableId,
            storeId,
            paxValue,
            itemCount: draftItems.length,
          });

          if (!tableId) {
            throw new Error("Table ID is required");
          }
          if (!storeId) {
            throw new Error("Store ID is required");
          }
          if (!paxValue || paxValue < 1) {
            throw new Error("Guest count is required");
          }
          if (draftItems.length === 0) {
            throw new Error("No items to send");
          }

          console.log("[SendToKitchen] Calling createAndSendMutation...");

          // First-time: create order + send
          let result: {
            orderId: Id<"orders">;
            orderNumber: string;
            sentItemIds: Id<"orderItems">[];
          };
          try {
            result = await createAndSendMutation({
              storeId,
              tableId,
              pax: paxValue,
              items: draftItems.map((d) => ({
                productId: d.productId,
                quantity: d.quantity,
                notes: d.notes,
                modifiers: d.modifiers,
                customPrice: d.customPrice,
              })),
            });
            console.log("[SendToKitchen] Mutation result:", JSON.stringify(result));
          } catch (mutationError: any) {
            console.error("[SendToKitchen] Mutation error:", mutationError);
            throw new Error(`Mutation failed: ${mutationError.message || mutationError}`);
          }

          if (!result || !result.orderId || !result.orderNumber) {
            throw new Error(`Failed to create order - invalid response: ${JSON.stringify(result)}`);
          }

          setCurrentOrderId(result.orderId);
          orderNumber = result.orderNumber;
          sentItemNames = draftItems.map((d) => ({
            name: d.productName,
            quantity: d.quantity,
            notes: d.notes,
            serviceType: "dine_in" as const,
            modifiers: d.modifiers?.map((m) => ({
              optionName: m.modifierOptionName,
              priceAdjustment: m.priceAdjustment,
            })),
          }));
          setDraftItems([]);
        } else {
          // Existing order: send unsent items
          console.log("[SendToKitchen] Existing order mode:", {
            currentOrderId,
            orderExists: !!order,
            orderNumber: order?.orderNumber,
          });

          if (!currentOrderId) {
            throw new Error("Order ID is required");
          }
          if (!order) {
            throw new Error("Order data not loaded");
          }

          const unsentItems = activeItems.filter((i) => !i.isSentToKitchen);
          await sendToKitchenMutation({ orderId: currentOrderId });
          orderNumber = order.orderNumber;
          sentItemNames = unsentItems.map((i) => ({
            name: i.productName,
            quantity: i.quantity,
            notes: i.notes,
            serviceType: i.serviceType ?? ("dine_in" as const),
            modifiers: i.modifiers?.map((m) => ({
              optionName: m.optionName,
              priceAdjustment: m.priceAdjustment,
            })),
          }));
        }

        // Print kitchen ticket with only the newly sent items
        const kitchenData: KitchenTicketData = {
          orderNumber,
          orderType: "dine_in",
          orderDefaultServiceType: "dine_in",
          tableMarker: currentTableName,
          customerName: order?.customerName,
          orderCategory: order?.orderCategory as "dine_in" | "takeout" | undefined,
          items: sentItemNames,
          timestamp: new Date(),
        };
        await printKitchenTicket(kitchenData);

        Alert.alert("Sent", "Items sent to kitchen", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
        shouldReleaseLock = false;
      } catch (error: any) {
        console.error("Send to kitchen error:", error);
        Alert.alert("Error", error.message || "Failed to send to kitchen");
      } finally {
        if (shouldReleaseLock) {
          sendToKitchenLockRef.current = false;
          setIsSending(false);
        }
      }
    },
    [
      isDraftMode,
      createAndSendMutation,
      sendToKitchenMutation,
      storeId,
      tableId,
      draftItems,
      activeItems,
      currentOrderId,
      order,
      currentTableName,
      printKitchenTicket,
      navigation,
    ],
  );

  const handleSendToKitchen = useCallback(async () => {
    if (sendToKitchenLockRef.current) return;

    // Guard: In non-draft mode, wait for order to load
    if (!isDraftMode && !order) {
      console.log("[SendToKitchen] Order not loaded yet, ignoring");
      return;
    }

    // In draft mode, prompt for PAX before first send
    if (isDraftMode) {
      setPaxInput("");
      setPendingPaxAction("send");
      setShowPaxModal(true);
      return;
    }

    await executeSendToKitchen();
  }, [isDraftMode, order, executeSendToKitchen]);

  const handlePaxConfirm = useCallback(async () => {
    if (paxLockRef.current) return;

    const pax = parseInt(paxInput, 10);
    if (!pax || pax < 1) {
      Alert.alert("Invalid", "Please enter a valid number of guests");
      return;
    }

    paxLockRef.current = true;
    setIsUpdatingPax(true);
    setShowPaxModal(false);

    try {
      if (pendingPaxAction === "send") {
        await executeSendToKitchen(pax);
      } else if (pendingPaxAction === "update" && currentOrderId) {
        await updatePaxMutation({ orderId: currentOrderId, pax });
      }
      setPendingPaxAction(null);
    } catch (error: any) {
      Alert.alert(
        "Error",
        error.message ||
          (pendingPaxAction === "send"
            ? "Failed to send items to kitchen"
            : "Failed to update PAX"),
      );
    } finally {
      paxLockRef.current = false;
      setIsUpdatingPax(false);
    }
  }, [paxInput, pendingPaxAction, executeSendToKitchen, currentOrderId, updatePaxMutation]);

  const handleUpdatePax = useCallback(() => {
    setPaxInput(order?.pax?.toString() ?? "");
    setPendingPaxAction("update");
    setShowPaxModal(true);
  }, [order?.pax]);

  const handleCloseTable = useCallback(() => {
    if (!currentOrderId || activeItems.length === 0 || closeTableLockRef.current) return;

    closeTableLockRef.current = true;
    setIsClosingTable(true);
    navigation.navigate("CheckoutScreen", {
      orderId: currentOrderId,
      tableId,
      tableName: currentTableName,
    });
  }, [currentOrderId, activeItems.length, navigation, tableId, currentTableName]);

  const handleCancelOrder = useCallback(() => {
    if (cancelOrderLockRef.current) return;

    if (isDraftMode) {
      if (draftItems.length === 0) {
        navigation.goBack();
        return;
      }
      Alert.alert("Cancel Order", "Discard all items and go back?", [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Discard",
          style: "destructive",
          onPress: () => navigation.goBack(),
        },
      ]);
      return;
    }

    Alert.alert(
      "Cancel Order",
      "Are you sure you want to cancel this order? All items will be removed.",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Cancel",
          style: "destructive",
          onPress: async () => {
            if (cancelOrderLockRef.current) return;

            cancelOrderLockRef.current = true;
            setIsCancellingOrder(true);
            try {
              await cancelOrderMutation({ orderId: currentOrderId! });
              navigation.goBack();
            } catch (error: any) {
              Alert.alert("Error", error.message || "Failed to cancel order");
              cancelOrderLockRef.current = false;
              setIsCancellingOrder(false);
            }
          },
        },
      ],
    );
  }, [isDraftMode, draftItems.length, cancelOrderMutation, currentOrderId, navigation]);

  const handleTransferred = useCallback((_newTableId: Id<"tables">, newTableName: string) => {
    setCurrentTableName(newTableName);
    setShowTransferTable(false);
    Alert.alert("Transferred", `Order moved to ${newTableName}`);
  }, []);

  const handleSaveTabName = useCallback(
    async (newName: string) => {
      if (!currentOrderId) return;
      try {
        await updateTabNameMutation({ orderId: currentOrderId, tabName: newName });
      } catch (error: any) {
        Alert.alert("Error", error.message || "Failed to update tab name");
      }
    },
    [currentOrderId, updateTabNameMutation],
  );

  const handleAddNewTab = useCallback(async () => {
    if (!tableId || !storeId || createTabLockRef.current || isCreatingTab) return;

    createTabLockRef.current = true;
    setIsCreatingTab(true);

    try {
      const newOrderId = await createOrderMutation({
        storeId,
        orderType: "dine_in",
        tableId,
        pax: 1,
        requestId: Crypto.randomUUID(),
      });

      navigation.navigate("OrderScreen", {
        orderId: newOrderId,
        tableId,
        tableName: currentTableName,
        storeId,
      });
    } catch (error: any) {
      createTabLockRef.current = false;
      Alert.alert("Error", error.message || "Failed to create new tab");
      setIsCreatingTab(false);
    }
  }, [tableId, storeId, createOrderMutation, navigation, currentTableName, isCreatingTab]);

  const renderCartItem = useCallback(
    ({ item }: { item: (typeof activeItems)[0] }) => (
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
        orderDefaultServiceType="dine_in"
        onServiceTypeChange={handleServiceTypeChange}
        onIncrement={handleIncrement}
        onDecrement={handleDecrement}
        onVoidItem={item.isSentToKitchen ? handleVoidItem : undefined}
      />
    ),
    [handleServiceTypeChange, handleIncrement, handleDecrement, handleVoidItem],
  );

  if (isLoading || !isAuthenticated) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#F3F4F6">
        <ActivityIndicator size="large" color="#0D87E1" />
      </YStack>
    );
  }

  // In existing order mode, wait for order data
  if (!isDraftMode && !order) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#F3F4F6">
        <ActivityIndicator size="large" color="#0D87E1" />
      </YStack>
    );
  }

  const subtitle = isDraftMode
    ? "New Order"
    : order?.pax
      ? `Dine-In · ${order.pax} pax`
      : "Dine-In";

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      <OrderHeader
        title={currentTableName}
        subtitle={subtitle}
        onBack={handleBack}
        onTransferTable={!isDraftMode ? () => setShowTransferTable(true) : undefined}
        onUpdatePax={!isDraftMode && order?.orderType === "dine_in" ? handleUpdatePax : undefined}
        disableUpdatePax={isUpdatingPax || isSending}
        tabNumber={!isDraftMode ? order?.tabNumber : undefined}
        tabName={!isDraftMode ? order?.tabName : undefined}
        onEditTabName={
          !isDraftMode && order?.orderType === "dine_in"
            ? () => setShowEditTabName(true)
            : undefined
        }
        onAddNewTab={!isDraftMode && order?.orderType === "dine_in" ? handleAddNewTab : undefined}
        disableAddNewTab={isCreatingTab}
      />

      <XStack flex={1}>
        {/* Menu Section */}
        <YStack flex={2} borderRightWidth={1} borderRightColor="#E5E7EB">
          <CategoryGrid storeId={storeId} products={products} onSelectProduct={handleAddProduct} />
        </YStack>

        {/* Cart Section */}
        <YStack flex={1} backgroundColor="#FFFFFF">
          <XStack
            justifyContent="space-between"
            alignItems="center"
            paddingHorizontal={12}
            paddingVertical={10}
            borderBottomWidth={1}
            borderBottomColor="#E5E7EB"
            backgroundColor="#F9FAFB"
          >
            <Text variant="heading" size="sm">
              Order Items
            </Text>
            <YStack
              backgroundColor="#0D87E1"
              borderRadius={9999}
              paddingHorizontal={10}
              paddingVertical={2}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 12 }}>
                {cartItemCount}
              </Text>
            </YStack>
          </XStack>

          <FlatList
            data={activeItems}
            keyExtractor={(item) => String(item._id)}
            renderItem={renderCartItem}
            ListEmptyComponent={cartEmptyComponent}
          />

          <CartFooter
            subtotal={cartTotal}
            itemCount={cartItemCount}
            hasUnsentItems={hasUnsentItems}
            hasSentItems={hasSentItems}
            isDraftMode={isDraftMode}
            onSendToKitchen={handleSendToKitchen}
            onCloseTable={handleCloseTable}
            onViewBill={() => setShowViewBill(true)}
            onCancelOrder={handleCancelOrder}
            isSendingToKitchen={isSending}
            isClosingTable={isClosingTable}
            isCancellingOrder={isCancellingOrder}
          />
        </YStack>
      </XStack>

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

      {!isDraftMode && order && (
        <ViewBillModal
          visible={showViewBill}
          orderNumber={order.orderNumber}
          tableName={currentTableName}
          items={order.items}
          grossSales={order.grossSales}
          vatAmount={order.vatAmount}
          netSales={order.netSales}
          onClose={() => setShowViewBill(false)}
        />
      )}

      {!isDraftMode && currentOrderId && (
        <TransferTableModal
          visible={showTransferTable}
          storeId={storeId}
          orderId={currentOrderId}
          currentTableName={currentTableName}
          onTransferred={handleTransferred}
          onClose={() => setShowTransferTable(false)}
        />
      )}

      {!isDraftMode && order?.tabNumber && order?.tabName && (
        <EditTabNameModal
          visible={showEditTabName}
          currentName={order.tabName}
          tabNumber={order.tabNumber}
          onSave={handleSaveTabName}
          onClose={() => setShowEditTabName(false)}
        />
      )}

      {/* PAX Input Modal */}
      <Modal
        visible={showPaxModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowPaxModal(false);
          setPendingPaxAction(null);
        }}
      >
        <YStack
          flex={1}
          justifyContent="center"
          alignItems="center"
          backgroundColor="rgba(0,0,0,0.5)"
        >
          <YStack backgroundColor="#FFFFFF" borderRadius={16} padding={24} width={288}>
            <Text variant="heading" size="lg" style={{ textAlign: "center", marginBottom: 16 }}>
              {pendingPaxAction === "update" ? "Update Guest Count" : "Guest Count (PAX)"}
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: "#D1D5DB",
                borderRadius: 8,
                paddingHorizontal: 16,
                paddingVertical: 12,
                textAlign: "center",
                fontSize: 18,
                marginBottom: 16,
              }}
              keyboardType="number-pad"
              placeholder="Number of guests"
              value={paxInput}
              onChangeText={setPaxInput}
              autoFocus
            />
            <XStack gap={12}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: "#E5E7EB",
                  borderRadius: 8,
                  paddingVertical: 12,
                }}
                onPress={() => {
                  setShowPaxModal(false);
                  setPendingPaxAction(null);
                }}
              >
                <Text style={{ textAlign: "center", fontWeight: "600", color: "#374151" }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={isSending || isUpdatingPax}
                style={{
                  flex: 1,
                  backgroundColor: isSending || isUpdatingPax ? "#93C5FD" : "#0D87E1",
                  borderRadius: 8,
                  paddingVertical: 12,
                }}
                onPress={handlePaxConfirm}
              >
                <Text style={{ textAlign: "center", fontWeight: "600", color: "#FFFFFF" }}>
                  Confirm
                </Text>
              </TouchableOpacity>
            </XStack>
          </YStack>
        </YStack>
      </Modal>
    </YStack>
  );
};

export default OrderScreen;
