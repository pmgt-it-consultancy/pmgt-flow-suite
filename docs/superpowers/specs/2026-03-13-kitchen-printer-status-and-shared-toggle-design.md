# Kitchen Printer Status Fix + Shared Printer Toggle

**Date:** 2026-03-13
**Status:** Approved

## Bug Fix

`useSystemStatus.ts` line 79 returns `"connected"` when `kitchenPrintingEnabled` is false, causing the System Status dropdown to show a green "Connected" dot for Kitchen Printer even when no printers are configured.

**Fix:** Add `"not_configured"` to `ConnectionStatus`. Return it when no printer exists for a role. Display as gray dot with "Not configured" text, no reconnect button.

## Feature: Use Receipt Printer for Kitchen Tickets

New boolean setting `useReceiptPrinterForKitchen` in printer store/storage. When enabled, kitchen tickets fall back to the default receipt printer when no dedicated kitchen printer is configured.

### Affected Printing Flows

1. **`usePrinterStore.printKitchenTicket()`** (automatic, from OrderScreen "Send to Kitchen"): Currently has NO fallback — silently skips if no kitchen printer. Add fallback to receipt printer when `useReceiptPrinterForKitchen` is true.

2. **`ReceiptPreviewModal.handlePrintKitchenReceipt()`** (manual, from receipt preview): Currently ALWAYS falls back (`kitchenPrinter ?? receiptPrinter`). Change to only fall back when `useReceiptPrinterForKitchen` is true. Hide "Print Kitchen Receipt" button when no printer is available.

### System Status Display

- Dedicated kitchen printer exists → show its actual connection status
- `useReceiptPrinterForKitchen` true + no dedicated kitchen printer → show receipt printer status, label "Kitchen (via Receipt)"
- Neither → show "Not configured"

### Files Changed

| File | Change |
|------|--------|
| `settings/services/printerStorage.ts` | Add `useReceiptPrinterForKitchen` to `PrinterSettings` |
| `settings/stores/usePrinterStore.ts` | Add state + setter + fallback in `printKitchenTicket` |
| `shared/hooks/useSystemStatus.ts` | Fix bug, add `not_configured`, handle shared printer status |
| `shared/components/StatusDropdown.tsx` | Add `not_configured` styling, dynamic kitchen label |
| `settings/screens/PrinterSettingsScreen.tsx` | Add toggle for `useReceiptPrinterForKitchen` |
| `checkout/components/ReceiptPreviewModal.tsx` | Respect toggle for fallback + button visibility |
