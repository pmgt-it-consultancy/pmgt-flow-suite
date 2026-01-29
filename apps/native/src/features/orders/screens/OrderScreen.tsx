import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import { ActivityIndicator, FlatList, View } from "uniwind/components";
import { useAuth } from "../../auth/context";
import { Text } from "../../shared/components/ui";
import {
  AddItemModal,
  CartFooter,
  CartItem,
  CategoryFilter,
  OrderHeader,
  ProductCard,
  SearchBar,
} from "../components";

interface OrderScreenProps {
  navigation: any;
  route: {
    params: {
      orderId: Id<"orders">;
      tableId?: Id<"tables">;
      tableName?: string;
    };
  };
}

interface SelectedProduct {
  id: Id<"products">;
  name: string;
  price: number;
}

export const OrderScreen = ({ navigation, route }: OrderScreenProps) => {
  const { orderId, tableId, tableName } = route.params;
  const { isLoading, isAuthenticated } = useAuth();

  const [selectedCategory, setSelectedCategory] = useState<Id<"categories"> | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  // Queries - auth is handled automatically by Convex Auth
  const order = useQuery(api.orders.get, { orderId });
  const products = useQuery(
    api.products.list,
    order?.storeId ? { storeId: order.storeId } : "skip",
  );
  const categories = useQuery(
    api.categories.list,
    order?.storeId ? { storeId: order.storeId } : "skip",
  );

  // Mutations
  const addItem = useMutation(api.orders.addItem);
  const updateItemQuantity = useMutation(api.orders.updateItemQuantity);
  const removeItem = useMutation(api.orders.removeItem);
  const cancelOrderMutation = useMutation(api.checkout.cancelOrder);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products?.filter((p) => {
      const matchesCategory = selectedCategory === "all" || p.categoryId === selectedCategory;
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch && p.isActive;
    });
  }, [products, selectedCategory, searchQuery]);

  // Cart data
  const activeItems = useMemo(() => order?.items.filter((i) => !i.isVoided) ?? [], [order]);
  const cartTotal = useMemo(
    () => activeItems.reduce((sum, item) => sum + item.lineTotal, 0),
    [activeItems],
  );
  const cartItemCount = useMemo(
    () => activeItems.reduce((sum, item) => sum + item.quantity, 0),
    [activeItems],
  );

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

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

    setIsAddingItem(true);
    try {
      await addItem({
        orderId,
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
  }, [selectedProduct, orderId, quantity, notes, addItem]);

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
                await removeItem({ orderItemId: itemId });
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
    [updateItemQuantity, removeItem],
  );

  const handleCancelOrder = useCallback(() => {
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
              await cancelOrderMutation({ orderId });
              navigation.goBack();
            } catch (error) {
              console.error("Cancel order error:", error);
              Alert.alert("Error", "Failed to cancel order");
            }
          },
        },
      ],
    );
  }, [cancelOrderMutation, orderId, navigation]);

  const handleCheckout = useCallback(() => {
    if (activeItems.length === 0) {
      Alert.alert("Empty Order", "Add items to the order before checkout");
      return;
    }
    navigation.navigate("CheckoutScreen", { orderId, tableId, tableName });
  }, [activeItems.length, navigation, orderId, tableId, tableName]);

  if (isLoading || !isAuthenticated || !order) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-100">
        <ActivityIndicator size="large" color="#0D87E1" />
      </View>
    );
  }

  const orderTypeLabel = order.orderType === "dine_in" ? "Dine-In" : "Take-out";

  return (
    <View className="flex-1 bg-gray-100">
      <OrderHeader
        title={tableName ?? `Order #${order.orderNumber}`}
        subtitle={orderTypeLabel}
        onBack={handleBack}
      />

      <View className="flex-1 flex-row">
        {/* Menu Section */}
        <View className="flex-2 border-r border-gray-200">
          <SearchBar value={searchQuery} onChangeText={setSearchQuery} />

          <CategoryFilter
            categories={categories ?? []}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />

          <FlatList
            data={filteredProducts}
            numColumns={3}
            keyExtractor={(item) => item._id}
            renderItem={({ item }) => (
              <ProductCard
                id={item._id}
                name={item.name}
                price={item.price}
                onPress={handleAddProduct}
              />
            )}
            contentContainerStyle={{ padding: 6 }}
            columnWrapperStyle={{ justifyContent: "flex-start" }}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-16">
                <Ionicons name="search-outline" size={40} color="#D1D5DB" />
                <Text variant="muted" className="mt-3">
                  No products found
                </Text>
              </View>
            }
          />
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
                onIncrement={handleIncrement}
                onDecrement={handleDecrement}
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
            onCheckout={handleCheckout}
            onCancelOrder={handleCancelOrder}
          />
        </View>
      </View>

      <AddItemModal
        visible={!!selectedProduct}
        product={selectedProduct}
        quantity={quantity}
        notes={notes}
        isLoading={isAddingItem}
        onClose={handleCloseModal}
        onQuantityChange={setQuantity}
        onNotesChange={setNotes}
        onConfirm={handleConfirmAdd}
      />
    </View>
  );
};

export default OrderScreen;
