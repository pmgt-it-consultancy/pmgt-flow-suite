"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface OrderSummary {
  _id: string;
  orderNumber?: string;
  orderType: "dine_in" | "takeout";
  netSales: number;
  createdAt: number;
}

interface BulkVoidConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrders: OrderSummary[];
  onConfirm: () => void;
}

function formatAge(createdAt: number): string {
  const days = Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function formatCurrency(amount: number): string {
  return `₱${amount.toFixed(2)}`;
}

export function BulkVoidConfirmDialog({
  open,
  onOpenChange,
  selectedOrders,
  onConfirm,
}: BulkVoidConfirmDialogProps) {
  const totalAmount = selectedOrders.reduce((sum, o) => sum + o.netSales, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Void {selectedOrders.length} Orders?</DialogTitle>
          <DialogDescription>
            These orders will be voided with reason "Bulk void - abandoned order". This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-60 overflow-y-auto divide-y">
          {selectedOrders.map((order) => (
            <div key={order._id} className="flex items-center justify-between py-2 px-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{order.orderNumber}</span>
                <Badge variant="outline" className="text-xs">
                  {order.orderType === "dine_in" ? "Dine-in" : "Takeout"}
                </Badge>
                <span className="text-xs text-gray-500">{formatAge(order.createdAt)}</span>
              </div>
              <span className="text-sm font-medium">{formatCurrency(order.netSales)}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center pt-2 border-t font-medium">
          <span>Total</span>
          <span>{formatCurrency(totalAmount)}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Continue to Approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
