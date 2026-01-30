import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { Alert, TextInput } from "react-native";
import { ActivityIndicator, FlatList, Modal, TouchableOpacity, View } from "uniwind/components";
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
}

interface DraftItem {
  localId: string;
  productId: Id<"products">;
  productName: string;
  productPrice: number;
  quantity: number;
  notes?: string;
  modifiers?: SelectedModifier[];
}

let draftIdCounter = 0;

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
  const updatePaxMutation = useMutation(api.orders.updatePax);

  // Printer
  const { printKitchenTicket } = usePrinterStore();

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
  const hasUnsentItems = useMemo(() => activeItems.some((i) => !i.isSentToKitchen), [activeItems]);
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

  const handleConfirmAdd = useCallback(async () => {
    if (!selectedProduct) return;

    if (isDraftMode) {
      // Add to local draft
      setDraftItems((prev) => [
        ...prev,
        {
          localId: `draft-${++draftIdCounter}`,
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          productPrice: selectedProduct.price,
          quantity,
          notes: notes || undefined,
        },
      ]);
      setSelectedProduct(null);
      return;
    }

    // Add to existing order
    setIsAddingItem(true);
    try {
      await addItem({
        orderId: currentOrderId!,
        productId: selectedProduct.id,
        quantity,
        notes: notes || undefined,
      });
      setSelectedProduct(null);
    } catch (error) {
      console.error("Add item error:", error);
      Alert.alert("Error", "Failed to add item to order");
    } finally {
      setIsAddingItem(false);
    }
  }, [selectedProduct, isDraftMode, currentOrderId, quantity, notes, addItem]);

  const handleConfirmModifiers = useCallback(
    async (qty: number, itemNotes: string, modifiers: SelectedModifier[]) => {
      if (!selectedProduct) return;

      if (isDraftMode) {
        const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
        setDraftItems((prev) => [
          ...prev,
          {
            localId: `draft-${++draftIdCounter}`,
            productId: selectedProduct.id,
            productName: selectedProduct.name,
            productPrice: selectedProduct.price + modifierTotal,
            quantity: qty,
            notes: itemNotes || undefined,
            modifiers,
          },
        ]);
        setSelectedProduct(null);
        return;
      }

      setIsAddingItem(true);
      try {
        await addItem({
          orderId: currentOrderId!,
          productId: selectedProduct.id,
          quantity: qty,
          notes: itemNotes || undefined,
          modifiers,
        });
        setSelectedProduct(null);
      } catch (error) {
        console.error("Add item error:", error);
        Alert.alert("Error", "Failed to add item to order");
      } finally {
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

  const handleSendToKitchen = useCallback(async () => {
    // In draft mode, prompt for PAX before first send
    if (isDraftMode) {
      setPaxInput("");
      setPendingPaxAction("send");
      setShowPaxModal(true);
      return;
    }

    await executeSendToKitchen();
  }, [isDraftMode]);

  const executeSendToKitchen = useCallback(
    async (paxValue?: number) => {
      setIsSending(true);
      try {
        let orderNumber: string;
        let sentItemNames: { name: string; quantity: number; notes?: string }[];

        if (isDraftMode) {
          // First-time: create order + send
          const result = await createAndSendMutation({
            storeId,
            tableId,
            pax: paxValue!,
            items: draftItems.map((d) => ({
              productId: d.productId,
              quantity: d.quantity,
              notes: d.notes,
              modifiers: d.modifiers,
            })),
          });
          setCurrentOrderId(result.orderId);
          orderNumber = result.orderNumber;
          sentItemNames = draftItems.map((d) => ({
            name: d.productName,
            quantity: d.quantity,
            notes: d.notes,
            modifiers: d.modifiers?.map((m) => ({
              optionName: m.modifierOptionName,
              priceAdjustment: m.priceAdjustment,
            })),
          }));
          setDraftItems([]);
        } else {
          // Existing order: send unsent items
          const unsentItems = activeItems.filter((i) => !i.isSentToKitchen);
          await sendToKitchenMutation({ orderId: currentOrderId! });
          orderNumber = order!.orderNumber;
          sentItemNames = unsentItems.map((i) => ({
            name: i.productName,
            quantity: i.quantity,
            notes: i.notes,
            modifiers: i.modifiers?.map((m) => ({
              optionName: m.optionName,
              priceAdjustment: m.priceAdjustment,
            })),
          }));
        }

        // Print kitchen ticket with only the newly sent items
        const kitchenData: KitchenTicketData = {
          orderNumber,
          tableName: currentTableName,
          orderType: "dine_in",
          items: sentItemNames,
          timestamp: new Date(),
        };
        await printKitchenTicket(kitchenData);

        Alert.alert("Sent", "Items sent to kitchen", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
      } catch (error: any) {
        console.error("Send to kitchen error:", error);
        Alert.alert("Error", error.message || "Failed to send to kitchen");
      } finally {
        setIsSending(false);
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

  const handlePaxConfirm = useCallback(async () => {
    const pax = parseInt(paxInput, 10);
    if (!pax || pax < 1) {
      Alert.alert("Invalid", "Please enter a valid number of guests");
      return;
    }
    setShowPaxModal(false);

    if (pendingPaxAction === "send") {
      await executeSendToKitchen(pax);
    } else if (pendingPaxAction === "update" && currentOrderId) {
      try {
        await updatePaxMutation({ orderId: currentOrderId, pax });
      } catch (error: any) {
        Alert.alert("Error", error.message || "Failed to update PAX");
      }
    }
    setPendingPaxAction(null);
  }, [paxInput, pendingPaxAction, executeSendToKitchen, currentOrderId, updatePaxMutation]);

  const handleUpdatePax = useCallback(() => {
    setPaxInput(order?.pax?.toString() ?? "");
    setPendingPaxAction("update");
    setShowPaxModal(true);
  }, [order?.pax]);

  const handleCloseTable = useCallback(() => {
    if (!currentOrderId || activeItems.length === 0) return;
    navigation.navigate("CheckoutScreen", {
      orderId: currentOrderId,
      tableId,
      tableName: currentTableName,
    });
  }, [currentOrderId, activeItems.length, navigation, tableId, currentTableName]);

  const handleCancelOrder = useCallback(() => {
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
            try {
              await cancelOrderMutation({ orderId: currentOrderId! });
              navigation.goBack();
            } catch (error: any) {
              Alert.alert("Error", error.message || "Failed to cancel order");
            }
          },
        },
      ],
    );
  }, [isDraftMode, draftItems.length, cancelOrderMutation, currentOrderId, navigation]);

  const handleTransferred = useCallback((newTableId: Id<"tables">, newTableName: string) => {
    setCurrentTableName(newTableName);
    setShowTransferTable(false);
    Alert.alert("Transferred", `Order moved to ${newTableName}`);
  }, []);

  if (isLoading || !isAuthenticated) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-100">
        <ActivityIndicator size="large" color="#0D87E1" />
      </View>
    );
  }

  // In existing order mode, wait for order data
  if (!isDraftMode && !order) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-100">
        <ActivityIndicator size="large" color="#0D87E1" />
      </View>
    );
  }

  const subtitle = isDraftMode
    ? "New Order"
    : order?.pax
      ? `Dine-In · ${order.pax} pax`
      : "Dine-In";

  return (
    <View className="flex-1 bg-gray-100">
      <OrderHeader
        title={currentTableName}
        subtitle={subtitle}
        onBack={handleBack}
        onTransferTable={!isDraftMode ? () => setShowTransferTable(true) : undefined}
        onUpdatePax={!isDraftMode && order?.orderType === "dine_in" ? handleUpdatePax : undefined}
      />

      <View className="flex-1 flex-row">
        {/* Menu Section */}
        <View className="flex-2 border-r border-gray-200">
          <CategoryGrid storeId={storeId} products={products} onSelectProduct={handleAddProduct} />
        </View>

        {/* Cart Section */}
        <View className="flex-1 bg-white">
          <View className="flex-row justify-between items-center px-3 py-2.5 border-b border-gray-200 bg-gray-50">
            <Text variant="heading" size="sm">
              Order Items
            </Text>
            <View className="bg-blue-500 rounded-full px-2.5 py-0.5">
              <Text className="text-white font-bold text-xs">{cartItemCount}</Text>
            </View>
          </View>

          <FlatList
            data={activeItems}
            keyExtractor={(item) => item._id}
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
                onIncrement={handleIncrement}
                onDecrement={handleDecrement}
                onVoidItem={item.isSentToKitchen ? handleVoidItem : undefined}
              />
            )}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-16">
                <Ionicons name="cart-outline" size={48} color="#D1D5DB" />
                <Text variant="muted" className="mt-2">
                  No items in order
                </Text>
              </View>
            }
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
          />
        </View>
      </View>

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
        <View className="flex-1 justify-center items-center bg-black/50">
          <View className="bg-white rounded-2xl p-6 w-72">
            <Text variant="heading" size="lg" className="text-center mb-4">
              {pendingPaxAction === "update" ? "Update Guest Count" : "Guest Count (PAX)"}
            </Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-center text-lg mb-4"
              keyboardType="number-pad"
              placeholder="Number of guests"
              value={paxInput}
              onChangeText={setPaxInput}
              autoFocus
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 bg-gray-200 rounded-lg py-3"
                onPress={() => {
                  setShowPaxModal(false);
                  setPendingPaxAction(null);
                }}
              >
                <Text className="text-center font-semibold text-gray-700">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-blue-500 rounded-lg py-3"
                onPress={handlePaxConfirm}
              >
                <Text className="text-center font-semibold text-white">Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default OrderScreen;
