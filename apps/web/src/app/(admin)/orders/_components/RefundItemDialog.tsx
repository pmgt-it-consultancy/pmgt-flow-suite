"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";

interface OrderItem {
  _id: Id<"orderItems">;
  productName: string;
  productPrice: number;
  quantity: number;
  lineTotal: number;
  isVoided: boolean;
}

interface RefundItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: OrderItem[];
  onConfirm: (
    refundedItemIds: Id<"orderItems">[],
    reason: string,
    refundMethod: "cash" | "card_ewallet",
  ) => void;
}

export function RefundItemDialog({ open, onOpenChange, items, onConfirm }: RefundItemDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card_ewallet">("cash");

  const activeItems = items.filter((i) => !i.isVoided);

  const toggleItem = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const refundTotal = activeItems
    .filter((i) => selectedIds.has(i._id.toString()))
    .reduce((sum, i) => sum + i.lineTotal, 0);

  const canSubmit = selectedIds.size > 0 && reason.trim().length > 0;

  const handleConfirm = () => {
    if (!canSubmit) return;
    const ids = Array.from(selectedIds).map((id) => id as Id<"orderItems">);
    onConfirm(ids, reason.trim(), refundMethod);
    handleReset();
  };

  const handleReset = () => {
    setSelectedIds(new Set());
    setReason("");
    setRefundMethod("cash");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleReset();
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Refund Items</DialogTitle>
          <DialogDescription>
            Select items to remove from this order. A new order will be created with the remaining
            items.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Item selection */}
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {activeItems.map((item) => (
              <label
                key={item._id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedIds.has(item._id.toString())
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item._id.toString())}
                  onChange={() => toggleItem(item._id.toString())}
                  className="rounded border-gray-300"
                />
                <span className="flex-1 text-sm font-medium">
                  {item.quantity}x {item.productName}
                </span>
                <span className="text-sm font-semibold">{formatCurrency(item.lineTotal)}</span>
              </label>
            ))}
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label>Reason for refund</Label>
            <Textarea
              placeholder="Enter reason..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>

          {/* Refund method */}
          <div className="space-y-2">
            <Label>Refund method</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={refundMethod === "cash" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setRefundMethod("cash")}
              >
                Cash
              </Button>
              <Button
                type="button"
                variant={refundMethod === "card_ewallet" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setRefundMethod("card_ewallet")}
              >
                Card / E-Wallet
              </Button>
            </div>
          </div>

          {/* Refund total */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 border border-red-200">
              <span className="text-sm font-medium text-red-800">
                Refund Amount ({selectedIds.size} item{selectedIds.size > 1 ? "s" : ""})
              </span>
              <span className="text-lg font-bold text-red-800">{formatCurrency(refundTotal)}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!canSubmit} onClick={handleConfirm}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
