"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Eye, Receipt, Search, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";

type OrderStatus = "open" | "paid" | "voided";

export default function OrdersPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<Id<"orders"> | null>(null);

  // Queries
  const orders = useQuery(
    api.orders.list,
    isAuthenticated && selectedStoreId
      ? {
          storeId: selectedStoreId,
          status: statusFilter === "all" ? undefined : statusFilter,
          limit: 100,
        }
      : "skip",
  );

  // Get order details when an order is selected
  const orderDetails = useQuery(
    api.orders.get,
    selectedOrderId ? { orderId: selectedOrderId } : "skip",
  );

  // Filter orders by search query
  const filteredOrders = orders?.filter((order) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      order.orderNumber.toLowerCase().includes(query) ||
      order.customerName?.toLowerCase().includes(query) ||
      order.tableName?.toLowerCase().includes(query)
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <Badge variant="secondary">Open</Badge>;
      case "paid":
        return <Badge variant="default">Paid</Badge>;
      case "voided":
        return <Badge variant="destructive">Voided</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(amount / 100); // Convert from centavos
  };

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
          <p className="text-gray-500">View and manage order history</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="status" className="whitespace-nowrap">
                Status:
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as OrderStatus | "all")}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="voided">Voided</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search by order #, customer, or table..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders List */}
      <Card>
        <CardHeader>
          <CardTitle>Order History</CardTitle>
          <CardDescription>{filteredOrders?.length ?? 0} order(s) found</CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedStoreId ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Receipt className="h-8 w-8 mb-2" />
              <p>Please select a store to view orders.</p>
            </div>
          ) : !orders ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredOrders?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Receipt className="h-8 w-8 mb-2" />
              <p>No orders found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Table/Customer</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders?.map((order) => (
                  <TableRow key={order._id}>
                    <TableCell className="font-medium">{order.orderNumber}</TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {order.orderType === "dine_in" ? (
                          <UtensilsCrossed className="h-3 w-3" />
                        ) : (
                          <ShoppingBag className="h-3 w-3" />
                        )}
                        {order.orderType === "dine_in" ? "Dine-in" : "Takeout"}
                      </div>
                    </TableCell>
                    <TableCell>{order.tableName || order.customerName || "-"}</TableCell>
                    <TableCell>{order.itemCount}</TableCell>
                    <TableCell>{formatCurrency(order.netSales)}</TableCell>
                    <TableCell>{getStatusBadge(order.status)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedOrderId(order._id)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Order Details Dialog */}
      <Dialog open={!!selectedOrderId} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Order {orderDetails?.orderNumber}</DialogTitle>
            <DialogDescription>
              {orderDetails && formatDate(orderDetails.createdAt)}
            </DialogDescription>
          </DialogHeader>

          {!orderDetails ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Order Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Type:</span>{" "}
                  {orderDetails.orderType === "dine_in" ? "Dine-in" : "Takeout"}
                </div>
                <div>
                  <span className="text-gray-500">Status:</span>{" "}
                  {getStatusBadge(orderDetails.status)}
                </div>
                {orderDetails.tableName && (
                  <div>
                    <span className="text-gray-500">Table:</span> {orderDetails.tableName}
                  </div>
                )}
                {orderDetails.customerName && (
                  <div>
                    <span className="text-gray-500">Customer:</span> {orderDetails.customerName}
                  </div>
                )}
              </div>

              {/* Order Items */}
              <div className="border rounded-lg">
                <div className="bg-gray-50 px-3 py-2 border-b font-medium text-sm">Items</div>
                <div className="divide-y max-h-[200px] overflow-y-auto">
                  {orderDetails.items.map((item, index) => (
                    <div
                      key={index}
                      className={`px-3 py-2 flex justify-between text-sm ${
                        item.isVoided ? "line-through text-gray-400" : ""
                      }`}
                    >
                      <span>
                        {item.quantity}x {item.productName}
                      </span>
                      <span>{formatCurrency(item.lineTotal)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order Totals */}
              <div className="border rounded-lg">
                <div className="bg-gray-50 px-3 py-2 border-b font-medium text-sm">Summary</div>
                <div className="px-3 py-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Gross Sales</span>
                    <span>{formatCurrency(orderDetails.grossSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>VAT</span>
                    <span>{formatCurrency(orderDetails.vatAmount)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t">
                    <span>Total</span>
                    <span>{formatCurrency(orderDetails.netSales)}</span>
                  </div>
                </div>
              </div>

              {/* Payment Info */}
              {orderDetails.paymentMethod && (
                <div className="text-sm text-gray-500">Paid via {orderDetails.paymentMethod}</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
