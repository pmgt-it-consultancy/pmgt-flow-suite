# Phase 5 — Order Numbering & Device Codes Design

**Date:** 2026-04-29
**Status:** Approved
**Scope:** Native tablet app (`apps/native`), minor backend

## Goal

Assign each tablet a device code (A, B, C, ...) on first sign-in. Use this prefix in order numbers (`T-A042`, `D-B017`) so every order is identifiable by device, preventing numbering collisions across tablets. Show device info in Settings and the app header.

## Architecture

```
Sign-in → SyncManager.start()
  ├── getOrCreateDeviceId()          [exists]
  └── callRegisterDevice(deviceId, storeId) → get deviceCode  [NEW]
       └── stored in SyncManager memory
  
createOrder() → getNextOrderNumber(storeId, orderType)  [NEW]
  ├── reads local daily counter from app_config table
  ├── formats: prefix + deviceCode + padded number
  └── increments counter
  
SettingsScreen → Device Info section  [NEW]
  └── reads syncManager.getDeviceCode(), syncManager.getState()
```

## Changes

### 1. SyncManager — register device on start

In `start()`, after getting `deviceId` and before starting the periodic timer:
1. Look up the user's `storeId` (needed for registration — `SyncManager` doesn't currently know it)
2. Call `callRegisterDevice(deviceId, storeId)`
3. Store the returned `deviceCode`
4. Expose via `getDeviceCode(): string`

**StoreId problem:** `SyncManager.start()` doesn't currently receive a storeId. Solution: either pass it in `start(storeId)` or have the manager read it from cached session. Per spec, `CachedSession.storeId` is available. Add `storeId` parameter to `start()`.

### 2. orderMutations.ts — device-prefixed order numbers

Create `getNextOrderNumber(storeId, orderType)` in a new helper or directly in `orderMutations.ts`:

```typescript
function getNextOrderNumber(storeId: string, orderType: "dine_in" | "takeout"): string {
  const prefix = orderType === "dine_in" ? "D" : "T";
  const deviceCode = syncManager.getDeviceCode(); // "A", "B", etc.
  const today = getCurrentBusinessDayKey(); // "2026-04-29" (respects store schedule)
  
  const counterKey = `orderCounter.${orderType}.${today}`;
  const lastUsed = readLocalCounter(counterKey); // from app_config or in-memory
  const next = lastUsed + 1;
  writeLocalCounter(counterKey, next);
  
  return `${prefix}-${deviceCode}${String(next).padStart(3, "0")}`;
}
```

Replace `const orderNumber = `${prefix}-${today}.slice(-6)}`` with this call.

**Daily counter persistence:** Store in WatermelonDB's `app_config` table (key-value). On each `createOrder`, atomically read + increment. If the db isn't available yet (race at boot), use an in-memory fallback Map — acceptable since order numbers are informational, not transactional.

### 3. Settings — Device Info section

Add a section in `SettingsScreen.tsx` below printer settings:

```
Device Info
─────────────────────
Device Code:   A
Store:         Main Branch
Last Sync:     2 min ago
Device ID:     a3f8...c2e1  (truncated; tap to copy)
```

Reads from:
- `syncManager.getDeviceCode()` — device code
- `user?.storeSnapshot?.name` — store name (from cached session)
- `syncManager.getState().lastPulledAt` — last sync
- `getOrCreateDeviceId()` — truncated device UUID

### 4. Header — show device code

In `HomeScreen` header or `SyncStatusPill`, append the device code. The pill already shows sync state — add device code:

```
Synced · Device A
Syncing…
Offline (3 pending) · Device A
```

---

## File Inventory

| File | Action |
|---|---|
| `apps/native/src/sync/SyncManager.ts` | Add `storeId` param to `start()`, call `callRegisterDevice`, expose `getDeviceCode()` |
| `apps/native/src/sync/SyncBootstrap.tsx` | Pass `storeId` to `syncManager.start(storeId)` |
| `apps/native/src/features/orders/services/orderMutations.ts` | Replace order number generation with device-prefixed + daily counter logic |
| `apps/native/src/features/orders/services/orderNumber.ts` | New module: `getNextOrderNumber(storeId, orderType)` with counter persistence |
| `apps/native/src/features/settings/screens/SettingsScreen.tsx` | Add Device Info section (read-only) |
| `apps/native/src/sync/SyncStatusPill.tsx` | Append device code to status text |

## Legacy Order Format Compatibility

Existing orders keep `T-042` format. Reports/search must handle both:
- New: `T-A042` (prefix + deviceCode + number)
- Legacy: `T-042` (prefix + number)

The `useTakeoutOrders` and `useActiveOrders` data sources already return `orderNumber` as-is. No regex parsing change needed in Phase 5 — Phase 6 (Z-Report) will handle parsing when aggregating.

## Non-Goals

- Admin web order table "Device" filter
- Re-register device button (manager action for corrupted tablets)
- Server-side validation of order number format (already handled by `/sync/push`)
