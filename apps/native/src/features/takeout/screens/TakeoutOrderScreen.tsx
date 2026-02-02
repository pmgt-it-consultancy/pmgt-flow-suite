import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";

import { ActivityIndicator, Alert, FlatList } from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import type { SelectedModifier } from "../../orders/components";
import {
  AddItemModal,
  CartFooter,
  CartItem,
  CategoryGrid,
  ModifierSelectionModal,
  OrderHeader,
  VoidItemModal,
} from "../../orders/components";
import { Button, Input, Text } from "../../shared/components/ui";

interface TakeoutOrderScreenProps {
  navigation: any;
  route: {
    params: {
      storeId: Id<"stores">;
    };
  };
}

interface SelectedProduct {
  id: Id<"products">;
  name: string;
  price: number;
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

export const TakeoutOrderScreen = ({ navigation, route }: TakeoutOrderScreenProps) => {
  const { storeId } = route.params;
  const { isLoading, isAuthenticated } = useAuth();

  // Takeout-specific state
  const [customerName, setCustomerName] = useState("");
  const [currentOrderId, setCurrentOrderId] = useState<Id<"orders"> | undefined>();
  const isDraftMode = !currentOrderId;

  // Draft mode state
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);

  // Shared UI state
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Modal state
  const [voidingItem, setVoidingItem] = useState<{
    id: Id<"orderItems">;
    name: string;
    quantity: number;
  } | null>(null);

  // Queries
  const order = useQuery(api.orders.get, currentOrderId ? { orderId: currentOrderId } : "skip");
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
  const createOrder = useMutation(api.orders.create);
  const addItemMutation = useMutation(api.orders.addItem);
  const updateItemQuantity = useMutation(api.orders.updateItemQuantity);
  const removeItemMutation = useMutation(api.orders.removeItem);
  // Cart data
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

  const handleViewOrders = useCallback(() => {
    navigation.navigate("TakeoutListScreen");
  }, [navigation]);

  const handleAddProduct = useCallback((product: SelectedProduct) => {
    setSelectedProduct(product);
    setQuantity(1);
    setNotes("");
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedProduct(null);
  }, []);

  const handleConfirmAdd = useCallback(async () => {
    if (!selectedProduct) return;

    if (isDraftMode) {
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

    setIsAddingItem(true);
    try {
      await addItemMutation({
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
  }, [selectedProduct, isDraftMode, currentOrderId, quantity, notes, addItemMutation]);

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
        await addItemMutation({
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
    [selectedProduct, isDraftMode, currentOrderId, addItemMutation],
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

  const handleCheckout = useCallback(async () => {
    if (draftItems.length === 0 && isDraftMode) {
      Alert.alert("No Items", "Add items before checkout");
      return;
    }

    setIsSending(true);
    try {
      let orderId: Id<"orders">;

      if (isDraftMode) {
        // Create takeout order
        orderId = await createOrder({
          storeId,
          orderType: "takeout",
          customerName: customerName.trim() || undefined,
        });

        // Add items one by one
        for (const item of draftItems) {
          await addItemMutation({
            orderId,
            productId: item.productId,
            quantity: item.quantity,
            notes: item.notes,
            modifiers: item.modifiers,
          });
        }

        setCurrentOrderId(orderId);
        setDraftItems([]);
      } else {
        orderId = currentOrderId!;
      }

      // Navigate to checkout
      navigation.navigate("CheckoutScreen", {
        orderId,
        orderType: "takeout",
      });
    } catch (error: any) {
      console.error("Checkout error:", error);
      Alert.alert("Error", error.message || "Failed to proceed to checkout");
    } finally {
      setIsSending(false);
    }
  }, [
    isDraftMode,
    draftItems,
    createOrder,
    addItemMutation,
    storeId,
    customerName,
    currentOrderId,
    navigation,
  ]);

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
    navigation.goBack();
  }, [isDraftMode, draftItems.length, navigation]);

  if (isLoading || !isAuthenticated) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#F3F4F6">
        <ActivityIndicator size="large" color="#0D87E1" />
      </YStack>
    );
  }

  const subtitle = isDraftMode ? "New Takeout Order" : "Takeout";

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      <OrderHeader
        title={customerName.trim() || "Takeout"}
        subtitle={subtitle}
        onBack={handleBack}
        onViewOrders={handleViewOrders}
      />

      <XStack flex={1}>
        {/* Menu Section */}
        <YStack flex={2} borderRightWidth={1} borderColor="#E5E7EB">
          {/* Customer Name Input */}
          {isDraftMode ? (
            <YStack
              paddingHorizontal={12}
              paddingVertical={8}
              backgroundColor="#FFFFFF"
              borderBottomWidth={1}
              borderColor="#E5E7EB"
            >
              <Input
                placeholder="Customer name (optional)"
                value={customerName}
                onChangeText={setCustomerName}
              />
            </YStack>
          ) : null}

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
            borderColor="#E5E7EB"
            backgroundColor="#F9FAFB"
          >
            <Text variant="heading" size="sm">
              Order Items
            </Text>
            <YStack
              backgroundColor="#F97316"
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
              <YStack flex={1} alignItems="center" justifyContent="center" paddingVertical={64}>
                <Ionicons name="cart-outline" size={48} color="#D1D5DB" />
                <Text variant="muted" style={{ marginTop: 8 }}>
                  No items in order
                </Text>
              </YStack>
            }
          />

          <CartFooter
            subtotal={cartTotal}
            itemCount={cartItemCount}
            hasUnsentItems={hasUnsentItems}
            hasSentItems={hasSentItems}
            isDraftMode={isDraftMode}
            orderType="takeout"
            onSendToKitchen={handleCheckout}
            onCloseTable={undefined}
            onViewBill={undefined}
            onCancelOrder={handleCancelOrder}
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
    </YStack>
  );
};

export default TakeoutOrderScreen;
