"use client";

import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AdminDataControlsProps {
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  children?: ReactNode;
  activeFilterCount?: number;
  onReset?: () => void;
  resultLabel?: string;
  className?: string;
}

export function AdminDataControls({
  searchValue,
  searchPlaceholder = "Search...",
  onSearchChange,
  children,
  activeFilterCount = 0,
  onReset,
  resultLabel,
  className,
}: AdminDataControlsProps) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          {onSearchChange && (
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={searchValue ?? ""}
                onChange={(event) => onSearchChange(event.target.value)}
                className="h-11 pl-10"
              />
            </div>
          )}
          {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
          <div className="flex items-center justify-between gap-3 xl:ml-auto">
            {resultLabel && (
              <span className="whitespace-nowrap text-sm font-medium text-muted-foreground">
                {resultLabel}
              </span>
            )}
            {onReset && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReset}
                disabled={activeFilterCount === 0}
                className={cn("h-10", activeFilterCount > 0 && "border-primary text-primary")}
              >
                <X className="mr-2 h-4 w-4" />
                Reset
                {activeFilterCount > 0 && (
                  <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
