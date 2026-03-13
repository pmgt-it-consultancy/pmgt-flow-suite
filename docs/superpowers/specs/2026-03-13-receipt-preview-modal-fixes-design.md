# Fix ReceiptPreviewModal + TakeoutOrderDetailModal Issues

**Date:** 2026-03-13
**Status:** Approved
**Scope:** Bug fixes — 2 files, 3 issues

## Problem

Three issues in the TakeoutOrderDetailModal + ReceiptPreviewModal interaction:

1. **Stale print state on reopen** — `printResult`/`kitchenPrintResult` in ReceiptPreviewModal are never reset. When opened from TakeoutOrderDetailModal (which doesn't unmount the component), previous error/success banners persist on reopen.

2. **Skip returns to order detail instead of closing** — The two-modal visibility toggle (`visible && !showReceiptPreview`) means pressing Skip/Done goes back to the Order Details modal instead of dismissing everything. Users perceive this as "showing up twice."

3. **No kitchen receipt printing** — `kitchenTicketData={null}` is hardcoded. Kitchen receipt button never appears for takeout orders.

## Design

### ReceiptPreviewModal.tsx

Add a `useEffect` on `visible` that resets all print states when the modal opens:

```typescript
useEffect(() => {
  if (visible) {
    setPrintResult(null);
    setKitchenPrintResult(null);
    setIsPrinting(false);
    setIsKitchenPrinting(false);
  }
}, [visible]);
```

Safe in CheckoutScreen context — that flow unmounts the component on Skip via `navigation.reset()`, so the effect never fires there in a meaningful way.

### TakeoutOrderDetailModal.tsx

**Build kitchen ticket data** from order's active items:

```typescript
const kitchenTicketData: KitchenTicketData | null = useMemo(() => {
  if (!order?.orderNumber || !isPaid) return null;
  return {
    orderNumber: order.orderNumber,
    tableName: order.customerName || "Takeout",
    orderType: "take_out" as const,
    items: activeItems.map((i) => ({
      name: i.productName,
      quantity: i.quantity,
      notes: i.notes,
      modifiers: i.modifiers?.map((m) => ({
        optionName: m.optionName,
        priceAdjustment: m.priceAdjustment,
      })),
    })),
    timestamp: new Date(),
  };
}, [order, activeItems, isPaid]);
```

Includes all active (non-voided) items since this is a reprint scenario.

**Change onSkip to close everything** — call `onClose()` instead of just toggling `showReceiptPreview`. This dismisses both modals, returning to the takeout list. Matches CheckoutScreen behavior.

**Keep `showReceiptPreview` state** — still needed to control when ReceiptPreviewModal is visible. The Order Details modal still hides itself when receipt preview opens (`visible && !showReceiptPreview`). The difference is that Skip now calls `onClose` which unmounts everything.

## Files Changed

| File | Change |
|------|--------|
| `apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx` | Add useEffect to reset print states on open |
| `apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx` | Build kitchen ticket data, change onSkip to close all |

## What Stays the Same

- ReceiptPreviewModal props interface (no changes)
- CheckoutScreen flow (unaffected — already unmounts on Skip)
- Kitchen ticket ESC/POS format (uses existing `printKitchenTicketToThermal`)
- All other modals (audit confirmed they're clean)
