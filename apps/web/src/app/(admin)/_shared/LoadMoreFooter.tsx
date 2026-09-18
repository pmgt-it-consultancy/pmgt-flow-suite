"use client";

import type { PaginationStatus } from "convex/react";
import { Button } from "@/components/ui/button";

interface LoadMoreFooterProps {
  status: PaginationStatus;
  loadedCount: number;
  itemLabel: string;
  pageSize: number;
  onLoadMore: (numItems: number) => void;
}

export function LoadMoreFooter({
  status,
  loadedCount,
  itemLabel,
  pageSize,
  onLoadMore,
}: LoadMoreFooterProps) {
  if (loadedCount === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
      <span>
        Showing {loadedCount} loaded {itemLabel}
        {status === "Exhausted" && " — all caught up"}
      </span>
      {status !== "Exhausted" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onLoadMore(pageSize)}
          disabled={status === "LoadingMore" || status === "LoadingFirstPage"}
        >
          {status === "LoadingMore" ? "Loading..." : "Load more"}
        </Button>
      )}
    </div>
  );
}
