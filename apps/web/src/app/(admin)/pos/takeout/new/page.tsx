"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Minus, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { useAdminStore } from "@/stores/useAdminStore";

interface CartItem {
  productId: Id<"products">;
  productName: string;
  productPrice: number;
  quantity: number;
  notes?: string;
}

export default function NewTakeoutOrderPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  const [customerName, setCustomerName] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get products
  const products = useQuery(
    api.products.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  const createOrder = useMutation(api.orders.create);
  const addItem = useMutation(api.orders.addItem);
  const sendToKitchen = useMutation(api.orders.sendToKitchen);

  const activeProducts = products?.filter((p) => p.isActive) ?? [];
  const filteredProducts = searchQuery
    ? activeProducts.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : activeProducts;

  const addToCart = (product: { _id: Id<"products">; name: string; price: number }) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product._id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product._id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [
        ...prev,
        {
          productId: product._id,
          productName: product.name,
          productPrice: product.price,
          quantity: 1,
        },
      ];
    });
  };

  const updateCartQuantity = (productId: Id<"products">, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const removeFromCart = (productId: Id<"products">) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.productPrice * item.quantity, 0);

  const handleSubmitOrder = async () => {
    if (!selectedStoreId) {
      toast.error("No store selected");
      return;
    }
    if (!customerName.trim()) {
      toast.error("Customer name is required");
      return;
    }
    if (cart.length === 0) {
      toast.error("Add at least one item");
      return;
    }

    setIsSubmitting(true);
    try {
      // Create the order
      const orderId = await createOrder({
        storeId: selectedStoreId,
        orderType: "takeout",
        customerName: customerName.trim(),
      });

      // Add items
      for (const item of cart) {
        await addItem({
          orderId,
          productId: item.productId,
          quantity: item.quantity,
          notes: item.notes,
        });
      }

      // Send to kitchen
      await sendToKitchen({ orderId });

      toast.success("Takeout order created and sent to kitchen!");
      router.push("/pos/takeout");
    } catch (error: any) {
      toast.error(error.message || "Failed to create order");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/pos/takeout")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Takeout Order</h1>
          <p className="text-gray-500">Create a new takeout order</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Product Selection (left 2/3) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Customer Name */}
          <Card>
            <CardContent className="pt-6">
              <label htmlFor="customerName" className="text-sm font-medium mb-2 block">
                Customer Name *
              </label>
              <Input
                id="customerName"
                placeholder="Enter customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </CardContent>
          </Card>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Product Grid */}
          <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map((product) => (
              <button
                type="button"
                key={product._id}
                onClick={() =>
                  addToCart({
                    _id: product._id,
                    name: product.name,
                    price: product.price,
                  })
                }
                className="p-3 border rounded-lg text-left hover:bg-gray-50 transition-colors"
              >
                <p className="text-sm font-medium truncate">{product.name}</p>
                <p className="text-sm text-primary font-bold">{formatCurrency(product.price)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Cart (right 1/3) */}
        <div>
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShoppingBag className="h-5 w-5" />
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length > 0 ? (
                <div className="space-y-3">
                  {cart.map((item) => (
                    <div key={item.productId} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.productName}</p>
                        <p className="text-xs text-gray-500">
                          {formatCurrency(item.productPrice)} each
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateCartQuantity(item.productId, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateCartQuantity(item.productId, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500"
                          onClick={() => removeFromCart(item.productId)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  <div className="border-t pt-3 mt-3">
                    <div className="flex justify-between text-lg font-bold">
                      <span>Total</span>
                      <span>{formatCurrency(cartTotal)}</span>
                    </div>
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleSubmitOrder}
                    disabled={isSubmitting || !customerName.trim()}
                  >
                    {isSubmitting ? "Creating Order..." : "Create & Send to Kitchen"}
                  </Button>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  <ShoppingBag className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Cart is empty</p>
                  <p className="text-xs">Tap products to add them</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
