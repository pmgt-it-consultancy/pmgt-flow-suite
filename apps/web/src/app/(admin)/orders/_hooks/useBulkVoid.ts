"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export function useBulkVoid() {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const bulkVoidAction = useAction(api.voids.bulkVoidOrders);

  const toggleSelection = useCallback((orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((orderIds: string[]) => {
    setSelectedIds(new Set(orderIds));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const enterSelectionMode = useCallback(() => {
    setIsSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const startBulkVoid = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowConfirmDialog(true);
  }, [selectedIds]);

  const handleConfirm = useCallback(() => {
    setShowConfirmDialog(false);
    setShowPinDialog(true);
  }, []);

  const handlePinSubmit = useCallback(
    async (managerId: Id<"users">, pin: string) => {
      setIsSubmitting(true);
      try {
        const result = await bulkVoidAction({
          orderIds: Array.from(selectedIds) as Id<"orders">[],
          managerId,
          managerPin: pin,
        });

        if (result.success) {
          const msg =
            result.skippedCount > 0
              ? `${result.voidedCount} orders voided, ${result.skippedCount} skipped`
              : `${result.voidedCount} orders voided successfully`;
          toast.success(msg);
          setShowPinDialog(false);
          exitSelectionMode();
        } else {
          toast.error(result.error);
        }
      } catch {
        toast.error("Failed to void orders");
      } finally {
        setIsSubmitting(false);
      }
    },
    [bulkVoidAction, selectedIds, exitSelectionMode],
  );

  return {
    isSelectionMode,
    selectedIds,
    showConfirmDialog,
    showPinDialog,
    isSubmitting,
    toggleSelection,
    selectAll,
    deselectAll,
    enterSelectionMode,
    exitSelectionMode,
    startBulkVoid,
    handleConfirm,
    handlePinSubmit,
    setShowConfirmDialog,
    setShowPinDialog,
  };
}
