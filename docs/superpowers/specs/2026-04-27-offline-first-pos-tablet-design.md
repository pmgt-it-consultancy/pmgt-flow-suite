# Offline-First POS Tablet (WatermelonDB Sync Layer)

**Date:** 2026-04-27
**Status:** Approved
**Scope:** Native tablet app (`apps/native`), Convex backend (`packages/backend`), schema additions across 12 synced tables, sync HTTP endpoints, device registration, daily-counter rewrite, settings UI, EAS plugin

## Problem

The POS tablet hangs during checkout despite a major April 2026 performance pass (optimistic cart updates, memoization, RNGH Pressable migration, FlatList tuning, backend N+1 fixes). Field reports describe spinners that never resolve on mutations like *Process Payment*, *Void Item*, and *Add Modifier*. Cart-side optimistic updates already mask cart writes; everything else still requires a live Convex round-trip over WebSocket.

Root cause: Convex's reactive WebSocket queries struggle on intermittent restaurant WiFi. When the connection drops mid-mutation, the SDK doesn't surface a graceful error — it sits waiting for a server response that never arrives. Cashiers blame "the system is slow," but the system is actually waiting on a TCP connection that died ten minutes ago.

## Goal

Make the tablet **fully operational for an entire shift (8+ hours) without an internet connection**. Take orders, accept cash payments, void items, apply senior/PWD/promo discounts, print Bluetooth ESC/POS receipts, look up products and modifiers — all from local SQLite. Sync to Convex when online; never block UI on a network round-trip.

The admin web app continues using Convex's reactive `useQuery` unchanged. Convex remains the source of truth.

## Non-Goals

- **Offline admin web app.** Out of scope; the admin lives at `apps/web` and has different conflict needs. May be designed in a follow-up spec.
- **Multi-tablet concurrent editing of the same open order.** The "origin tablet wins" rule rejects cross-tablet edits with a clear error; future work could add an optimistic-merge or pessimistic-lock UI.
- **Offline editing of catalog data** (products, modifiers, categories). Admin-only; tablet rejects edits with "Connect to WiFi to edit catalog."
- **Z-Report from purely-local data.** Z-Report initiation forces a full sync; if offline, the action is blocked with "Connect to WiFi to close the day."
- **First-time sign-in offline.** A device that has never been online cannot authenticate. Subsequent sign-ins on that device are also online-only (PIN remains for manager-override only, not sign-in).
- **CRDT or multi-master conflict resolution.** Server-authoritative LWW with append-only semantics for payments/voids is sufficient.
- **Cross-store sync for floating cashiers.** Single-store-per-session in v1.

## Engine Choice: WatermelonDB

WatermelonDB v0.28+ is the offline-sync engine. Decision rationale (full evaluation in Section 6):

- **React Native production-ready in 2026.** SQLite-backed via JSI, latest release April 2025.
- **Backend-agnostic sync protocol** — only requires two HTTP endpoints (`pullChanges`, `pushChanges`). Fits cleanly as Convex `httpAction`s.
- **Compatible with our exact stack** — RN 0.81.5 + Expo SDK 54 + `newArchEnabled: true` is publicly confirmed working ([@DevYuns, Nov 19 2025](https://github.com/Nozbe/WatermelonDB/issues/1769#issuecomment-3551166833)) using a known setup recipe (ProGuard rule + manual `WatermelonDBJSIPackage` registration in `MainApplication.kt`, fixed by [PR #1875](https://github.com/Nozbe/WatermelonDB/pull/1875), merged Feb 2025).
- **MIT-licensed**, no per-store fees.
- **Reactive observables** on Model classes — migration ergonomics from Convex's `useQuery` are mostly mechanical.

Eliminated alternatives:
- **Replicache** — in maintenance mode (Rocicorp recommends migrating to Zero); the only RN binding ([Braden1996/react-native-replicache](https://github.com/Braden1996/react-native-replicache)) hasn't shipped a release since March 2023.
- **Zero** — first-class RN support, but requires Postgres v15+ with logical replication. Convex is not on that path.
- **PowerSync** — requires a supported source DB (Postgres/Mongo/MySQL/SQL Server). Convex isn't supported; no plug-in path.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Tablet (apps/native)                            │
│  ┌────────────────────────────────────────────┐  │
│  │ UI (Tamagui screens, Zustand ephemeral)    │  │
│  └─────────────────┬──────────────────────────┘  │
│                    │ reactive observables        │
│  ┌─────────────────▼──────────────────────────┐  │
│  │ WatermelonDB  (local SQLite, JSI)          │  │
│  │ - Order, OrderItem, OrderItemModifier,     │  │
│  │   OrderDiscount, OrderPayment, OrderVoid,  │  │
│  │   Product, Category, ModifierGroup, ...    │  │
│  └─────────────────┬──────────────────────────┘  │
│                    │ pull/push                   │
│  ┌─────────────────▼──────────────────────────┐  │
│  │ SyncManager (NetInfo + retry queue)        │  │
│  └─────────────────┬──────────────────────────┘  │
└────────────────────┼─────────────────────────────┘
                     │ HTTPS (not WebSocket)
┌────────────────────▼─────────────────────────────┐
│  Convex (packages/backend)                       │
│  ┌────────────────────────────────────────────┐  │
│  │ httpAction: /sync/pull  /sync/push         │  │
│  │ (translate Watermelon diff ⇄ Convex docs)  │  │
│  └─────────────────┬──────────────────────────┘  │
│  ┌─────────────────▼──────────────────────────┐  │
│  │ Existing queries/mutations (unchanged)     │  │
│  │ ─ admin web still uses live useQuery       │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Key decisions

- **Tablet abandons reactive `useQuery`/`useMutation` for synced domain data.** Reads come from WatermelonDB observables; writes go to WatermelonDB first, then queue for sync. Admin web keeps Convex's reactivity untouched.
- **Convex stays server-authoritative.** Two new `httpAction`s (`pull`, `push`) bridge Watermelon's diff protocol to existing Convex domain mutations. Conflict resolution lives in those mutators.
- **Sync transport is HTTP, not WebSocket.** Plays nicer with intermittent WiFi, captive portals, and proxies. Retries are trivial. Idempotency keys make duplicate pushes safe.
- **One new schema field per synced table:** `updatedAt: number` (millisecond Unix timestamp), used as the diff cursor. No data migration; new field defaults applied on next write.
- **Local-first IDs.** WatermelonDB uses UUIDs as primary keys. Convex docs gain a `clientId: string` field. Pull responses ship both; the tablet never waits for a server round-trip to get a "real" ID.
- **Idempotency keys** on every queued mutation — push endpoint dedupes via a `syncedMutations` table.
- **Sync status visibility** in the app header so cashiers know online/offline/syncing/queued state.

### What stays the same

Bluetooth ESC/POS printer module, Tamagui UI primitives, Zustand for UI state, `@convex-dev/auth` (refresh token already cached locally by the SDK), entire admin web app, all Convex business mutations (the `httpAction`s call them under the hood).

### What's new

| Area | Surface |
|---|---|
| `apps/native/src/db/` | WatermelonDB schema, models, migrations |
| `apps/native/src/sync/` | SyncManager, NetInfo wiring, retry queue, status pill |
| `apps/native/src/auth/cachedSession.ts` | SecureStore session cache |
| `apps/native/src/features/settings/` | Device Info row |
| `apps/native/plugins/withWatermelonDB.js` | Expo config plugin (in-tree) |
| `packages/backend/convex/sync.ts` | `pull`, `push`, `registerDevice` HTTP actions |
| `packages/backend/convex/schema.ts` | `updatedAt` + `clientId` on synced tables; `syncedMutations`, `syncDevices` tables; `deviceCodeCounter` on stores |

## Data Model

### Tables and their sync direction

| Sync direction | Tables | Notes |
|---|---|---|
| **Read + write on tablet** (cashier creates these) | `orders`, `orderItems`, `orderItemModifiers`, `orderDiscounts`, `orderVoids`, `orderPayments` | The transactional core. Must work fully offline. |
| **Read-only on tablet** (admin writes; tablet caches) | `products`, `categories`, `modifierGroups`, `modifierOptions`, `modifierGroupAssignments`, `tables`, `roles`, `users` (just members of cashier's store), `stores` (just cashier's store), `settings` (store-scoped), `appConfig` | Pulled into local SQLite on first sign-in and refreshed on each pull. Tablet writes for these tables are rejected when offline. |
| **Push-only** | `auditLogs` | Append-only fire-and-forget. Push direction only; pull skips them. |
| **Not synced** | `dailyReports`, `dailyProductSales`, `dailyPaymentTransactions`, `notes`, all `authTables` | Server-aggregated or auth-system-managed. Z-Report fetched live via HTTP when generating; offline → blocked. |

### Schema additions per synced table

```typescript
// Added to all synced tables (orders, orderItems, products, categories, etc.)
updatedAt: v.number(),              // millisecond timestamp; cursor for pull
clientId: v.optional(v.string()),   // UUID generated by tablet; FKs translate via this
```

Many tables already have `updatedAt` or `createdAt` (products, settings) — we align all synced tables to **always** carry `updatedAt`, written by every mutation. The `clientId` is new everywhere and is required for all tablet-created rows. Admin-created rows (e.g., products created via web) get a server-generated UUID via `crypto.randomUUID()`.

### New tables

```typescript
// Tracks devices registered to a store; assigns unique deviceCode.
syncDevices: defineTable({
  deviceId: v.string(),         // UUID generated on first install, stored in SecureStore
  storeId: v.id("stores"),
  deviceCode: v.string(),       // "A", "B", ..., "Z", "AA", "AB", ... (Excel-style auto-extending)
  registeredAt: v.number(),
  lastSeenAt: v.number(),
})
  .index("by_storeId_deviceCode", ["storeId", "deviceCode"])
  .index("by_deviceId", ["deviceId"]),

// Idempotency cache for push retries; cleaned by daily cron after 7 days.
syncedMutations: defineTable({
  clientMutationId: v.string(),
  storeId: v.id("stores"),
  response: v.string(),         // JSON stringified
  createdAt: v.number(),
}).index("by_clientMutationId", ["clientMutationId"]),
```

### New field on `stores`

```typescript
deviceCodeCounter: v.optional(v.number()),  // monotonic; never decremented; never reused
```

### Special handling

- **`tables.currentOrderId` cycle and `orders.refundedFromOrderId` self-reference.** Handled via WatermelonDB's `relation` decorator with `actionsEnabled: true`.
- **`stores.logo` (Convex `_storage` ref).** Sync the storage ID string only; resolve to image when online. Receipts use text-only fallback offline (already works for printed receipts).
- **Snapshots stay snapshots.** `orderItems.productName/productPrice` and `orderItemModifiers.{modifierGroupName,modifierOptionName,priceAdjustment}` are already snapshots in the current schema. Offline behavior matches online.

### Soft deletes — no tombstones

The schema already uses `isActive: boolean` (categories, products, modifierGroups, modifierOptions, tables, stores, users) and `status` / `isVoided` fields (orders, orderItems). Sync just propagates the latest row state; client treats `isActive: false` as logically deleted. No tombstone table required.

### ID strategy

- Tablet generates UUIDs locally for every new row. Used as WatermelonDB's `id` column.
- Convex docs gain `clientId: string` alongside their native `Id<"tableName">`.
- Pull responses ship both IDs (`_id` + `clientId`). Tablet stores them as `serverId` + `id`.
- Foreign keys on the tablet always reference UUIDs.
- Push endpoint translates UUIDs → Convex IDs server-side via `clientId` lookups before calling existing domain mutations.
- Two cashiers on two tablets generating orders simultaneously offline can't collide because UUIDs.

## Sync Protocol

### Endpoints

**`POST /sync/pull`**

```typescript
// Request
{
  lastPulledAt: number | null,    // null = first sync
  schemaVersion: number,          // tablet's local schema version
  // storeId comes from auth header (cashier's session)
}

// Response (Watermelon-shaped)
{
  changes: {
    products:   { created: [...], updated: [...], deleted: [] },
    categories: { ... },
    orders:     { ... },          // only orders for this store
    // ... every synced table
  },
  timestamp: number,              // server's Date.now() at start of pull
}
```

Implementation in `convex/sync.ts`:
- For each synced table: `query("by_store_updatedAt", q => q.eq("storeId", storeId).gt("updatedAt", lastPulledAt))`. New compound indexes added.
- Translate Convex `_id` → `clientId` and FK columns Convex-Id → clientId via batch lookups.
- Empty `deleted` arrays — soft-delete via `isActive`/`status` is preserved.
- Returns server timestamp; tablet stores it as `lastPulledAt` for next pull.
- Paginated by `updatedAt` to keep payloads bounded; first sync of a fresh device may take several batches.

**`POST /sync/push`**

```typescript
// Request
{
  lastPulledAt: number,
  changes: {
    orders:        { created: [...], updated: [...] },
    orderItems:    { ... },
    orderPayments: { ... },
    orderVoids:    { ... },
    // ... only tables tablet writes
  },
  clientMutationId: string,       // UUID per push request
}

// Response
{ success: true } | { rejected: [{ table, clientId, reason }] }
```

Implementation:
1. Check `syncedMutations` for `clientMutationId`. Return cached response on duplicate.
2. Per row, per table: translate FKs clientId → Convex Id, then call existing domain mutation (`internal.orders.create`, `internal.checkout.processPaymentCore`, etc.).
3. Stamp `updatedAt = Date.now()` on every write.
4. Record the result in `syncedMutations` (TTL 7 days, daily cron cleanup).

**`POST /sync/registerDevice`**

```typescript
// Request
{ deviceId: string, storeId: string }

// Response
{ deviceCode: string }
```

Assigns next available `deviceCode` from the store's monotonic counter:

```typescript
// 0 → "A", 1 → "B", ..., 25 → "Z", 26 → "AA", 27 → "AB", ...
function deviceCodeFromIndex(n: number): string {
  let code = "";
  while (n >= 0) {
    code = String.fromCharCode(65 + (n % 26)) + code;
    n = Math.floor(n / 26) - 1;
  }
  return code;
}
```

`stores.deviceCodeCounter` increments by one on each new device registration. Codes are never reused — preserves audit trail through device retirement.

### Conflict resolution

| Table type | Rule |
|---|---|
| Catalog (`products`, `categories`, `modifierGroups`, `modifierOptions`, `tables`) | **Server wins.** Tablet pushes for these are rejected with "Edit catalog from admin." |
| `orders` (status: draft/open) | **Origin tablet wins.** Server tracks `originDeviceId` on the order. While an order is open, only the origin tablet can mutate it. |
| `orders` (status: paid/voided) | **Frozen.** Any push attempting to modify these is rejected with "Order is closed." |
| `orderPayments`, `orderVoids`, `orderDiscounts` | **Append-only with idempotency.** Inserts only; deduped by `clientId`. Never updated, never deleted. |
| `auditLogs` | **Append-only.** Same pattern. |

This avoids needing a CRDT entirely.

### Daily order numbers (T-Axxx, D-Axxx)

**Format:** Always shows device prefix. `T-A042`, `D-B017`, etc.

- Each tablet maintains its own daily counter per `orderType`, stored locally (WatermelonDB `appConfig` or AsyncStorage):
  ```typescript
  {
    reportDate: "2026-04-27",
    dineInLastNumber: 42,
    takeoutLastNumber: 17,
  }
  ```
- Day rollover detected via the existing store-schedule helpers (`getReportBoundariesForDate`); counters reset to 0 on new business day.
- Order creation: increment counter, format as `${typePrefix}-${deviceCode}${num.toString().padStart(3,'0')}`.
- Stored in the order's `orderNumber` field; pushed to Convex on next sync.
- **No server coordination of numbers needed** — device prefix prevents collision by construction.

**Migration of existing orders:** legacy orders keep their current `T-042` format. Only new orders get the prefix. Reports/search must handle both formats: `^([TD])-(?:([A-Z]+)(\d+)|(\d+))$`.

The existing `getNextOrderNumber` server logic is **disabled for tablet writes** — tablet generates its own numbers. The function may continue serving the admin web (e.g., manual order creation from the back office) until that flow is also migrated.

### Sync triggers

| Trigger | Behavior |
|---|---|
| App foregrounded | Pull (if last pull >30s ago) |
| Network reconnects (NetInfo) | Push pending → Pull |
| Local mutation queued | Push (debounced 500ms) |
| Periodic while online | Pull every 60s |
| Z-Report initiated | **Force full push + pull, block on completion.** Z-Report can only proceed once sync is clean. If offline → "Connect to WiFi to close the day." |
| Manual "Sync now" button | Push + pull |

Failed pushes retry with exponential backoff (2s, 5s, 15s, 60s, capped); after 5 minutes of failures, surface a banner.

## Auth & Session

### Sign-in is online-only

No PIN-based offline sign-in, no offline first-time auth, no fallback paths. Login screen detects offline → "Connect to WiFi to sign in."

### Once signed in, stay signed in essentially forever (refresh token rotation)

`@convex-dev/auth` issues access tokens (short-lived) and refresh tokens (long-lived). The SDK auto-refreshes the access token via the refresh token; **on each refresh, a new refresh token is issued** (rotation). As long as the tablet is online for any authenticated activity at least once per refresh-token lifetime, the session never truly expires.

We extend the refresh token lifetime from default to **60 days** (configured in `packages/backend/convex/auth.ts`) to give a generous offline-tolerance floor. Under normal daily POS use:

```
Day 0:    Sign in. Refresh token A. Expires day 60.
Day 0+1h: Access token expires → SDK refreshes silently → New refresh token B. Expires day 60+1h.
...
Day 30:   Token Q. Expires day 90.
Day 90:   Token QQ. Expires day 150.
...
```

The cashier signs in **once** when the device is commissioned and never again under normal operation.

### When does the cashier need to re-sign-in?

- Tablet sat unused for >60 days (e.g., shipped to a closet) — refresh token expired. Sign in once, back to normal.
- Admin explicitly revoked the session (force-logout, password change, role change).
- Cashier manually signed out.
- Server-side auth keys rotated (rare admin event).

### Cached session in SecureStore

```typescript
{
  cachedSession: {
    userId: string,
    email: string,
    name: string,
    roleId: string,
    permissions: string[],
    storeId: string,
    storeSnapshot: { name, vatRate, schedule, footer, ... },  // for offline receipt rendering
    expiresAt: number,             // sign-in time + 60 days; advanced on each refresh
  },
  refreshToken: string,            // managed by @convex-dev/auth
  deviceId: string,                // UUID, one-time generated on first install
  deviceCode: string,              // assigned by /sync/registerDevice
}
```

WatermelonDB also contains the user record for FK lookups, but **SecureStore is the source of truth for "am I signed in?"** because it's encrypted at rest and available before WatermelonDB boots.

### PIN flow (unchanged)

The existing `users.pin` field remains scoped to manager-override actions (large discounts, void paid orders). bcrypt verification works offline because the hash is already cached in WatermelonDB. **Zero change** to the PIN flow.

### Token-failure tolerance

No grace period needed. Refresh-failure is handled only on next online sync — at that moment the cashier needs to re-sign-in (and they're already online, so it's clean). Offline operation is never interrupted by auth machinery.

### What we explicitly do not support

- First-time sign-in offline (online-only).
- Multi-user offline switching for users who have never signed in on this device (online-only for any new user).
- Offline password reset.

## Device Code Visibility (UI)

### Settings screen

New "Device Info" section in `apps/native/src/features/settings/`, near printer settings:

```
Device Info
─────────────────────
Device Code:   A
Store:         Main Branch
Registered:    April 27, 2026
Last Sync:     2 minutes ago
Device ID:     a3f8...c2e1  (truncated; tap to copy)
```

Read-only. Server-assigned. Full `deviceId` UUID truncated by default with copy-to-clipboard for support cases.

### App header indicator

Persistent chip near the user's name in the top bar:

```
[Cashier Name] · Device A · 🟢 Synced
```

States:
- 🟢 `Synced` — last sync <60s ago, queue empty
- 🟡 `Syncing...` — push or pull in flight
- 🟡 `Offline (3 pending)` — queue depth shown when offline
- 🔴 `Sync failed — tap to retry` — after 5 min of failed retries

Tapping the chip navigates to Settings → Device Info.

### Receipts and kitchen tickets

Already covered: the `T-A042` order number itself communicates the device. No extra change.

### Future work: admin web

Admin orders table can add a "Device" filter that groups by `originDeviceId`. **Out of scope for v1 spec.**

### Future work: re-register device button

Manager action for tablets with corrupted state or moved between stores. Unregisters + re-registers, getting a new code. **Out of scope for v1.**

## Migration & Rollout

### Guiding principles

- **Convex schema changes are non-breaking.** New fields (`updatedAt`, `clientId`) are optional with defaults; admin web and current tablet build keep working unchanged.
- **Coexistence during transition.** WatermelonDB and Convex's reactive `useQuery` run side-by-side. Each screen migrates independently.
- **Feature-flag every migration.** Each switch from `useQuery` → WatermelonDB observable lives behind a flag. Quickly revertible per-feature, per-build.
- **Per-store pilot before fleet rollout.** New build ships to one store first; data integrity confirmed; *then* expands.
- **Rollback safety:** at any phase we can ship a previous app version. Convex is source of truth, so no data is lost.

### Phases

**Phase 0 — Spike & verify (1 wk, blocking)**
- Verify WatermelonDB v0.28 boots on Expo 54 / RN 0.81 / new-arch (DevYuns recipe)
- Author the in-tree Expo config plugin (ProGuard rule + MainApplication.kt registration)
- End-to-end smoke test: schema + sync stub + offline-payment-print-reconnect cycle
- **Decision gate:** if any spike fails → fall back to Replicache (with eyes open) or postpone.

**Phase 1 — Convex foundation (1 wk, non-breaking, parallel with Phase 2)**
- Add `updatedAt` + `clientId` to every synced table
- Add `syncedMutations`, `syncDevices` tables; `deviceCodeCounter` on `stores`
- Update existing mutations to write `updatedAt` + auto-generate `clientId` on insert
- One-time backfill: assign `clientId = crypto.randomUUID()` to all existing rows missing it
- Implement `/sync/pull`, `/sync/push`, `/sync/registerDevice` httpActions
- Add new compound indexes (`by_store_updatedAt` etc.)
- Extend refresh token lifetime to 60 days

**Phase 2 — Native foundation (1 wk, parallel with Phase 1)**
- Add `apps/native/src/db/` (schema, models, migrations)
- Add `apps/native/src/sync/` (SyncManager, NetInfo wiring, retry queue)
- Add `SyncStatusPill` component, mounted in nav header
- Add SecureStore cached-session helpers
- Wire device registration on first sign-in
- **No screen changes yet.** WatermelonDB is populated by background sync but no UI reads it.

**Phase 3 — Migrate read paths (1.5 wks, parallelizable)**
Smallest blast radius first:
1. Products catalog (`CategoryGrid`, `ProductPicker`)
2. Modifier groups/options
3. Categories
4. Tables list
5. Stores / settings / appConfig
6. Order history (read-only)

Per migration:
- Feature flag (`useWatermelon.products`, etc.)
- Swap `useQuery(api.products.list)` → `useObservable(database.collections.get('products').query(...))`
- Side-by-side comparison in dev (toggle flag, verify identical behavior)
- Ship to staging, smoke, ship to production with flag off
- Flip flag for one store, monitor 24–48h, flip for fleet

**Phase 4 — Migrate write paths (2–3 wks)**
The transactional core. Higher stakes.
1. Order create / update / void
2. Order item add / remove / update quantity / modifier changes
3. Order discounts
4. Order payments
5. Order voids
6. Audit log writes

Per migration:
- Mutation writes to WatermelonDB → SyncManager queues push → existing Convex mutation runs server-side via `/sync/push`
- NetInfo-mocked offline tests: take order → simulate offline → process payment → reconnect → confirm sync
- Per-screen rollout, same flag-flip cadence as Phase 3

**Phase 5 — Order numbering & device codes (1 wk)**
- Tablet registers device on first online sign-in, gets `deviceCode`
- Disable `getNextOrderNumber` for tablet writes (tablet now generates its own)
- Tablet-side daily counter
- New orders use `T-A042` format; legacy orders unchanged
- Update reports/search regex to handle both
- Settings screen "Device Info" row + header chip

**Phase 6 — Z-Report enforcement & polish (1 wk)**
- Force-sync gate on Z-Report initiation; offline → "Connect to WiFi" message
- Audit all error states / sync status UX
- Remove feature flags after fleet stability confirmed

**Phase 7 — Pilot rollout (1–2 wks, calendar time)**
- Single store, ideally one most affected by WiFi-related hangs (highest-leverage feedback)
- Daily monitoring: sync error rate, mutation push failures, conflict-rejection counts, banner appearances
- Iterate on observed issues

**Phase 8 — Fleet rollout (2 wks)**
- Staged: 25% → 50% → 100% of stores
- Once all stores stable for 2 weeks, remove feature flags and old `useQuery` code paths

### Total timeline with parallel headcount

**~6–8 weeks** end-to-end (versus ~10–12 sequential).

### Rollback strategy

At any phase:
- App can be reverted via EAS Update or Play Store rollback to a previous version.
- Convex schema additions are non-breaking — old client just ignores them.
- WatermelonDB local data can be wiped on revert with no data loss (Convex is source of truth).

## Risk Register & Verification

### Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | WatermelonDB JSI adapter doesn't boot on RN 0.81 + new arch in our app | Low (DevYuns confirmed working on near-identical stack) | Blocking | Phase 0 spike validates BEFORE refactor begins; fall back to Replicache or postpone |
| R2 | Tamagui 2.0-rc / Reanimated 4 / WatermelonDB native module conflict | Low | Blocking | Phase 0 spike includes the full plugin stack; isolate and report upstream if found |
| R3 | Convex `httpAction` size or runtime limits exceeded on large pull | Medium | High | Pull endpoint paginates by `updatedAt`; tablet pulls in batches of 500 rows |
| R4 | Two cashiers on two tablets editing the same open order | Low | Medium | Edits to non-origin orders rejected with banner "this order is owned by Device A" |
| R5 | Order numbering collision (bug bypassing `deviceCode`) | Low | High | Push endpoint validates format `^[TD]-[A-Z]+\d{3,}$` and rejects duplicates; alert on unexpected format |
| R6 | Local DB corruption | Low | High | Sync recovery: wipe local DB → full re-pull from Convex (no data loss); UX path to confirm |
| R7 | Mutations queued but never pushed | Medium | High | SyncManager exposes pending-queue count in pill; threshold (>50 queued >1h) → red banner + manual "Sync now" |
| R8 | Refresh token expires while offline >60 days (dormant tablet) | Low | Low | Re-sign-in screen on next online session; one-time inconvenience |
| R9 | Phase 0 spike succeeds but production reveals load-related bug | Medium | High | Pilot store catches before fleet rollout; rollback path |
| R10 | WatermelonDB upgrade breaks during migration | Low | Medium | Pin to v0.28.x; defer upgrades until offline migration is complete |

### Phase 0 spike checklist

The spike must pass *all* of these before Phase 1 begins.

- [ ] **Spike 1: Bare-bones boot** — fresh Expo 54 app, RN 0.81.5, `newArchEnabled: true`, Hermes. WatermelonDB v0.28.0 installed, JSI adapter registered via in-tree Expo config plugin. App opens without crash on a real Android tablet (not just emulator). Schema with one model (`Product`). Test: create + read a Product. **Pass criterion:** zero JSI errors in logcat, model row visible.

- [ ] **Spike 2: Coexistence with our native dependencies** — same project as Spike 1, add: `tamagui@2.0-rc`, `react-native-reanimated@4`, `react-native-worklets`, `react-native-gesture-handler`, `expo-secure-store`, `@react-native-async-storage/async-storage@2`, `@vardrz/react-native-bluetooth-escpos-printer`. Verify: app boots, all modules initialize, simple Tamagui screen + Reanimated animation + WatermelonDB query coexist on screen. **Pass criterion:** no runtime conflicts; smoke test passes on real tablet.

- [ ] **Spike 3: End-to-end sync cycle** — Same app + a stub Convex instance with `/sync/pull` and `/sync/push` HTTP actions. Schema: products + orders + orderItems. Test sequence:
  1. Boot online → device registers → pulls products
  2. Go offline (airplane mode)
  3. Create order (UUID `clientId`, device-prefixed `orderNumber`)
  4. Add order items
  5. Process cash payment (insert `orderPayment` row)
  6. Print Bluetooth receipt
  7. Reconnect WiFi
  8. Verify sync pushes → all data appears in Convex with proper IDs
  9. Verify pull comes back clean (no duplicates, no conflicts)

  **Pass criterion:** end-to-end happy path works; pending-queue depth returns to zero after sync; data in Convex matches what was rung offline.

- [ ] **Spike 4: EAS Build & ProGuard** — Run `pnpm build:staging` via EAS local; verify the resulting APK installs and runs the same flow. Ensure ProGuard doesn't strip `com.nozbe.watermelondb.**` classes. **Pass criterion:** release-mode build behaves identical to dev build.

If all four pass → engine choice is locked. If any fail → triage and either fix-and-retry or escalate to a fallback engine.

### Production observability

Sync visibility for ops/support:
- Convex `auditLogs` entry on each push request (count of rows per table, latency, conflict rejections)
- Banner in admin web showing per-store "active devices, last sync, pending queue depth"
- Alerting (Sentry / Convex logs) on:
  - Push failure rate >5% over 1h for a single tablet
  - Pull payload size >5MB (paginate-bug indicator)
  - Refresh token failures >0 (signals revoked sessions)
  - Conflict rejection rate >1% of writes

## Future Work (out of scope for v1)

- Multi-tablet concurrent editing of the same open order (optimistic-merge or pessimistic-lock)
- Offline editing of catalog (products, modifiers) from the tablet
- Z-Report from purely-local data (eliminates online dependency)
- Offline admin dashboard (separate spec; share sync primitives from this work)
- Cross-store sync for floating cashiers
- `_storage` image bytes (logos) cached locally for offline receipt rendering with images
- Admin web "Device" filter on orders table
- Manager "Re-register device" action for corrupted tablets
- WatermelonDB upgrades beyond v0.28.x (deferred until v1 stable)
