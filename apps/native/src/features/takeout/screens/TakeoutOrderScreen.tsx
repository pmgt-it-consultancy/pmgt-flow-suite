import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { IconButton, Text } from "../../shared/components/ui";
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
  const submitDraftMutation = useMutation(api.orders.submitDraft);
  const updateCustomerNameMutation = useMutation(api.orders.updateCustomerName);

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

  const handleConfirmAdd = useCallback(
    async (customPrice?: number) => {
      if (!selectedProduct) return;

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
        setIsAddingItem(false);
      }
    },
    [selectedProduct, orderId, quantity, notes, addItemMutation],
  );

  const handleConfirmModifiers = useCallback(
    async (qty: number, itemNotes: string, modifiers: SelectedModifier[], customPrice?: number) => {
      if (!selectedProduct) return;

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
    const items = order?.items.filter((i) => !i.isVoided) ?? [];
    if (items.length === 0) {
      Alert.alert("No Items", "Please add items before proceeding to payment.");
      return;
    }

    setIsSending(true);
    try {
      if (order?.status === "draft") {
        await submitDraftMutation({ orderId });
      }

      navigation.navigate("CheckoutScreen", {
        orderId,
        orderType: "takeout",
      });
    } catch (error: any) {
      console.error("Checkout error:", error);
      Alert.alert("Error", error.message || "Failed to proceed to payment");
    } finally {
      setIsSending(false);
    }
  }, [order, orderId, submitDraftMutation, navigation]);

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
      {/* Enhanced Header */}
      <YStack
        backgroundColor="#FFFFFF"
        paddingHorizontal={16}
        paddingVertical={12}
        borderBottomWidth={1}
        borderBottomColor="#E2E8F0"
        shadowColor="#000"
        shadowOffset={{ width: 0, height: 1 }}
        shadowOpacity={0.05}
        shadowRadius={4}
        elevation={2}
      >
        <XStack alignItems="center" justifyContent="space-between">
          <XStack alignItems="center" flex={1}>
            <IconButton
              icon="arrow-back"
              variant="ghost"
              onPress={handleBack}
              style={{ marginRight: 8 }}
            />
            <YStack flex={1}>
              <XStack alignItems="center">
                <Text variant="heading" size="xl" numberOfLines={1}>
                  {customerName.trim() || "Takeout Order"}
                </Text>
                <YStack
                  marginLeft={10}
                  backgroundColor="#FFF7ED"
                  borderRadius={6}
                  paddingHorizontal={10}
                  paddingVertical={4}
                  borderWidth={1}
                  borderColor="#FDBA74"
                >
                  <XStack alignItems="center">
                    <Ionicons name="bag-handle" size={14} color="#EA580C" />
                    <Text
                      style={{ color: "#EA580C", fontWeight: "700", fontSize: 12, marginLeft: 4 }}
                    >
                      TAKEOUT
                    </Text>
                  </XStack>
                </YStack>
              </XStack>
              <Text variant="muted" size="sm" style={{ marginTop: 2 }}>
                {order?.status === "draft" ? "Draft — add items to continue" : "Order in progress"}
              </Text>
            </YStack>
          </XStack>
          <XStack alignItems="center" gap={4}>
            <SystemStatusBar />
            <IconButton
              icon="list"
              variant="ghost"
              onPress={handleViewOrders}
              iconColor="#64748B"
            />
          </XStack>
        </XStack>
      </YStack>

      <XStack flex={1}>
        {/* Menu Section */}
        <YStack flex={2} borderRightWidth={1} borderRightColor="#E2E8F0">
          {/* Customer Name Input - Always visible for takeout orders */}
          <YStack
            paddingHorizontal={16}
            paddingVertical={12}
            backgroundColor="#FFFFFF"
            borderBottomWidth={1}
            borderBottomColor="#E2E8F0"
          >
            <XStack alignItems="center">
              <YStack
                backgroundColor={customerName.trim() ? "#FFF7ED" : "#F8FAFC"}
                borderRadius={8}
                padding={10}
                marginRight={12}
                borderWidth={1}
                borderColor={customerName.trim() ? "#FDBA74" : "#E2E8F0"}
              >
                <Ionicons
                  name="person"
                  size={20}
                  color={customerName.trim() ? "#EA580C" : "#94A3B8"}
                />
              </YStack>
              <YStack flex={1}>
                <Text
                  variant="muted"
                  size="xs"
                  style={{ marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}
                >
                  Customer Name
                </Text>
                <TextInput
                  placeholder="Enter customer name (optional)"
                  value={customerName}
                  onChangeText={setCustomerName}
                  onBlur={handleCustomerNameBlur}
                  placeholderTextColor="#9CA3AF"
                  style={{
                    backgroundColor: "#F8FAFC",
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    fontSize: 16,
                    color: "#111827",
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
            <TouchableOpacity
              onPress={handleCheckout}
              disabled={!hasItems || isSending}
              activeOpacity={0.8}
              style={{
                backgroundColor: hasItems && !isSending ? "#F97316" : "#CBD5E1",
                borderRadius: 12,
                paddingVertical: 16,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: hasItems ? "#F97316" : "transparent",
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
              onPress={handleBack}
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
              }}
            >
              <Ionicons
                name="close-circle-outline"
                size={20}
                color="#DC2626"
                style={{ marginRight: 8 }}
              />
              <Text style={{ color: "#DC2626", fontWeight: "600", fontSize: 15 }}>
                Cancel Order
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
