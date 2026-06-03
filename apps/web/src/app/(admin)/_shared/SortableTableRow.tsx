"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface SortableTableRowProps {
  id: string;
  children:
    | ReactNode
    | ((dragHandleProps: {
        attributes: ReturnType<typeof useSortable>["attributes"];
        listeners: ReturnType<typeof useSortable>["listeners"];
      }) => ReactNode);
  className?: string;
}

export function SortableTableRow({ id, children, className }: SortableTableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "relative z-10 bg-blue-50 shadow-sm", className)}
      data-state={isDragging ? "selected" : undefined}
    >
      {typeof children === "function"
        ? (
            children as (dragHandleProps: {
              attributes: ReturnType<typeof useSortable>["attributes"];
              listeners: ReturnType<typeof useSortable>["listeners"];
            }) => ReactNode
          )({ attributes, listeners })
        : children}
    </TableRow>
  );
}
