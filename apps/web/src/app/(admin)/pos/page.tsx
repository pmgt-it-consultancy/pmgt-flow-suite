"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { Clock, Coffee, ShoppingBag, TrendingUp, UtensilsCrossed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency, formatTime } from "@/lib/format";
import { useAdminStore } from "@/stores/useAdminStore";

export default function PosHomePage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const [currentTime, setCurrentTime] = useState(new Date());

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Dashboard data
  const summary = useQuery(
    api.orders.getDashboardSummary,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  const activeOrders = useQuery(
    api.orders.listActive,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  const formatCurrentDate = () => {
    return currentTime.toLocaleDateString("en-PH", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatCurrentTime = () => {
    return currentTime.toLocaleTimeString("en-PH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome, {user?.name || "Cashier"}</h1>
          <p className="text-gray-500">{formatCurrentDate()}</p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 text-2xl font-mono font-bold text-primary">
            <Clock className="h-6 w-6" />
            {formatCurrentTime()}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{summary?.totalOrdersToday ?? 0}</div>
            <p className="text-xs text-gray-500">Total Orders Today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{summary?.activeDineIn ?? 0}</div>
            <p className="text-xs text-gray-500">Active Dine-In</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{summary?.activeTakeout ?? 0}</div>
            <p className="text-xs text-gray-500">Active Takeout</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-2xl font-bold">
                {formatCurrency(summary?.todayRevenue ?? 0)}
              </span>
            </div>
            <p className="text-xs text-gray-500">Today's Revenue</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Action Buttons */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        <Button
          variant="outline"
          className="h-40 flex flex-col items-center justify-center gap-4 text-lg border-2 hover:border-primary hover:bg-primary/5"
          onClick={() => router.push("/tables")}
        >
          <UtensilsCrossed className="h-12 w-12 text-primary" />
          <span className="text-xl font-bold">Dine-In</span>
          <span className="text-sm text-gray-500">{summary?.activeDineIn ?? 0} active orders</span>
        </Button>
        <Button
          variant="outline"
          className="h-40 flex flex-col items-center justify-center gap-4 text-lg border-2 hover:border-orange-500 hover:bg-orange-50"
          onClick={() => router.push("/pos/takeout")}
        >
          <ShoppingBag className="h-12 w-12 text-orange-500" />
          <span className="text-xl font-bold">Takeout</span>
          <span className="text-sm text-gray-500">{summary?.activeTakeout ?? 0} active orders</span>
        </Button>
      </div>

      {/* Active Orders Mini-List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {activeOrders && activeOrders.length > 0 ? (
            <div className="space-y-2">
              {activeOrders.slice(0, 10).map((order) => (
                <div
                  key={order._id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    {order.orderType === "dine_in" ? (
                      <UtensilsCrossed className="h-4 w-4 text-primary" />
                    ) : (
                      <ShoppingBag className="h-4 w-4 text-orange-500" />
                    )}
                    <div>
                      <span className="font-medium">{order.orderNumber}</span>
                      <span className="text-sm text-gray-500 ml-2">
                        {order.orderType === "dine_in"
                          ? order.tableName
                          : order.customerName || "No name"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={order.orderType === "dine_in" ? "default" : "secondary"}>
                      {order.orderType === "dine_in" ? "Dine-In" : "Takeout"}
                    </Badge>
                    <span className="text-sm text-gray-500">{formatTime(order.createdAt)}</span>
                    <span className="font-medium">{formatCurrency(order.subtotal)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-gray-500">
              <Coffee className="h-5 w-5 mr-2" />
              No active orders
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
