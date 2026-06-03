"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { Eye, Receipt, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { useMemo, useState } from "react";
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
import { formatCurrency } from "@/lib/format";
import { useAdminStore } from "@/stores/useAdminStore";
import { AdminDataControls } from "../_shared/AdminDataControls";
import {
  BulkVoidConfirmDialog,
  BulkVoidFooter,
  ManagerPinDialog,
  RefundItemDialog,
} from "./_components";
import { useBulkVoid } from "./_hooks";

type OrderStatus = "open" | "paid" | "voided";
type OrderTypeFilter = "all" | "dine_in" | "takeout";
type DateFilter = "all" | "today" | "7d" | "30d";
type AmountFilter = "all" | "zero" | "under500" | "500to2000" | "over2000";
type OrderSort = "newest" | "oldest" | "amount-high" | "amount-low" | "items";

function isSameLocalDay(firstTimestamp: number, secondTimestamp: number) {
  const first = new Date(firstTimestamp);
  const second = new Date(secondTimestamp);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export default function OrdersPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<OrderTypeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [amountFilter, setAmountFilter] = useState<AmountFilter>("all");
  const [sortBy, setSortBy] = useState<OrderSort>("newest");
  const [selectedOrderId, setSelectedOrderId] = useState<Id<"orders"> | null>(null);
  const bulkVoid = useBulkVoid();

  // Refund state
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [refundData, setRefundData] = useState<{
    itemIds: Id<"orderItems">[];
    reason: string;
    refundMethod: "cash" | "card_ewallet";
  } | null>(null);
  const [showRefundPinDialog, setShowRefundPinDialog] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const voidPaidOrderAction = useAction(api.voids.voidPaidOrder);

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

  // Get receipt (payments array) when a paid order is selected
  const receipt = useQuery(
    api.checkout.getReceipt,
    selectedOrderId && orderDetails?.status === "paid" ? { orderId: selectedOrderId } : "skip",
  );

  const filteredOrders = useMemo(() => {
    const now = Date.now();
    const query = searchQuery.toLowerCase().trim();

    const filtered = orders?.filter((order) => {
      if (typeFilter !== "all" && order.orderType !== typeFilter) return false;

      if (dateFilter !== "all") {
        const ageMs = now - order.createdAt;
        if (dateFilter === "today" && !isSameLocalDay(order.createdAt, now)) return false;
        if (dateFilter === "7d" && ageMs > 7 * 24 * 60 * 60 * 1000) return false;
        if (dateFilter === "30d" && ageMs > 30 * 24 * 60 * 60 * 1000) return false;
      }

      if (amountFilter === "zero" && order.netSales !== 0) return false;
      if (amountFilter === "under500" && (order.netSales <= 0 || order.netSales >= 500)) {
        return false;
      }
      if (amountFilter === "500to2000" && (order.netSales < 500 || order.netSales > 2000)) {
        return false;
      }
      if (amountFilter === "over2000" && order.netSales <= 2000) return false;

      if (query) {
        const haystack = [
          order.orderNumber,
          order.customerName,
          order.tableName,
          order.tabName,
          order.orderType === "dine_in" ? "dine in dine-in table" : "takeout take out customer",
          order.status,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });

    return filtered?.toSorted((a, b) => {
      switch (sortBy) {
        case "oldest":
          return a.createdAt - b.createdAt;
        case "amount-high":
          return b.netSales - a.netSales || b.createdAt - a.createdAt;
        case "amount-low":
          return a.netSales - b.netSales || b.createdAt - a.createdAt;
        case "items":
          return b.itemCount - a.itemCount || b.createdAt - a.createdAt;
        default:
          return b.createdAt - a.createdAt;
      }
    });
  }, [orders, searchQuery, typeFilter, dateFilter, amountFilter, sortBy]);

  const activeFilterCount = useMemo(() => {
    return [
      searchQuery,
      statusFilter !== "all",
      typeFilter !== "all",
      dateFilter !== "all",
      amountFilter !== "all",
      sortBy !== "newest",
    ].filter(Boolean).length;
  }, [searchQuery, statusFilter, typeFilter, dateFilter, amountFilter, sortBy]);

  const orderSummary = useMemo(() => {
    const list = filteredOrders ?? [];
    return {
      totalSales: list.reduce((sum, order) => sum + order.netSales, 0),
      openCount: list.filter((order) => order.status === "open").length,
      paidCount: list.filter((order) => order.status === "paid").length,
      voidedCount: list.filter((order) => order.status === "voided").length,
    };
  }, [filteredOrders]);

  const getStatusBadge = (status: string, voids?: Array<{ voidType: string }>) => {
    if (status === "voided" && voids?.some((v) => v.voidType === "refund")) {
      return <Badge variant="destructive">Refund</Badge>;
    }
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

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  };

  const resetFilters = () => {
    setStatusFilter("all");
    setSearchQuery("");
    setTypeFilter("all");
    setDateFilter("all");
    setAmountFilter("all");
    setSortBy("newest");
    bulkVoid.exitSelectionMode();
  };

  const handleRefundConfirm = (
    itemIds: Id<"orderItems">[],
    reason: string,
    refundMethod: "cash" | "card_ewallet",
  ) => {
    setRefundData({ itemIds, reason, refundMethod });
    setShowRefundDialog(false);
    setShowRefundPinDialog(true);
  };

  const handleRefundPinSubmit = async (managerId: Id<"users">, pin: string) => {
    if (!refundData || !selectedOrderId) return;
    setIsRefunding(true);
    try {
      const result = await voidPaidOrderAction({
        orderId: selectedOrderId,
        refundedItemIds: refundData.itemIds,
        reason: refundData.reason,
        refundMethod: refundData.refundMethod,
        managerId,
        managerPin: pin,
      });

      if (result.success) {
        setShowRefundPinDialog(false);
        setSelectedOrderId(null);
        setRefundData(null);
      } else {
        const errorResult = result as { success: false; error: string };
        alert(errorResult.error);
      }
    } catch (error: any) {
      alert(error.message || "Failed to process refund");
    } finally {
      setIsRefunding(false);
    }
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

      <AdminDataControls
        searchValue={searchQuery}
        searchPlaceholder="Search order #, table, tab, customer, type, or status..."
        onSearchChange={setSearchQuery}
        activeFilterCount={activeFilterCount}
        onReset={resetFilters}
        resultLabel={`${filteredOrders?.length ?? 0} of ${orders?.length ?? 0} orders`}
      >
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as OrderStatus | "all");
            if (value !== "open") bulkVoid.exitSelectionMode();
          }}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="voided">Voided</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={typeFilter}
          onValueChange={(value) => setTypeFilter(value as OrderTypeFilter)}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="dine_in">Dine-in</SelectItem>
            <SelectItem value="takeout">Takeout</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dateFilter} onValueChange={(value) => setDateFilter(value as DateFilter)}>
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Dates</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={amountFilter}
          onValueChange={(value) => setAmountFilter(value as AmountFilter)}
        >
          <SelectTrigger className="h-11 w-full md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Totals</SelectItem>
            <SelectItem value="zero">Zero Total</SelectItem>
            <SelectItem value="under500">Under ₱500</SelectItem>
            <SelectItem value="500to2000">₱500-₱2,000</SelectItem>
            <SelectItem value="over2000">Over ₱2,000</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(value) => setSortBy(value as OrderSort)}>
          <SelectTrigger className="h-11 w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="amount-high">Total High-Low</SelectItem>
            <SelectItem value="amount-low">Total Low-High</SelectItem>
            <SelectItem value="items">Most Items</SelectItem>
          </SelectContent>
        </Select>
        {statusFilter === "open" && (
          <Button
            variant={bulkVoid.isSelectionMode ? "destructive" : "outline"}
            size="sm"
            className="h-11"
            onClick={
              bulkVoid.isSelectionMode ? bulkVoid.exitSelectionMode : bulkVoid.enterSelectionMode
            }
          >
            {bulkVoid.isSelectionMode ? "Cancel Selection" : "Select Orders"}
          </Button>
        )}
        {statusFilter !== "open" && (
          <Button
            variant="outline"
            size="sm"
            className="h-11"
            onClick={() => {
              setStatusFilter("open");
              bulkVoid.enterSelectionMode();
            }}
          >
            Bulk select open orders
          </Button>
        )}
      </AdminDataControls>

      {/* Orders List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Order History</CardTitle>
              <CardDescription>
                Latest 100 orders. Filter by operational state, type, total, and date.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">Open {orderSummary.openCount}</Badge>
              <Badge variant="outline">Paid {orderSummary.paidCount}</Badge>
              <Badge variant="outline">Voided {orderSummary.voidedCount}</Badge>
              <Badge variant="default">{formatCurrency(orderSummary.totalSales)}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedStoreId && orders && (
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              {bulkVoid.isSelectionMode
                ? "Select open orders using the checkboxes, then use the sticky footer to bulk void abandoned orders."
                : statusFilter === "open"
                  ? "Open orders can be selected for bulk void. Use Select Orders in the filter bar."
                  : "Need to void abandoned orders? Use Bulk select open orders in the filter bar."}
            </div>
          )}
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {bulkVoid.isSelectionMode && (
                      <TableHead className="w-10">
                        <input
                          aria-label="Select all visible orders"
                          type="checkbox"
                          checked={
                            (filteredOrders?.length ?? 0) > 0 &&
                            bulkVoid.selectedIds.size === (filteredOrders?.length ?? 0)
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              bulkVoid.selectAll(filteredOrders?.map((o) => o._id) ?? []);
                            } else {
                              bulkVoid.deselectAll();
                            }
                          }}
                          className="h-5 w-5 rounded border-gray-300"
                        />
                      </TableHead>
                    )}
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
                      {bulkVoid.isSelectionMode && (
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={bulkVoid.selectedIds.has(order._id)}
                            onChange={() => bulkVoid.toggleSelection(order._id)}
                            aria-label={`Select order ${order.orderNumber ?? order._id}`}
                            className="h-5 w-5 rounded border-gray-300"
                          />
                        </TableCell>
                      )}
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
                      <TableCell>
                        {order.orderType === "dine_in" ? (
                          <div className="flex flex-col">
                            <span>{order.tableName || "-"}</span>
                            {order.tabName && (
                              <span className="text-xs text-gray-500">{order.tabName}</span>
                            )}
                          </div>
                        ) : (
                          order.customerName || "-"
                        )}
                      </TableCell>
                      <TableCell>{order.itemCount}</TableCell>
                      <TableCell>{formatCurrency(order.netSales)}</TableCell>
                      <TableCell>{getStatusBadge(order.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`View order ${order.orderNumber ?? order._id}`}
                          onClick={() => setSelectedOrderId(order._id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Void Footer */}
      {bulkVoid.isSelectionMode && (
        <BulkVoidFooter
          selectedCount={bulkVoid.selectedIds.size}
          onVoidSelected={bulkVoid.startBulkVoid}
          onCancelSelection={bulkVoid.exitSelectionMode}
        />
      )}

      {/* Bulk Void Confirm Dialog */}
      <BulkVoidConfirmDialog
        open={bulkVoid.showConfirmDialog}
        onOpenChange={bulkVoid.setShowConfirmDialog}
        selectedOrders={
          filteredOrders
            ?.filter((o) => bulkVoid.selectedIds.has(o._id))
            .map((o) => ({
              _id: o._id,
              orderNumber: o.orderNumber,
              orderType: o.orderType,
              netSales: o.netSales,
              createdAt: o.createdAt,
            })) ?? []
        }
        onConfirm={bulkVoid.handleConfirm}
      />

      {/* Manager PIN Dialog */}
      {selectedStoreId && (
        <ManagerPinDialog
          open={bulkVoid.showPinDialog}
          onOpenChange={bulkVoid.setShowPinDialog}
          storeId={selectedStoreId}
          onSubmit={bulkVoid.handlePinSubmit}
          isSubmitting={bulkVoid.isSubmitting}
        />
      )}

      {/* Order Details Dialog */}
      <Dialog open={!!selectedOrderId} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Order {orderDetails?.orderNumber}
              {orderDetails && getStatusBadge(orderDetails.status, orderDetails.voids)}
            </DialogTitle>
            <DialogDescription>
              {orderDetails && formatDate(orderDetails.createdAt)}
              {orderDetails?.createdByName && ` · Cashier: ${orderDetails.createdByName}`}
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
                {orderDetails.tableName && (
                  <div>
                    <span className="text-gray-500">Table:</span> {orderDetails.tableName}
                  </div>
                )}
                {orderDetails.tabName && orderDetails.orderType === "dine_in" && (
                  <div>
                    <span className="text-gray-500">Tab:</span> {orderDetails.tabName}
                    {orderDetails.tabNumber && (
                      <span className="text-gray-400 text-xs ml-1">
                        (#{orderDetails.tabNumber})
                      </span>
                    )}
                  </div>
                )}
                {orderDetails.pax && orderDetails.orderType === "dine_in" && (
                  <div>
                    <span className="text-gray-500">Guests:</span> {orderDetails.pax}
                  </div>
                )}
                {orderDetails.customerName && (
                  <div>
                    <span className="text-gray-500">Customer:</span> {orderDetails.customerName}
                  </div>
                )}
                {orderDetails.tableMarker && (
                  <div>
                    <span className="text-gray-500">Table Marker:</span> {orderDetails.tableMarker}
                  </div>
                )}
                {orderDetails.orderCategory && (
                  <div>
                    <span className="text-gray-500">Category:</span>{" "}
                    {orderDetails.orderCategory === "dine_in" ? "Dine-in" : "Takeout"}
                  </div>
                )}
                {orderDetails.paidAt && (
                  <div>
                    <span className="text-gray-500">Paid:</span> {formatDate(orderDetails.paidAt)}
                  </div>
                )}
              </div>

              {/* Order Items */}
              <div className="border rounded-lg">
                <div className="bg-gray-50 px-3 py-2 border-b font-medium text-sm">Items</div>
                <div className="divide-y max-h-[250px] overflow-y-auto">
                  {orderDetails.items.map((item, index) => {
                    const orderDefault = orderDetails.orderCategory
                      ? orderDetails.orderCategory === "dine_in"
                        ? "dine_in"
                        : "takeout"
                      : orderDetails.orderType === "dine_in"
                        ? "dine_in"
                        : "takeout";
                    const itemType = item.serviceType ?? orderDefault;
                    const isException = itemType !== orderDefault;

                    return (
                      <div
                        key={index}
                        className={`px-3 py-2 text-sm ${
                          item.isVoided ? "line-through text-gray-400" : ""
                        }`}
                      >
                        <div className="flex justify-between">
                          <span>
                            {item.quantity}x {item.productName}
                            {isException && (
                              <span className="ml-2 inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                                {itemType === "takeout" ? "TAKEOUT" : "DINE IN"}
                              </span>
                            )}
                          </span>
                          <span>{formatCurrency(item.lineTotal)}</span>
                        </div>
                        {item.modifiers.length > 0 && (
                          <div className="mt-0.5 space-y-0.5">
                            {item.modifiers.map((mod, modIdx) => (
                              <div key={modIdx} className="text-xs text-gray-500 pl-4">
                                + {mod.optionName}
                                {mod.priceAdjustment > 0 && (
                                  <span className="ml-1">
                                    ({formatCurrency(mod.priceAdjustment)})
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {item.notes && (
                          <div className="text-xs text-gray-500 pl-4 italic mt-0.5">
                            Note: {item.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                  <div className="flex justify-between text-gray-500">
                    <span>Vatable Sales</span>
                    <span>{formatCurrency(orderDetails.vatableSales)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>VAT (12%)</span>
                    <span>{formatCurrency(orderDetails.vatAmount)}</span>
                  </div>
                  {orderDetails.vatExemptSales > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>VAT-Exempt Sales</span>
                      <span>{formatCurrency(orderDetails.vatExemptSales)}</span>
                    </div>
                  )}
                  {orderDetails.discountAmount > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Discount</span>
                      <span>-{formatCurrency(orderDetails.discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold pt-1 border-t">
                    <span>Total</span>
                    <span>{formatCurrency(orderDetails.netSales)}</span>
                  </div>
                </div>
              </div>

              {/* Discount Details */}
              {orderDetails.discounts?.length > 0 && (
                <div className="border rounded-lg">
                  <div className="bg-gray-50 px-3 py-2 border-b font-medium text-sm">
                    Discounts Applied
                  </div>
                  <div className="divide-y">
                    {orderDetails.discounts.map((discount, idx) => (
                      <div key={idx} className="px-3 py-2 text-sm">
                        <div className="flex justify-between">
                          <span className="font-medium">
                            {discount.discountType === "senior_citizen"
                              ? "Senior Citizen"
                              : discount.discountType === "pwd"
                                ? "PWD"
                                : discount.discountType === "promo"
                                  ? "Promo"
                                  : "Manual"}
                          </span>
                          <span>-{formatCurrency(discount.discountAmount)}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {discount.customerName}
                          {discount.customerId && ` · ID: ${discount.customerId}`}
                          {discount.quantityApplied > 1 && ` · Qty: ${discount.quantityApplied}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Void Details */}
              {orderDetails.voids.length > 0 && (
                <div className="border rounded-lg border-red-200 bg-red-50/40">
                  <div className="bg-red-50 px-3 py-2 border-b border-red-200 font-medium text-sm text-red-900">
                    Void Details
                  </div>
                  <div className="divide-y divide-red-100">
                    {orderDetails.voids.map((voidRecord) => (
                      <div key={voidRecord._id} className="px-3 py-2 text-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-medium text-red-900">
                              {voidRecord.voidType === "full_order"
                                ? "Full order void"
                                : "Voided item"}
                            </div>
                            <div className="mt-1 text-red-800">{voidRecord.reason}</div>
                          </div>
                          <div className="text-right text-xs text-red-700">
                            <div>{formatDate(voidRecord.createdAt)}</div>
                            <div>Approved by {voidRecord.approvedByName}</div>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-red-700">
                          Requested by {voidRecord.requestedByName}
                          {voidRecord.amount > 0 && ` · ${formatCurrency(voidRecord.amount)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment Info */}
              {receipt?.payments?.length || orderDetails.paymentMethod ? (
                <div className="border rounded-lg">
                  <div className="bg-gray-50 px-3 py-2 border-b font-medium text-sm">Payment</div>
                  <div className="px-3 py-2 space-y-1 text-sm">
                    {receipt?.payments?.length ? (
                      <>
                        {receipt.payments.map((payment, index) => (
                          <div key={index} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              {payment.paymentMethod === "cash"
                                ? "Cash"
                                : payment.cardPaymentType || "Card/E-Wallet"}
                            </span>
                            <span>₱{payment.amount.toFixed(2)}</span>
                          </div>
                        ))}
                        {receipt.payments.some(
                          (p) => p.paymentMethod === "cash" && p.cashReceived,
                        ) && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Amount Tendered</span>
                              <span>
                                ₱
                                {receipt.payments
                                  .filter((p) => p.paymentMethod === "cash")
                                  .reduce((sum, p) => sum + (p.cashReceived ?? 0), 0)
                                  .toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Change</span>
                              <span>
                                ₱
                                {receipt.payments
                                  .filter((p) => p.paymentMethod === "cash")
                                  .reduce((sum, p) => sum + (p.changeGiven ?? 0), 0)
                                  .toFixed(2)}
                              </span>
                            </div>
                          </>
                        )}
                        {receipt.payments
                          .filter(
                            (p) => p.paymentMethod === "card_ewallet" && p.cardReferenceNumber,
                          )
                          .map((payment, index) => (
                            <div key={`ref-${index}`} className="flex justify-between text-sm">
                              <span className="text-muted-foreground">
                                Ref # ({payment.cardPaymentType})
                              </span>
                              <span className="font-mono">{payment.cardReferenceNumber}</span>
                            </div>
                          ))}
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Method</span>
                          <span>
                            {orderDetails.paymentMethod === "cash"
                              ? "Cash"
                              : orderDetails.cardPaymentType || "Card/E-Wallet"}
                          </span>
                        </div>
                        {orderDetails.paymentMethod === "cash" &&
                          orderDetails.cashReceived != null && (
                            <>
                              <div className="flex justify-between">
                                <span className="text-gray-500">Cash Received</span>
                                <span>{formatCurrency(orderDetails.cashReceived)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500">Change</span>
                                <span>{formatCurrency(orderDetails.changeGiven ?? 0)}</span>
                              </div>
                            </>
                          )}
                        {orderDetails.paymentMethod === "card_ewallet" &&
                          orderDetails.cardReferenceNumber && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Reference #</span>
                              <span className="font-mono">{orderDetails.cardReferenceNumber}</span>
                            </div>
                          )}
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Refund action for paid orders */}
              {orderDetails?.status === "paid" && (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => setShowRefundDialog(true)}
                >
                  Refund Item
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Refund Item Dialog */}
      {orderDetails && (
        <RefundItemDialog
          open={showRefundDialog}
          onOpenChange={setShowRefundDialog}
          items={orderDetails.items.map((i) => ({
            _id: i._id,
            productName: i.productName,
            productPrice: i.productPrice,
            quantity: i.quantity,
            lineTotal: i.lineTotal,
            isVoided: i.isVoided,
          }))}
          onConfirm={handleRefundConfirm}
        />
      )}

      {/* Refund Manager PIN Dialog */}
      {selectedStoreId && (
        <ManagerPinDialog
          open={showRefundPinDialog}
          onOpenChange={(open) => {
            setShowRefundPinDialog(open);
            if (!open) setRefundData(null);
          }}
          storeId={selectedStoreId}
          onSubmit={handleRefundPinSubmit}
          isSubmitting={isRefunding}
        />
      )}
    </div>
  );
}
