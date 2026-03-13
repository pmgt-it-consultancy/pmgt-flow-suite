"use client";

import { Button } from "@/components/ui/button";

interface BulkVoidFooterProps {
  selectedCount: number;
  onVoidSelected: () => void;
  onCancelSelection: () => void;
}

export function BulkVoidFooter({
  selectedCount,
  onVoidSelected,
  onCancelSelection,
}: BulkVoidFooterProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-0 z-50 bg-white border-t shadow-lg px-6 py-4 flex items-center justify-between">
      <span className="text-sm font-medium text-gray-700">
        {selectedCount} order{selectedCount !== 1 ? "s" : ""} selected
      </span>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onCancelSelection}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onVoidSelected}>
          Void Selected
        </Button>
      </div>
    </div>
  );
}
