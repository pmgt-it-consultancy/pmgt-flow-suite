import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
} from "react-native";
import { RFValue } from "react-native-responsive-fontsize";
import { useQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { useSessionToken } from "../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";

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

const OrderScreen = ({ navigation, route }: OrderScreenProps) => {
  const { orderId, tableId, tableName } = route.params;
  const token = useSessionToken();

  const [selectedCategory, setSelectedCategory] = useState<Id<"categories"> | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<{
    id: Id<"products">;
    name: string;
    price: number;
  } | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  // Query order
  const order = useQuery(
    api.orders.get,
    token ? { token, orderId } : "skip"
  );

  // Query products (only active products, don't pass includeInactive)
  const products = useQuery(
    api.products.list,
    token && order?.storeId ? { token, storeId: order.storeId } : "skip"
  );

  // Query categories
  const categories = useQuery(
    api.categories.list,
    token && order?.storeId ? { token, storeId: order.storeId } : "skip"
  );

  // Mutations
  const addItem = useMutation(api.orders.addItem);
  const updateItemQuantity = useMutation(api.orders.updateItemQuantity);
  const removeItem = useMutation(api.orders.removeItem);

  // Filter products
  const filteredProducts = products?.filter((p) => {
    const matchesCategory = selectedCategory === "all" || p.categoryId === selectedCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch && p.isActive;
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(amount);
  };

  const handleAddProduct = (product: NonNullable<typeof products>[number]) => {
    setSelectedProduct({
      id: product._id,
      name: product.name,
      price: product.price,
    });
    setQuantity(1);
    setNotes("");
  };

  const handleConfirmAdd = async () => {
    if (!token || !selectedProduct) return;

    setIsAddingItem(true);
    try {
      await addItem({
        token,
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
  };

  const handleUpdateQuantity = async (itemId: Id<"orderItems">, newQuantity: number) => {
    if (!token) return;

    if (newQuantity <= 0) {
      handleRemoveItem(itemId);
      return;
    }

    try {
      await updateItemQuantity({
        token,
        orderItemId: itemId,
        quantity: newQuantity,
      });
    } catch (error) {
      console.error("Update quantity error:", error);
      Alert.alert("Error", "Failed to update quantity");
    }
  };

  const handleRemoveItem = async (itemId: Id<"orderItems">) => {
    if (!token) return;

    Alert.alert(
      "Remove Item",
      "Are you sure you want to remove this item?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeItem({
                token,
                orderItemId: itemId,
              });
            } catch (error) {
              console.error("Remove item error:", error);
              Alert.alert("Error", "Failed to remove item");
            }
          },
        },
      ]
    );
  };

  const handleCheckout = () => {
    if (!order || order.items.filter(i => !i.isVoided).length === 0) {
      Alert.alert("Empty Order", "Add items to the order before checkout");
      return;
    }

    navigation.navigate("CheckoutScreen", {
      orderId,
      tableId,
      tableName,
    });
  };

  const handleBack = () => {
    navigation.goBack();
  };

  const activeItems = order?.items.filter(i => !i.isVoided) ?? [];
  const cartTotal = activeItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const cartItemCount = activeItems.reduce((sum, item) => sum + item.quantity, 0);

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
          <Text style={styles.headerTitle}>
            {tableName ?? `Order #${order.orderNumber}`}
          </Text>
          <Text style={styles.headerSubtitle}>
            {order.orderType === "dine_in" ? "Dine-In" : "Take-out"}
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        {/* Menu Section */}
        <View style={styles.menuSection}>
          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color="#9CA3AF" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search products..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {/* Categories */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoriesContainer}
          >
            <TouchableOpacity
              style={[
                styles.categoryChip,
                selectedCategory === "all" && styles.categoryChipActive,
              ]}
              onPress={() => setSelectedCategory("all")}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === "all" && styles.categoryChipTextActive,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>
            {categories?.map((cat) => (
              <TouchableOpacity
                key={cat._id}
                style={[
                  styles.categoryChip,
                  selectedCategory === cat._id && styles.categoryChipActive,
                ]}
                onPress={() => setSelectedCategory(cat._id)}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    selectedCategory === cat._id && styles.categoryChipTextActive,
                  ]}
                >
                  {cat.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Products Grid */}
          <FlatList
            data={filteredProducts}
            numColumns={2}
            keyExtractor={(item) => item._id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.productCard}
                onPress={() => handleAddProduct(item)}
              >
                <Text style={styles.productName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.productPrice}>
                  {formatCurrency(item.price)}
                </Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.productsGrid}
            columnWrapperStyle={styles.productsRow}
            ListEmptyComponent={
              <View style={styles.emptyProducts}>
                <Text style={styles.emptyText}>No products found</Text>
              </View>
            }
          />
        </View>

        {/* Cart Section */}
        <View style={styles.cartSection}>
          <View style={styles.cartHeader}>
            <Text style={styles.cartTitle}>Order Items</Text>
            <Text style={styles.cartCount}>{cartItemCount} items</Text>
          </View>

          <FlatList
            data={activeItems}
            keyExtractor={(item) => item._id}
            renderItem={({ item }) => (
              <View style={styles.cartItem}>
                <View style={styles.cartItemInfo}>
                  <Text style={styles.cartItemName} numberOfLines={1}>
                    {item.productName}
                  </Text>
                  <Text style={styles.cartItemPrice}>
                    {formatCurrency(item.productPrice)} each
                  </Text>
                  {item.notes && (
                    <Text style={styles.cartItemNotes} numberOfLines={1}>
                      Note: {item.notes}
                    </Text>
                  )}
                </View>
                <View style={styles.cartItemActions}>
                  <View style={styles.quantityControl}>
                    <TouchableOpacity
                      style={styles.quantityButton}
                      onPress={() => handleUpdateQuantity(item._id, item.quantity - 1)}
                    >
                      <Ionicons name="remove" size={16} color="#EF4444" />
                    </TouchableOpacity>
                    <Text style={styles.quantityText}>{item.quantity}</Text>
                    <TouchableOpacity
                      style={styles.quantityButton}
                      onPress={() => handleUpdateQuantity(item._id, item.quantity + 1)}
                    >
                      <Ionicons name="add" size={16} color="#22C55E" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.cartItemTotal}>
                    {formatCurrency(item.lineTotal)}
                  </Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyCart}>
                <Ionicons name="cart-outline" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>No items in order</Text>
              </View>
            }
          />

          {/* Cart Footer */}
          <View style={styles.cartFooter}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalAmount}>{formatCurrency(cartTotal)}</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.checkoutButton,
                activeItems.length === 0 && styles.checkoutButtonDisabled,
              ]}
              onPress={handleCheckout}
              disabled={activeItems.length === 0}
            >
              <Ionicons name="card-outline" size={20} color="#FFF" />
              <Text style={styles.checkoutButtonText}>Proceed to Checkout</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Add Item Modal */}
      <Modal
        visible={!!selectedProduct}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedProduct(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add to Order</Text>
              <TouchableOpacity onPress={() => setSelectedProduct(null)}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {selectedProduct && (
              <>
                <Text style={styles.modalProductName}>{selectedProduct.name}</Text>
                <Text style={styles.modalProductPrice}>
                  {formatCurrency(selectedProduct.price)}
                </Text>

                <View style={styles.modalQuantityRow}>
                  <Text style={styles.modalLabel}>Quantity</Text>
                  <View style={styles.modalQuantityControl}>
                    <TouchableOpacity
                      style={styles.modalQuantityButton}
                      onPress={() => setQuantity(Math.max(1, quantity - 1))}
                    >
                      <Ionicons name="remove" size={20} color="#EF4444" />
                    </TouchableOpacity>
                    <Text style={styles.modalQuantityText}>{quantity}</Text>
                    <TouchableOpacity
                      style={styles.modalQuantityButton}
                      onPress={() => setQuantity(quantity + 1)}
                    >
                      <Ionicons name="add" size={20} color="#22C55E" />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.modalNotesRow}>
                  <Text style={styles.modalLabel}>Notes (optional)</Text>
                  <TextInput
                    style={styles.modalNotesInput}
                    placeholder="E.g., no ice, extra spicy..."
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                  />
                </View>

                <View style={styles.modalFooter}>
                  <Text style={styles.modalTotal}>
                    Total: {formatCurrency(selectedProduct.price * quantity)}
                  </Text>
                  <TouchableOpacity
                    style={styles.modalAddButton}
                    onPress={handleConfirmAdd}
                    disabled={isAddingItem}
                  >
                    {isAddingItem ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={styles.modalAddButtonText}>Add to Order</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
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
    flexDirection: "row",
  },
  menuSection: {
    flex: 2,
    backgroundColor: "#FFFFFF",
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#F9FAFB",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontFamily: "Regular",
    fontSize: RFValue(12),
  },
  categoriesContainer: {
    maxHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#F3F4F6",
    marginRight: 8,
  },
  categoryChipActive: {
    backgroundColor: "#0D87E1",
  },
  categoryChipText: {
    fontFamily: "Medium",
    fontSize: RFValue(11),
    color: "#6B7280",
  },
  categoryChipTextActive: {
    color: "#FFFFFF",
  },
  productsGrid: {
    padding: 8,
  },
  productsRow: {
    justifyContent: "space-between",
  },
  productCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 12,
    margin: 4,
    maxWidth: "48%",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    elevation: 1,
  },
  productName: {
    fontFamily: "Medium",
    fontSize: RFValue(11),
    color: "#111827",
    marginBottom: 4,
    minHeight: 32,
  },
  productPrice: {
    fontFamily: "SemiBold",
    fontSize: RFValue(12),
    color: "#0D87E1",
  },
  emptyProducts: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontFamily: "Regular",
    fontSize: RFValue(12),
    color: "#9CA3AF",
  },
  cartSection: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  cartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  cartTitle: {
    fontFamily: "SemiBold",
    fontSize: RFValue(14),
    color: "#111827",
  },
  cartCount: {
    fontFamily: "Regular",
    fontSize: RFValue(11),
    color: "#6B7280",
  },
  cartItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  cartItemInfo: {
    marginBottom: 8,
  },
  cartItemName: {
    fontFamily: "Medium",
    fontSize: RFValue(12),
    color: "#111827",
  },
  cartItemPrice: {
    fontFamily: "Regular",
    fontSize: RFValue(10),
    color: "#6B7280",
  },
  cartItemNotes: {
    fontFamily: "Regular",
    fontSize: RFValue(9),
    color: "#9CA3AF",
    fontStyle: "italic",
  },
  cartItemActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
  },
  quantityButton: {
    padding: 8,
  },
  quantityText: {
    fontFamily: "SemiBold",
    fontSize: RFValue(12),
    color: "#111827",
    paddingHorizontal: 12,
  },
  cartItemTotal: {
    fontFamily: "SemiBold",
    fontSize: RFValue(12),
    color: "#111827",
  },
  emptyCart: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  cartFooter: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  totalLabel: {
    fontFamily: "Medium",
    fontSize: RFValue(14),
    color: "#374151",
  },
  totalAmount: {
    fontFamily: "Bold",
    fontSize: RFValue(16),
    color: "#111827",
  },
  checkoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#22C55E",
    padding: 14,
    borderRadius: 8,
  },
  checkoutButtonDisabled: {
    backgroundColor: "#D1D5DB",
  },
  checkoutButtonText: {
    fontFamily: "SemiBold",
    fontSize: RFValue(13),
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
    maxHeight: "60%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: "SemiBold",
    fontSize: RFValue(16),
    color: "#111827",
  },
  modalProductName: {
    fontFamily: "SemiBold",
    fontSize: RFValue(18),
    color: "#111827",
    marginBottom: 4,
  },
  modalProductPrice: {
    fontFamily: "Medium",
    fontSize: RFValue(16),
    color: "#0D87E1",
    marginBottom: 20,
  },
  modalQuantityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalLabel: {
    fontFamily: "Medium",
    fontSize: RFValue(13),
    color: "#374151",
  },
  modalQuantityControl: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
  },
  modalQuantityButton: {
    padding: 12,
  },
  modalQuantityText: {
    fontFamily: "SemiBold",
    fontSize: RFValue(16),
    color: "#111827",
    paddingHorizontal: 20,
  },
  modalNotesRow: {
    marginBottom: 20,
  },
  modalNotesInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    fontFamily: "Regular",
    fontSize: RFValue(13),
    minHeight: 60,
    textAlignVertical: "top",
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  modalTotal: {
    fontFamily: "Bold",
    fontSize: RFValue(16),
    color: "#111827",
  },
  modalAddButton: {
    backgroundColor: "#0D87E1",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 120,
    alignItems: "center",
  },
  modalAddButtonText: {
    fontFamily: "SemiBold",
    fontSize: RFValue(13),
    color: "#FFFFFF",
  },
});

export default OrderScreen;
