# Bulk Void Orders Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select bulk void to the web admin orders page so staff can review and void multiple stale open orders in one action.

**Architecture:** New Convex action `voids.bulkVoidOrders` reuses existing `voidOrderInternal` in a sequential loop with skip-on-failure semantics. Web frontend adds selection mode to the orders page with a sticky footer bar, confirmation dialog, and manager PIN dialog. Follows colocated page architecture with `_components/` and `_hooks/`.

**Tech Stack:** Convex (backend action + internal mutations), Next.js App Router, Radix UI Dialog, sonner toasts, bcrypt for PIN verification.

---

## Chunk 1: Backend

### Task 1: Add `bulkVoidOrders` action to backend

**Files:**
- Modify: `packages/backend/convex/voids.ts` (add new action after existing `voidOrder`)
- Modify: `packages/backend/convex/helpers/voidsHelpers.ts` (add table safety guard to `voidOrderInternal`)

- [ ] **Step 1: Add table release safety guard to `voidOrderInternal`**

In `packages/backend/convex/helpers/voidsHelpers.ts`, find the table release block inside `voidOrderInternal` (the section that patches the table to "available"). Wrap it with a check that `table.currentOrderId` still matches the order being voided:

```typescript
// In voidOrderInternal, add paid order guard after the existing "already voided" check:
if (order.status === "paid") {
  throw new Error("Cannot void a paid order");
}

// Replace the table release block:
if (order.tableId) {
  const table = await ctx.db.get(order.tableId);
  // Only release table if it still belongs to this order
  if (table && table.currentOrderId === args.orderId) {
    await ctx.db.patch(order.tableId, {
      status: "available",
      currentOrderId: undefined,
    });
  }
}
```

- [ ] **Step 2: Run existing tests to verify the guard doesn't break anything**

Run: `cd packages/backend && pnpm vitest run`
Expected: All existing tests pass.

- [ ] **Step 3: Add `bulkVoidOrders` action to `voids.ts`**

Add after the existing `voidOrder` action in `packages/backend/convex/voids.ts`:

```typescript
export const bulkVoidOrders = action({
  args: {
    orderIds: v.array(v.id("orders")),
    managerId: v.id("users"),
    managerPin: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      voidedCount: v.number(),
      skippedCount: v.number(),
    }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    if (args.orderIds.length === 0) {
      return { success: false as const, error: "No orders selected" };
    }
    if (args.orderIds.length > 50) {
      return { success: false as const, error: "Maximum 50 orders per batch" };
    }

    // 1. Authenticate requester
    const requesterId = await ctx.runQuery(
      internal.helpers.voidsHelpers.getAuthenticatedUserId,
      {},
    );
    if (!requesterId) {
      return { success: false as const, error: "Authentication required" };
    }

    // 2. Verify manager PIN (once for entire batch)
    const manager = await ctx.runQuery(
      internal.helpers.voidsHelpers.getManagerWithPin,
      { managerId: args.managerId },
    );
    if (!manager || !manager.pin || !manager.isActive) {
      return { success: false as const, error: "Manager not found, inactive, or PIN not set" };
    }
    const pinValid = await bcrypt.compare(args.managerPin, manager.pin);
    if (!pinValid) {
      return { success: false as const, error: "Invalid manager PIN" };
    }

    // 3. Process each order sequentially, skip failures
    let voidedCount = 0;
    let skippedCount = 0;

    for (const orderId of args.orderIds) {
      try {
        await ctx.runMutation(
          internal.helpers.voidsHelpers.voidOrderInternal,
          {
            orderId,
            reason: "Bulk void - abandoned order",
            requestedBy: requesterId,
            approvedBy: args.managerId,
          },
        );
        voidedCount++;
      } catch {
        skippedCount++;
      }
    }

    return { success: true as const, voidedCount, skippedCount };
  },
});
```

- [ ] **Step 4: Run tests to verify nothing is broken**

Run: `cd packages/backend && pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 5: Run typecheck**

Run: `cd packages/backend && pnpm typecheck`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/voids.ts packages/backend/convex/helpers/voidsHelpers.ts
git commit -m "feat: add bulkVoidOrders action with table release safety guard"
```

---

## Chunk 2: Web Frontend — Selection Mode & Bulk Void UI

### Task 2: Create colocated page structure and extract components

The orders page is currently a single monolithic `page.tsx` (19.6 KB). Create the colocated folder structure and add the new components.

**Files:**
- Create: `apps/web/src/app/(admin)/orders/_components/ManagerPinDialog.tsx`
- Create: `apps/web/src/app/(admin)/orders/_components/BulkVoidConfirmDialog.tsx`
- Create: `apps/web/src/app/(admin)/orders/_components/BulkVoidFooter.tsx`
- Create: `apps/web/src/app/(admin)/orders/_components/index.ts`
- Create: `apps/web/src/app/(admin)/orders/_hooks/useBulkVoid.ts`
- Create: `apps/web/src/app/(admin)/orders/_hooks/index.ts`
- Modify: `apps/web/src/app/(admin)/orders/page.tsx`

- [ ] **Step 1: Create `ManagerPinDialog.tsx`**

A reusable dialog that lists managers for the store and accepts a PIN. Based on the existing pattern from `users/page.tsx` PIN dialog and the native app's `ManagerPinModal`.

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@packages/backend";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ManagerPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: Id<"stores">;
  onSubmit: (managerId: Id<"users">, pin: string) => void;
  isSubmitting: boolean;
}

export function ManagerPinDialog({
  open,
  onOpenChange,
  storeId,
  onSubmit,
  isSubmitting,
}: ManagerPinDialogProps) {
  const managers = useQuery(api.helpers.usersHelpers.listManagers, { storeId });
  const [selectedManagerId, setSelectedManagerId] = useState<Id<"users"> | null>(null);
  const [pin, setPin] = useState("");

  const handleSubmit = () => {
    if (!selectedManagerId || pin.length < 4) return;
    onSubmit(selectedManagerId, pin);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedManagerId(null);
      setPin("");
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manager Approval Required</DialogTitle>
          <DialogDescription>Select a manager and enter their PIN to approve this action.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Manager</Label>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {managers?.map((manager) => (
                <button
                  key={manager._id}
                  type="button"
                  onClick={() => setSelectedManagerId(manager._id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-md border text-sm transition-colors ${
                    selectedManagerId === manager._id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <span className="font-medium">{manager.name}</span>
                  <span className="text-gray-500 text-xs">{manager.roleName}</span>
                </button>
              ))}
            </div>
          </div>

          {selectedManagerId && (
            <div className="grid gap-2">
              <Label htmlFor="manager-pin">PIN</Label>
              <Input
                id="manager-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Enter PIN"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedManagerId || pin.length < 4}
          >
            {isSubmitting ? "Processing..." : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `BulkVoidConfirmDialog.tsx`**

Shows the list of selected orders before proceeding to PIN entry.

```tsx
"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface OrderSummary {
  _id: string;
  orderNumber: string;
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
            These orders will be voided with reason "Bulk void - abandoned order". This action cannot be undone.
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
```

- [ ] **Step 3: Create `BulkVoidFooter.tsx`**

Sticky footer bar that appears when orders are selected.

```tsx
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
```

- [ ] **Step 4: Create barrel exports**

`apps/web/src/app/(admin)/orders/_components/index.ts`:
```typescript
export { ManagerPinDialog } from "./ManagerPinDialog";
export { BulkVoidConfirmDialog } from "./BulkVoidConfirmDialog";
export { BulkVoidFooter } from "./BulkVoidFooter";
```

`apps/web/src/app/(admin)/orders/_hooks/index.ts`:
```typescript
export { useBulkVoid } from "./useBulkVoid";
```

- [ ] **Step 5: Create `useBulkVoid.ts` hook**

Manages selection state and the bulk void flow (confirm dialog → PIN dialog → action call → toast).

```typescript
"use client";

import { useState, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@packages/backend";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { toast } from "sonner";

interface OrderItem {
  _id: Id<"orders">;
  orderNumber: string;
  orderType: "dine_in" | "takeout";
  netSales: number;
  createdAt: number;
}

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
          const msg = result.skippedCount > 0
            ? `${result.voidedCount} orders voided, ${result.skippedCount} skipped`
            : `${result.voidedCount} orders voided successfully`;
          toast.success(msg);
          setShowPinDialog(false);
          exitSelectionMode();
        } else {
          toast.error(result.error);
        }
      } catch (error) {
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
```

- [ ] **Step 6: Commit new components and hook**

```bash
git add apps/web/src/app/(admin)/orders/_components/ apps/web/src/app/(admin)/orders/_hooks/
git commit -m "feat: add bulk void components — ManagerPinDialog, BulkVoidConfirmDialog, BulkVoidFooter, useBulkVoid hook"
```

---

### Task 3: Integrate selection mode into orders page

**Files:**
- Modify: `apps/web/src/app/(admin)/orders/page.tsx`

- [ ] **Step 1: Add imports and hook to `page.tsx`**

Add at the top of `page.tsx`:
```typescript
import { ManagerPinDialog, BulkVoidConfirmDialog, BulkVoidFooter } from "./_components";
import { useBulkVoid } from "./_hooks";
```

Inside the component, initialize the hook:
```typescript
const bulkVoid = useBulkVoid();
```

- [ ] **Step 2: Add "Select" toggle button in the header**

In the orders page header area (near the status filter tabs), add a button that only appears when the status filter is "open":

```tsx
{statusFilter === "open" && (
  <Button
    variant={bulkVoid.isSelectionMode ? "destructive" : "outline"}
    size="sm"
    onClick={bulkVoid.isSelectionMode ? bulkVoid.exitSelectionMode : bulkVoid.enterSelectionMode}
  >
    {bulkVoid.isSelectionMode ? "Cancel Selection" : "Select"}
  </Button>
)}
```

- [ ] **Step 3: Add checkboxes to order rows**

In the table header row, add a "Select All" checkbox as the first column (only in selection mode):

```tsx
{bulkVoid.isSelectionMode && (
  <th className="w-10 px-3 py-2">
    <input
      type="checkbox"
      checked={filteredOrders.length > 0 && bulkVoid.selectedIds.size === filteredOrders.length}
      onChange={(e) => {
        if (e.target.checked) {
          bulkVoid.selectAll(filteredOrders.map((o) => o._id));
        } else {
          bulkVoid.deselectAll();
        }
      }}
      className="rounded border-gray-300"
    />
  </th>
)}
```

In each order row, add a checkbox as the first cell:

```tsx
{bulkVoid.isSelectionMode && (
  <td className="px-3 py-2">
    <input
      type="checkbox"
      checked={bulkVoid.selectedIds.has(order._id)}
      onChange={() => bulkVoid.toggleSelection(order._id)}
      className="rounded border-gray-300"
    />
  </td>
)}
```

- [ ] **Step 4: Add BulkVoidFooter, BulkVoidConfirmDialog, and ManagerPinDialog**

At the bottom of the page component's return JSX (before the closing fragment/div):

```tsx
{bulkVoid.isSelectionMode && (
  <BulkVoidFooter
    selectedCount={bulkVoid.selectedIds.size}
    onVoidSelected={bulkVoid.startBulkVoid}
    onCancelSelection={bulkVoid.exitSelectionMode}
  />
)}

<BulkVoidConfirmDialog
  open={bulkVoid.showConfirmDialog}
  onOpenChange={bulkVoid.setShowConfirmDialog}
  selectedOrders={
    orders?.filter((o) => bulkVoid.selectedIds.has(o._id)).map((o) => ({
      _id: o._id,
      orderNumber: o.orderNumber,
      orderType: o.orderType,
      netSales: o.netSales,
      createdAt: o.createdAt,
    })) ?? []
  }
  onConfirm={bulkVoid.handleConfirm}
/>

{storeId && (
  <ManagerPinDialog
    open={bulkVoid.showPinDialog}
    onOpenChange={bulkVoid.setShowPinDialog}
    storeId={storeId}
    onSubmit={bulkVoid.handlePinSubmit}
    isSubmitting={bulkVoid.isSubmitting}
  />
)}
```

Note: `storeId` is already available in the page component from the existing store context/hook. Verify the exact variable name used in the page.

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: No errors.

- [ ] **Step 6: Commit integration**

```bash
git add apps/web/src/app/(admin)/orders/page.tsx
git commit -m "feat: integrate bulk void selection mode into orders page"
```

---

## Chunk 3: Manual Testing & Polish

### Task 4: Manual verification and edge case testing

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`

- [ ] **Step 2: Manual test checklist**

Open the web app orders page and verify:
1. "Select" button only appears when status filter is "open"
2. Clicking "Select" shows checkboxes on all open orders
3. "Select All" checkbox works (selects/deselects all)
4. Individual checkboxes toggle correctly
5. Sticky footer shows correct count
6. "Void Selected" opens confirmation dialog with correct order list and totals
7. "Continue to Approval" opens manager PIN dialog
8. Manager list loads correctly
9. Selecting manager shows PIN input
10. Correct PIN voids orders and shows success toast
11. Wrong PIN shows error
12. After voiding, orders disappear from the open list
13. Voided orders appear in the "voided" tab
14. "Cancel Selection" exits selection mode and clears selections
15. If an order is paid/voided by someone else between selection and execution, it is skipped (shows "X skipped" in toast)

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -u
git commit -m "fix: polish bulk void UI after manual testing"
```
