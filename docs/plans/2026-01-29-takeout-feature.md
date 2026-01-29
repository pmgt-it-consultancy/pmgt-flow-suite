# Takeout Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a takeout order flow with a new POS home dashboard, separate takeout order list, tap-to-advance status workflow, and `orderChannel` field for future delivery platform integration.

**Architecture:** New POS home page replaces `/dashboard` as the cashier entry point, with two main flows: Dine-In (existing) and Takeout (new). Takeout orders skip table assignment, require customer name, use daily-resetting `T-XXX` numbering, and follow a `pending → preparing → ready_for_pickup → completed / cancelled` workflow. Backend extends the existing `orders` schema with `orderChannel` and `takeoutStatus` fields.

**Tech Stack:** Convex backend, Next.js 16 App Router, Tailwind CSS, shadcn/ui, Zustand, Lucide icons

---

### Task 1: Add `orderChannel` and `takeoutStatus` fields to schema

**Files:**
- Modify: `packages/backend/convex/schema.ts`

**Step 1: Update the orders table schema**

In `packages/backend/convex/schema.ts`, add two new fields to the `orders` table definition:

```typescript
// Add after the existing `orderType` field (line ~112):
orderChannel: v.optional(v.union(
  v.literal("walk_in_dine_in"),
  v.literal("walk_in_takeout"),
  v.literal("grab"),
  v.literal("foodpanda"),
  v.literal("custom_delivery"),
)),
takeoutStatus: v.optional(v.union(
  v.literal("pending"),
  v.literal("preparing"),
  v.literal("ready_for_pickup"),
  v.literal("completed"),
  v.literal("cancelled"),
)),
```

No new indexes needed — takeout orders are queried by `by_store_status` (status="open") and filtered client-side.

**Step 2: Verify schema deploys**

Run: `cd packages/backend && npx convex dev` (should push schema without errors)
Expected: Schema deployed successfully

**Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat: add orderChannel and takeoutStatus fields to orders schema"
```

---

### Task 2: Update order creation to set `orderChannel` and `takeoutStatus`

**Files:**
- Modify: `packages/backend/convex/orders.ts`

**Step 1: Update the `create` mutation**

In the `create` mutation handler (line ~72), add `orderChannel` and `takeoutStatus` to the insert:

```typescript
// In the create mutation, after building the order object:
const orderChannel = args.orderType === "dine_in" ? "walk_in_dine_in" : "walk_in_takeout";
const takeoutStatus = args.orderType === "takeout" ? "pending" : undefined;

// Add to the ctx.db.insert("orders", { ... }) call:
orderChannel,
takeoutStatus,
```

Also update `createAndSendToKitchen` (line ~834) to include:
```typescript
orderChannel: "walk_in_dine_in",
takeoutStatus: undefined,
```

**Step 2: Verify existing order creation still works**

Run: `cd packages/backend && npx convex dev`
Expected: Functions deployed, no type errors

**Step 3: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat: set orderChannel and takeoutStatus on order creation"
```

---

### Task 3: Add takeout status update mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts`

**Step 1: Add the `updateTakeoutStatus` mutation**

Add this after the `updateCustomerName` mutation (around line 635):

```typescript
// Update takeout order status (advance workflow)
export const updateTakeoutStatus = mutation({
  args: {
    orderId: v.id("orders"),
    newStatus: v.union(
      v.literal("pending"),
      v.literal("preparing"),
      v.literal("ready_for_pickup"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.orderType !== "takeout") throw new Error("Not a takeout order");

    // Validate status transitions
    const currentStatus = order.takeoutStatus;
    const validTransitions: Record<string, string[]> = {
      pending: ["preparing", "cancelled"],
      preparing: ["ready_for_pickup", "cancelled"],
      ready_for_pickup: ["completed"],
    };

    if (currentStatus && validTransitions[currentStatus]) {
      if (!validTransitions[currentStatus].includes(args.newStatus)) {
        throw new Error(
          `Cannot transition from ${currentStatus} to ${args.newStatus}`
        );
      }
    }

    await ctx.db.patch(args.orderId, { takeoutStatus: args.newStatus });
    return null;
  },
});
```

**Step 2: Add `getTakeoutOrders` query**

Add this query to get today's takeout orders for the store:

```typescript
// Get today's takeout orders for a store
export const getTakeoutOrders = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.string(),
      customerName: v.optional(v.string()),
      status: v.union(v.literal("open"), v.literal("paid"), v.literal("voided")),
      takeoutStatus: v.optional(v.union(
        v.literal("pending"),
        v.literal("preparing"),
        v.literal("ready_for_pickup"),
        v.literal("completed"),
        v.literal("cancelled"),
      )),
      netSales: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay),
      )
      .filter((q) => q.eq(q.field("orderType"), "takeout"))
      .order("desc")
      .collect();

    const results = await Promise.all(
      orders.map(async (order) => {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .collect();

        const activeItems = items.filter((i) => !i.isVoided);
        const itemCount = activeItems.reduce((sum, i) => sum + i.quantity, 0);

        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          status: order.status,
          takeoutStatus: order.takeoutStatus,
          netSales: order.netSales,
          itemCount,
          createdAt: order.createdAt,
        };
      }),
    );

    return results;
  },
});
```

**Step 3: Verify deployment**

Run: `cd packages/backend && npx convex dev`
Expected: Both new functions deployed

**Step 4: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat: add takeout status update mutation and getTakeoutOrders query"
```

---

### Task 4: Add dashboard summary query

**Files:**
- Modify: `packages/backend/convex/orders.ts`

**Step 1: Add `getDashboardSummary` query**

Add this query for the home dashboard stats:

```typescript
// Get dashboard summary for POS home page
export const getDashboardSummary = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.object({
    totalOrdersToday: v.number(),
    activeDineIn: v.number(),
    activeTakeout: v.number(),
    todayRevenue: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    // Get all today's orders
    const todaysOrders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay),
      )
      .collect();

    const totalOrdersToday = todaysOrders.length;
    const activeDineIn = todaysOrders.filter(
      (o) => o.orderType === "dine_in" && o.status === "open"
    ).length;
    const activeTakeout = todaysOrders.filter(
      (o) => o.orderType === "takeout" && o.status === "open"
    ).length;
    const todayRevenue = todaysOrders
      .filter((o) => o.status === "paid")
      .reduce((sum, o) => sum + o.netSales, 0);

    return { totalOrdersToday, activeDineIn, activeTakeout, todayRevenue };
  },
});
```

**Step 2: Verify deployment**

Run: `cd packages/backend && npx convex dev`
Expected: Function deployed

**Step 3: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat: add getDashboardSummary query for POS home page"
```

---

### Task 5: Update existing queries to include `takeoutStatus`

**Files:**
- Modify: `packages/backend/convex/orders.ts`

**Step 1: Update the `get` query return type and handler**

In the `get` query (line ~108), add to the return type object:
```typescript
takeoutStatus: v.optional(v.union(
  v.literal("pending"),
  v.literal("preparing"),
  v.literal("ready_for_pickup"),
  v.literal("completed"),
  v.literal("cancelled"),
)),
```

And in the handler return object, add:
```typescript
takeoutStatus: order.takeoutStatus,
```

**Step 2: Update `listActive` query similarly**

Add `takeoutStatus` to the return type and handler of `listActive`.

**Step 3: Update `getTodaysOpenOrders` query similarly**

Add `takeoutStatus` to the return type and handler.

**Step 4: Verify deployment**

Run: `cd packages/backend && npx convex dev`
Expected: All queries updated without errors

**Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat: include takeoutStatus in existing order queries"
```

---

### Task 6: Create POS Home Page

**Files:**
- Create: `apps/web/src/app/(admin)/pos/page.tsx`

**Step 1: Create the POS home page**

Create `apps/web/src/app/(admin)/pos/page.tsx`:

```tsx
"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  Clock,
  Coffee,
  ShoppingBag,
  TrendingUp,
  UtensilsCrossed,
} from "lucide-react";
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
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome, {user?.name || "Cashier"}
          </h1>
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
          <span className="text-sm text-gray-500">
            {summary?.activeDineIn ?? 0} active orders
          </span>
        </Button>
        <Button
          variant="outline"
          className="h-40 flex flex-col items-center justify-center gap-4 text-lg border-2 hover:border-orange-500 hover:bg-orange-50"
          onClick={() => router.push("/pos/takeout")}
        >
          <ShoppingBag className="h-12 w-12 text-orange-500" />
          <span className="text-xl font-bold">Takeout</span>
          <span className="text-sm text-gray-500">
            {summary?.activeTakeout ?? 0} active orders
          </span>
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
                    <Badge
                      variant={order.orderType === "dine_in" ? "default" : "secondary"}
                    >
                      {order.orderType === "dine_in" ? "Dine-In" : "Takeout"}
                    </Badge>
                    <span className="text-sm text-gray-500">
                      {formatTime(order.createdAt)}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(order.subtotal)}
                    </span>
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
```

**Step 2: Verify the page renders**

Navigate to `/pos` in the browser.
Expected: Home page with welcome message, clock, stats, action buttons, and active orders list.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/pos/page.tsx
git commit -m "feat: add POS home page with dashboard summary and action buttons"
```

---

### Task 7: Create Takeout Orders Page

**Files:**
- Create: `apps/web/src/app/(admin)/pos/takeout/page.tsx`

**Step 1: Create the takeout orders list page**

Create `apps/web/src/app/(admin)/pos/takeout/page.tsx`:

```tsx
"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Plus,
  ShoppingBag,
  X,
} from "lucide-react";
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

function getNextStatus(current: string): string | null {
  const transitions: Record<string, string> = {
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
        newStatus: nextStatus as any,
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
  const activeOrders = takeoutOrders?.filter(
    (o) => o.takeoutStatus && !["completed", "cancelled"].includes(o.takeoutStatus),
  ) ?? [];
  const completedOrders = takeoutOrders?.filter(
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
          <CardTitle className="text-lg">
            Active Orders ({activeOrders.length})
          </CardTitle>
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
                          {order.customerName || "No name"} &middot;{" "}
                          {order.itemCount} items &middot;{" "}
                          {formatCurrency(order.netSales)}
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
                          onClick={() =>
                            handleAdvanceStatus(order._id, order.takeoutStatus!)
                          }
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
                    <span className="text-sm text-gray-500">
                      {order.customerName}
                    </span>
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
```

**Step 2: Verify**

Navigate to `/pos/takeout` in the browser.
Expected: Takeout orders list with New Order button, active/completed sections.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/pos/takeout/page.tsx
git commit -m "feat: add takeout orders list page with status management"
```

---

### Task 8: Create New Takeout Order Page

**Files:**
- Create: `apps/web/src/app/(admin)/pos/takeout/new/page.tsx`

**Step 1: Create the new takeout order page**

This page handles: customer name input → product selection → payment → order created.

Create `apps/web/src/app/(admin)/pos/takeout/new/page.tsx`:

```tsx
"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
  const categories = useQuery(
    api.categories.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const products = useQuery(
    api.products.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  const createOrder = useMutation(api.orders.create);
  const addItem = useMutation(api.orders.addItem);
  const sendToKitchen = useMutation(api.orders.sendToKitchen);

  const activeProducts = products?.filter((p) => p.isActive) ?? [];
  const filteredProducts = searchQuery
    ? activeProducts.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : activeProducts;

  const addToCart = (product: { _id: Id<"products">; name: string; price: number }) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product._id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product._id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
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

  const cartTotal = cart.reduce(
    (sum, item) => sum + item.productPrice * item.quantity,
    0,
  );

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
              <label className="text-sm font-medium mb-2 block">Customer Name *</label>
              <Input
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
                <p className="text-sm text-primary font-bold">
                  {formatCurrency(product.price)}
                </p>
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
                        <p className="text-sm font-medium truncate">
                          {item.productName}
                        </p>
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
                        <span className="w-8 text-center text-sm font-medium">
                          {item.quantity}
                        </span>
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
```

**Step 2: Verify**

Navigate to `/pos/takeout/new` in the browser.
Expected: Customer name input, product grid, cart sidebar, create button.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/pos/takeout/new/page.tsx
git commit -m "feat: add new takeout order page with product selection and cart"
```

---

### Task 9: Add POS navigation to sidebar

**Files:**
- Modify: `apps/web/src/components/admin/Sidebar.tsx`

**Step 1: Add POS Home nav item**

In `Sidebar.tsx`, add a new nav item at the top of the `navItems` array (after the Dashboard entry):

```typescript
import { ..., Home } from "lucide-react";

// Add as the second item in navItems array (after Dashboard):
{
  title: "POS Home",
  href: "/pos",
  icon: <Home className="h-5 w-5" />,
  permission: "orders.view",
},
```

**Step 2: Verify**

Check sidebar shows "POS Home" link.

**Step 3: Commit**

```bash
git add apps/web/src/components/admin/Sidebar.tsx
git commit -m "feat: add POS Home navigation item to sidebar"
```

---

### Task 10: Update `listActive` to include `takeoutStatus` for home page

**Files:**
- Modify: `packages/backend/convex/orders.ts`

**Step 1: Add `takeoutStatus` to `listActive` return type**

In the `listActive` query, add to the return type object:
```typescript
takeoutStatus: v.optional(v.union(
  v.literal("pending"),
  v.literal("preparing"),
  v.literal("ready_for_pickup"),
  v.literal("completed"),
  v.literal("cancelled"),
)),
```

And in the handler's return mapping, add:
```typescript
takeoutStatus: order.takeoutStatus,
```

**Step 2: Verify deployment**

Run: `cd packages/backend && npx convex dev`

**Step 3: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat: include takeoutStatus in listActive query"
```

---

### Task 11: Verify end-to-end flow

**Step 1: Test the full takeout flow**

1. Navigate to `/pos` — verify welcome message, clock, stats, action buttons
2. Click "Takeout" — verify takeout orders list loads
3. Click "New Order" — enter customer name, add products, click "Create & Send to Kitchen"
4. Verify order appears in takeout list with "Pending" status
5. Click "Start Preparing" — verify status changes to "Preparing"
6. Click "Mark Ready" — verify status changes to "Ready for Pickup"
7. Click "Complete" — verify order moves to completed section
8. Go back to `/pos` — verify active orders list shows the order updates

**Step 2: Test cancel flow**

1. Create another takeout order
2. Click the cancel (X) button
3. Confirm cancellation
4. Verify order shows as "Cancelled" in completed section

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: takeout feature - complete implementation"
```
