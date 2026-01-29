"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ChevronRight, Clock, Plus, ShoppingBag, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency, formatTime } from "@/lib/format";
import { useAdminStore } from "@/stores/useAdminStore";

const takeoutStatusLabels: Record<string, string> = {
  pending: "Pending",
  preparing: "Preparing",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

const takeoutStatusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  preparing: "default",
  ready_for_pickup: "outline",
  completed: "default",
  cancelled: "destructive",
};

const nextStatusLabel: Record<string, string> = {
  pending: "Start Preparing",
  preparing: "Mark Ready",
  ready_for_pickup: "Complete",
};

type TakeoutStatus = "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";

function getNextStatus(current: string): TakeoutStatus | null {
  const transitions: Record<string, TakeoutStatus> = {
    pending: "preparing",
    preparing: "ready_for_pickup",
    ready_for_pickup: "completed",
  };
  return transitions[current] ?? null;
}

export default function TakeoutOrdersPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const [cancelOrderId, setCancelOrderId] = useState<Id<"orders"> | null>(null);

  const takeoutOrders = useQuery(
    api.orders.getTakeoutOrders,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  const updateTakeoutStatus = useMutation(api.orders.updateTakeoutStatus);

  const handleAdvanceStatus = async (orderId: Id<"orders">, currentStatus: string) => {
    const nextStatus = getNextStatus(currentStatus);
    if (!nextStatus) return;

    try {
      await updateTakeoutStatus({
        orderId,
        newStatus: nextStatus,
      });
      toast.success(`Order updated to ${takeoutStatusLabels[nextStatus]}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to update status");
    }
  };

  const handleCancelOrder = async () => {
    if (!cancelOrderId) return;
    try {
      await updateTakeoutStatus({
        orderId: cancelOrderId,
        newStatus: "cancelled",
      });
      toast.success("Order cancelled");
    } catch (error: any) {
      toast.error(error.message || "Failed to cancel order");
    } finally {
      setCancelOrderId(null);
    }
  };

  // Separate active vs completed/cancelled
  const activeOrders =
    takeoutOrders?.filter(
      (o) => o.takeoutStatus && !["completed", "cancelled"].includes(o.takeoutStatus),
    ) ?? [];
  const completedOrders =
    takeoutOrders?.filter(
      (o) => o.takeoutStatus && ["completed", "cancelled"].includes(o.takeoutStatus),
    ) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/pos")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Takeout Orders</h1>
            <p className="text-gray-500">Today's takeout orders</p>
          </div>
        </div>
        <Button onClick={() => router.push("/pos/takeout/new")}>
          <Plus className="h-4 w-4 mr-2" />
          New Order
        </Button>
      </div>

      {/* Active Orders */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Orders ({activeOrders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {activeOrders.length > 0 ? (
            <div className="space-y-3">
              {activeOrders.map((order) => {
                const nextStatus = order.takeoutStatus ? getNextStatus(order.takeoutStatus) : null;
                return (
                  <div
                    key={order._id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <ShoppingBag className="h-5 w-5 text-orange-500" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{order.orderNumber}</span>
                          <Badge variant={takeoutStatusColors[order.takeoutStatus ?? "pending"]}>
                            {takeoutStatusLabels[order.takeoutStatus ?? "pending"]}
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-500">
                          {order.customerName || "No name"} &middot; {order.itemCount} items
                          &middot; {formatCurrency(order.netSales)}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Clock className="h-3 w-3" />
                          {formatTime(order.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {nextStatus && (
                        <Button
                          size="sm"
                          onClick={() => handleAdvanceStatus(order._id, order.takeoutStatus!)}
                        >
                          {nextStatusLabel[order.takeoutStatus!]}
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      )}
                      {order.takeoutStatus !== "ready_for_pickup" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => setCancelOrderId(order._id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-gray-500">
              No active takeout orders
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completed / Cancelled */}
      {completedOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-gray-500">
              Completed / Cancelled ({completedOrders.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {completedOrders.map((order) => (
                <div
                  key={order._id}
                  className="flex items-center justify-between p-3 border rounded-lg opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{order.orderNumber}</span>
                    <span className="text-sm text-gray-500">{order.customerName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={takeoutStatusColors[order.takeoutStatus ?? "completed"]}>
                      {takeoutStatusLabels[order.takeoutStatus ?? "completed"]}
                    </Badge>
                    <span className="text-sm">{formatCurrency(order.netSales)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={!!cancelOrderId} onOpenChange={() => setCancelOrderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this takeout order? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelOrder} className="bg-red-600 hover:bg-red-700">
              Yes, cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
