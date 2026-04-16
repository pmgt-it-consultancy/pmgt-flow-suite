# Native POS Performance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate tablet UI hang and cart-tap latency during live shifts without introducing an offline-sync layer.

**Architecture:** Six independently-shippable phases. Phases 1–3 are pure-frontend refactors and optimistic updates that should resolve the reported hang and make cart interactions feel instant under PH→US RTT. Phase 4 consolidates redundant Convex subscriptions. Phase 5 is a backend schema denormalization to collapse the `listActive` N+1. Phase 6 replaces the store-wide modifier prefetch with a per-product fetch. Each phase can merge and ship on its own.

**Tech Stack:** React Native 0.81 + Expo 54, Tamagui v5, Zustand, Convex (`@convex-dev/auth`, `convex/react`), React Navigation native-stack, Vitest + convex-test for backend.

**Out of scope:** Replicache / offline-first sync, Convex regional deployment, and the currently-adequate FlatList in `ActiveOrdersList` (already memoized and tuned in `aa61e7f`).

---

## File Structure

**Modified (frontend):**
- `apps/native/src/features/orders/screens/OrderScreen.tsx` — printer selector, console logs, optimistic updates wiring
- `apps/native/src/features/checkout/screens/CheckoutScreen.tsx` — printer selector
- `apps/native/src/features/order-history/screens/OrderDetailScreen.tsx` — printer selector
- `apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx` — printer selector
- `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx` — console logs
- `apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx` — console logs
- `apps/native/src/features/settings/services/bluetoothPrinter.ts` — console logs
- `apps/native/src/features/updater/stores/useUpdateStore.ts` — console logs
- `apps/native/src/features/auth/context/AuthContext.tsx` — memoized context value
- `apps/native/src/features/home/screens/HomeScreen.tsx` — memoized derived state, memoized subcomponents, dropped duplicate query
- `apps/native/src/features/orders/components/CategoryGrid.tsx` — FlatList tuning props
- `apps/native/src/features/orders/components/ModifierSelectionModal.tsx` — setState-during-render fix
- `apps/native/src/features/orders/components/CartItem.tsx` — debounced quantity press handler

**Created (frontend):**
- `apps/native/src/features/orders/hooks/useCartMutations.ts` — optimistic-update-wrapped cart mutation hooks (addItem, updateItemQuantity, removeItem, updateItemServiceType)

**Modified (backend):**
- `packages/backend/convex/schema.ts` — add `itemCount`, `tableName` to `orders` table
- `packages/backend/convex/orders.ts` — simplify `listActive`, update write paths (`addItem`, `removeItem`, `updateItemQuantity`, `voidItem`, `createAndSendToKitchen`, `create`) to maintain `itemCount`; remove dashboard `activeDineIn`/`activeTakeout` from `getDashboardSummary`
- `packages/backend/convex/tables.ts` — maintain `tableName` on open orders when a table is renamed
- `packages/backend/convex/modifierAssignments.ts` — add `getForProduct` query

**Created (backend):**
- `packages/backend/convex/migrations/2026_04_orderDenormalization.ts` — one-shot internal mutation to backfill `itemCount` + `tableName` on existing open orders
- `packages/backend/convex/orders.test.ts` additions for new write paths, or new `packages/backend/convex/ordersDenorm.test.ts`

---

# Phase 1 — Zero-risk hygiene (ship same day)

No behavior changes. Pure cleanup. Frontend-only.

## Task 1: Gate debug `console.log` calls behind `__DEV__`

**Why:** `OrderScreen.tsx:480` runs `JSON.stringify(result)` inside `console.log` on every send-to-kitchen. With Flipper/debugger attached on QA tablets, this can pause the JS thread for tens of ms per call. Other log lines are lower impact but belong to the same cleanup.

**Files:**
- Modify: `apps/native/src/features/orders/screens/OrderScreen.tsx:429, 439, 459, 480, 505, 581`
- Modify: `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx:446, 507`
- Modify: `apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx:107, 129`
- Modify: `apps/native/src/features/settings/services/bluetoothPrinter.ts:170`
- Modify: `apps/native/src/features/updater/stores/useUpdateStore.ts:129, 154, 220`

- [ ] **Step 1: Wrap every `console.log` listed above in a `__DEV__` guard**

Example transformation for `OrderScreen.tsx:480`:
```ts
// before
console.log("[SendToKitchen] Mutation result:", JSON.stringify(result));

// after
if (__DEV__) console.log("[SendToKitchen] Mutation result:", result);
```

Note: Do NOT keep `JSON.stringify()` even under `__DEV__` — `console.log` already stringifies, and avoiding manual stringify preserves object reference for RN DevTools inspection.

Keep `console.error` calls as-is — those are legitimate error surfacing.

- [ ] **Step 2: Verify no remaining ungated `console.log` in the files above**

Run:
```bash
cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite
grep -nE 'console\.log' apps/native/src/features/orders/screens/OrderScreen.tsx apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx apps/native/src/features/settings/services/bluetoothPrinter.ts apps/native/src/features/updater/stores/useUpdateStore.ts
```
Expected: every hit is preceded by `if (__DEV__)`.

- [ ] **Step 3: Type-check**

```bash
pnpm typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/screens/OrderScreen.tsx \
  apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx \
  apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx \
  apps/native/src/features/settings/services/bluetoothPrinter.ts \
  apps/native/src/features/updater/stores/useUpdateStore.ts
git commit -m "perf(native): gate debug console.log calls behind __DEV__"
```

---

## Task 2: Switch printer-store consumers from full-store destructure to selector

**Why:** `usePrinterConnectionPolling` writes `connectionStatus` every 60s and on every reconnect. Any component that calls `usePrinterStore()` without a selector re-renders on every write — even if it only uses `printKitchenTicket`. This currently hits the two hottest screens (`OrderScreen`, `CheckoutScreen`) on every poll tick.

**Files:**
- Modify: `apps/native/src/features/orders/screens/OrderScreen.tsx:152`
- Modify: `apps/native/src/features/checkout/screens/CheckoutScreen.tsx:79`
- Modify: `apps/native/src/features/order-history/screens/OrderDetailScreen.tsx:50`
- Modify: `apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx:43`
- Modify: `apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx:80`

- [ ] **Step 1: Replace `OrderScreen.tsx:152`**

```ts
// before
const { printKitchenTicket } = usePrinterStore();

// after
const printKitchenTicket = usePrinterStore((s) => s.printKitchenTicket);
```

- [ ] **Step 2: Replace `CheckoutScreen.tsx:79`**

```ts
// before
const { printReceipt: printToThermal, openCashDrawer, cashDrawerEnabled } = usePrinterStore();

// after
const printToThermal = usePrinterStore((s) => s.printReceipt);
const openCashDrawer = usePrinterStore((s) => s.openCashDrawer);
const cashDrawerEnabled = usePrinterStore((s) => s.cashDrawerEnabled);
```

- [ ] **Step 3: Replace `OrderDetailScreen.tsx:50`**

```ts
// before
const { printReceipt: printToThermal } = usePrinterStore();

// after
const printToThermal = usePrinterStore((s) => s.printReceipt);
```

- [ ] **Step 4: Replace `TakeoutOrderDetailModal.tsx:43`**

Same transformation as Step 3.

- [ ] **Step 5: Replace `ReceiptPreviewModal.tsx:80`**

Read the surrounding destructure first (the snippet provided by the audit ends mid-line). Convert each destructured key to its own selector call. The modal is ephemeral, but the change is still cheap and improves mount performance.

- [ ] **Step 6: Type-check and lint**

```bash
pnpm typecheck && pnpm check
```
Expected: exit 0.

- [ ] **Step 7: Smoke-test on device**

Launch the app, open Dine-In → select a table → verify the order-entry screen loads normally, tap +/- on a cart item, tap "Send to Kitchen", open Checkout, print a test receipt. Nothing should behave differently — we only changed subscription granularity.

- [ ] **Step 8: Commit**

```bash
git add apps/native/src/features/orders/screens/OrderScreen.tsx \
  apps/native/src/features/checkout/screens/CheckoutScreen.tsx \
  apps/native/src/features/order-history/screens/OrderDetailScreen.tsx \
  apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx \
  apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx
git commit -m "perf(native): select individual printer-store fields to avoid whole-store re-renders"
```

---

## Task 3: Memoize `AuthContext` value

**Why:** `AuthProvider` renders a fresh `value` object on every render; every `currentUser` update propagates a new reference to every `useAuth()` consumer (most screens). Wrapping in `useMemo` keeps the reference stable when none of the inputs change.

**Files:**
- Modify: `apps/native/src/features/auth/context/AuthContext.tsx:105-114`

- [ ] **Step 1: Add `useMemo` import and memoize `value`**

```ts
// at top
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";

// replace lines 105-114 with:
const value = useMemo<AuthContextType>(
  () => ({
    user: currentUser ?? null,
    isLoading,
    isAuthenticated: isConvexAuthenticated && !!currentUser,
    signIn,
    signOut,
    hasPermission,
  }),
  [currentUser, isLoading, isConvexAuthenticated, signIn, signOut, hasPermission],
);
```

- [ ] **Step 2: Type-check**

```bash
pnpm typecheck
```
Expected: exit 0.

- [ ] **Step 3: Smoke-test login flow**

Log out → log in → confirm HomeScreen loads with user's name. Lock screen → unlock → confirm state restores.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/auth/context/AuthContext.tsx
git commit -m "perf(native): memoize AuthContext value to stop cascading consumer re-renders"
```

---

## Task 4: Memoize HomeScreen derived state and subcomponents

**Why:** `timeString`, `dateString`, and three `activeOrders.filter(...)` calls run every render. Clock ticks every 60s; every Convex order mutation also re-renders Home. Also, `ScoreCard`/`RevenueCard`/`ActionPanel`/`HeaderStat` are defined as plain functions re-created on every Home render. Wrapping them in `React.memo` and memoizing the derived state cuts Home's render cost significantly.

**Files:**
- Modify: `apps/native/src/features/home/screens/HomeScreen.tsx:93-106, 353-640`

- [ ] **Step 1: Memoize time/date strings and counts in `HomeScreen`**

Inside the `HomeScreen` body, replace lines 93-106 with:

```ts
const timeString = useMemo(
  () => clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  [clock],
);
const dateString = useMemo(
  () =>
    clock.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
  [clock],
);

const { dineInCount, takeoutCount, totalOrders } = useMemo(() => {
  if (!activeOrders) return { dineInCount: 0, takeoutCount: 0, totalOrders: 0 };
  let dineIn = 0;
  let takeout = 0;
  for (const o of activeOrders) {
    if (o.orderType === "dine_in") dineIn++;
    else if (o.orderType === "takeout") takeout++;
  }
  return { dineInCount: dineIn, takeoutCount: takeout, totalOrders: activeOrders.length };
}, [activeOrders]);

const averageTicket = useMemo(
  () =>
    summary && summary.totalOrdersToday > 0
      ? summary.todayRevenue / summary.totalOrdersToday
      : null,
  [summary],
);

const permissions = user?.role?.permissions ?? [];
const canUseDayClose = permissions.includes("reports.print_eod");
```

- [ ] **Step 2: Wrap `ScoreCard`, `RevenueCard`, `ActionPanel`, `HeaderStat` in `React.memo`**

At each function definition (lines 353, 423, 489, 618), change:

```ts
// before
function ScoreCard({ value, label, detail, tint, valueColor, icon }: { ... }) { ... }

// after
const ScoreCard = memo(function ScoreCard({ value, label, detail, tint, valueColor, icon }: { ... }) { ... });
```

Apply identically to `RevenueCard`, `ActionPanel`, `HeaderStat`. Add `memo` to the imports from `"react"`.

- [ ] **Step 3: Type-check**

```bash
pnpm typecheck
```
Expected: exit 0.

- [ ] **Step 4: Smoke-test**

Launch app → HomeScreen. Verify clock updates at the minute boundary, order counts reflect current active orders, Dine-In / Takeout tiles navigate correctly. Create and close an order to confirm counts update.

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/home/screens/HomeScreen.tsx
git commit -m "perf(native): memoize HomeScreen derived state and subcomponents"
```

---

# Phase 2 — Optimistic cart mutations (kills PH→US tap latency)

Every cart tap currently waits for a US-region round-trip (~250ms best case, much worse on degraded Wi-Fi). Convex's `useMutation().withOptimisticUpdate` patches the local query cache instantly and reconciles on server response. This phase introduces a single hook that wraps all four cart mutations so the component-side call site stays short.

## Task 5: Create `useCartMutations` hook with optimistic-update scaffolding

**Why:** Centralizing the optimistic-update logic keeps `OrderScreen.tsx` readable and makes the patching rules for `api.orders.get` auditable in one place. Also lets us add tests later without touching the screen.

**Files:**
- Create: `apps/native/src/features/orders/hooks/useCartMutations.ts`

- [ ] **Step 1: Create the hook file with exported signatures only**

```ts
// apps/native/src/features/orders/hooks/useCartMutations.ts
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import type { SelectedModifier } from "../components";

export function useCartMutations() {
  const addItem = useMutation(api.orders.addItem);
  const updateItemQuantity = useMutation(api.orders.updateItemQuantity);
  const removeItem = useMutation(api.orders.removeItem);
  const updateItemServiceType = useMutation(api.orders.updateItemServiceType);

  return { addItem, updateItemQuantity, removeItem, updateItemServiceType };
}

export type CartMutations = ReturnType<typeof useCartMutations>;
```

At this stage the hook is a pass-through — no optimistic updates yet. This step exists so the swap into `OrderScreen` is a separate commit from the optimistic wiring.

- [ ] **Step 2: Wire it into `OrderScreen`**

In `apps/native/src/features/orders/screens/OrderScreen.tsx`, replace the four mutation calls (lines 140-149, keep the others) with:

```ts
const { addItem, updateItemQuantity, removeItem: removeItemMutation, updateItemServiceType } =
  useCartMutations();
```

Add the import:
```ts
import { useCartMutations } from "../hooks/useCartMutations";
```

- [ ] **Step 3: Type-check and smoke-test**

```bash
pnpm typecheck
```
Launch app → add items to a server-backed order → verify +/-/remove/service-type-toggle all work as before.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/hooks/useCartMutations.ts \
  apps/native/src/features/orders/screens/OrderScreen.tsx
git commit -m "refactor(native): extract cart mutations into useCartMutations hook"
```

---

## Task 6: Add optimistic update to `updateItemQuantity`

**Why:** This is the highest-frequency cart mutation (every +/- press). Making it feel instant eliminates the worst of the perceived lag.

**Files:**
- Modify: `apps/native/src/features/orders/hooks/useCartMutations.ts`

- [ ] **Step 1: Replace the plain `useMutation` with an optimistic version**

```ts
const updateItemQuantity = useMutation(api.orders.updateItemQuantity).withOptimisticUpdate(
  (localStore, args) => {
    // Walk every cached `api.orders.get` query and patch the matching item's quantity + lineTotal.
    // We don't know the orderId from args (only orderItemId), so we find it by scanning.
    const allQueries = localStore.getAllQueries(api.orders.get);
    for (const { args: queryArgs, value } of allQueries) {
      if (!value) continue;
      const matched = value.items.find((i) => i._id === args.orderItemId);
      if (!matched) continue;

      const unitPrice = matched.quantity > 0 ? matched.lineTotal / matched.quantity : matched.productPrice;
      const nextItems = value.items.map((i) =>
        i._id === args.orderItemId
          ? { ...i, quantity: args.quantity, lineTotal: unitPrice * args.quantity }
          : i,
      );
      localStore.setQuery(api.orders.get, queryArgs, { ...value, items: nextItems });
    }
  },
);
```

Note on `unitPrice`: we reconstruct it from the cached `lineTotal / quantity` to preserve any modifier/open-price adjustments that are baked into the existing line total. The server will correct any drift on the real round-trip.

- [ ] **Step 2: Verify with React DevTools / manual QA**

Enable Wi-Fi throttling on the tablet (Android Developer Options → Network throttling → "Regular 3G"). Open an order, press + repeatedly. The displayed quantity should update on every tap without waiting for the network; the FlatList row should re-render without stutter.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/orders/hooks/useCartMutations.ts
git commit -m "perf(native): optimistic update for updateItemQuantity — cart +/- feels instant"
```

---

## Task 7: Add optimistic update to `removeItem`

**Files:**
- Modify: `apps/native/src/features/orders/hooks/useCartMutations.ts`

- [ ] **Step 1: Wrap `removeItem`**

```ts
const removeItem = useMutation(api.orders.removeItem).withOptimisticUpdate((localStore, args) => {
  const allQueries = localStore.getAllQueries(api.orders.get);
  for (const { args: queryArgs, value } of allQueries) {
    if (!value) continue;
    if (!value.items.some((i) => i._id === args.orderItemId)) continue;
    localStore.setQuery(api.orders.get, queryArgs, {
      ...value,
      items: value.items.filter((i) => i._id !== args.orderItemId),
    });
  }
});
```

- [ ] **Step 2: Manual QA**

Reduce a cart item's quantity to 1, then confirm the "Remove Item" dialog. Item should disappear from the cart instantly; server round-trip is invisible.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/orders/hooks/useCartMutations.ts
git commit -m "perf(native): optimistic update for removeItem"
```

---

## Task 8: Add optimistic update to `updateItemServiceType`

**Files:**
- Modify: `apps/native/src/features/orders/hooks/useCartMutations.ts`

- [ ] **Step 1: Wrap `updateItemServiceType`**

```ts
const updateItemServiceType = useMutation(api.orders.updateItemServiceType).withOptimisticUpdate(
  (localStore, args) => {
    const allQueries = localStore.getAllQueries(api.orders.get);
    for (const { args: queryArgs, value } of allQueries) {
      if (!value) continue;
      if (!value.items.some((i) => i._id === args.orderItemId)) continue;
      const nextItems = value.items.map((i) =>
        i._id === args.orderItemId ? { ...i, serviceType: args.serviceType } : i,
      );
      localStore.setQuery(api.orders.get, queryArgs, { ...value, items: nextItems });
    }
  },
);
```

- [ ] **Step 2: Manual QA**

On a mixed-category order, toggle a line item between Dine-In and Takeout. Badge should flip instantly.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/orders/hooks/useCartMutations.ts
git commit -m "perf(native): optimistic update for updateItemServiceType"
```

---

## Task 9: Add optimistic update to `addItem`

**Why:** Adding a new item is trickier because we don't know the server-assigned `_id`. We use a placeholder id and let the server reconciliation replace it.

**Files:**
- Modify: `apps/native/src/features/orders/hooks/useCartMutations.ts`

- [ ] **Step 1: Wrap `addItem`**

```ts
let optimisticIdCounter = 0;

const addItem = useMutation(api.orders.addItem).withOptimisticUpdate((localStore, args) => {
  const query = localStore.getQuery(api.orders.get, { orderId: args.orderId });
  if (!query) return;

  // Find productName/price from nowhere — we don't have it here. Skip optimistic add if we can't.
  // Instead, the caller passes a hint via a side-channel: use the prefetched product list cached for the store.
  // For simplicity, we rely on the calling screen to have `products` cached. We fetch from products query cache.
  const productsCache = localStore.getQuery(api.products.list, { storeId: query.storeId });
  if (!productsCache) return;
  const product = productsCache.find((p) => p._id === args.productId);
  if (!product) return;

  const placeholderId = `optimistic-${++optimisticIdCounter}` as Id<"orderItems">;
  const unitPrice = args.customPrice ?? product.price;
  const modifierTotal = (args.modifiers ?? []).reduce((s, m) => s + m.priceAdjustment, 0);
  const lineTotal = (unitPrice + modifierTotal) * args.quantity;

  const newItem = {
    _id: placeholderId,
    productId: args.productId,
    productName: product.name,
    productPrice: unitPrice,
    quantity: args.quantity,
    notes: args.notes,
    isVoided: false,
    isSentToKitchen: false,
    serviceType: undefined,
    lineTotal,
    modifiers: args.modifiers?.map((m) => ({
      groupName: m.modifierGroupName,
      optionName: m.modifierOptionName,
      priceAdjustment: m.priceAdjustment,
    })),
  };

  localStore.setQuery(api.orders.get, { orderId: args.orderId }, {
    ...query,
    items: [...query.items, newItem],
  });
});
```

Note: the `newItem` object must match the shape returned by `api.orders.get`'s `items` field. If the audit misses any fields, TypeScript will surface them — inspect the query's `returns` validator in `orders.ts`.

- [ ] **Step 2: Verify the optimistic item shape compiles**

```bash
pnpm typecheck
```
Expected: exit 0. If it fails, add the missing fields with sensible defaults (`grossSales`, `vatAmount`, etc. are order-level, not item-level — scope confusion here is the most likely TS error).

- [ ] **Step 3: Manual QA with throttled network**

Tablet on 3G throttle. Tap a product → modal → Add. Item should appear in cart within one frame. Server confirmation (item gets its real `_id`) happens silently.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/hooks/useCartMutations.ts
git commit -m "perf(native): optimistic update for addItem"
```

---

## Task 10: Coalesce rapid +/- presses in `CartItem`

**Why:** When a cashier taps + three times in 400ms, the app currently fires three `updateItemQuantity` mutations (three round-trips, three subscription pushes). Coalescing into one delayed mutation with the final quantity cuts mutation count ~70%.

**Files:**
- Modify: `apps/native/src/features/orders/components/CartItem.tsx`

- [ ] **Step 1: Inspect current CartItem signature**

Read the file to confirm where the `onIncrement`/`onDecrement` props land and what their signatures are. If they're `(itemId, currentQty) => Promise<void>` style, we can debounce at the CartItem level without changing the prop contract.

- [ ] **Step 2: Add debounced quantity flush inside `CartItem`**

Inside the `CartItem` component, add:

```ts
import { useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 300;

// inside the component body, alongside other hooks:
const [displayQty, setDisplayQty] = useState(quantity);
const pendingQtyRef = useRef<number | null>(null);
const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// keep displayQty in sync with server-confirmed quantity
useEffect(() => {
  if (pendingQtyRef.current === null) setDisplayQty(quantity);
}, [quantity]);

const scheduleFlush = (nextQty: number) => {
  pendingQtyRef.current = nextQty;
  setDisplayQty(nextQty);
  if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
  flushTimerRef.current = setTimeout(() => {
    const pending = pendingQtyRef.current;
    pendingQtyRef.current = null;
    flushTimerRef.current = null;
    if (pending !== null && pending !== quantity) {
      if (pending < 1) onDecrement(id, 1); // triggers the remove-confirmation path
      else onIncrement(id, pending - 1); // onIncrement expects currentQty then bumps by 1 — we pass pending-1 so currentQty+1 = pending
    }
  }, DEBOUNCE_MS);
};

// on unmount, flush any pending change immediately
useEffect(() => {
  return () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      const pending = pendingQtyRef.current;
      if (pending !== null && pending !== quantity) {
        if (pending < 1) onDecrement(id, 1);
        else onIncrement(id, pending - 1);
      }
    }
  };
}, [id, onDecrement, onIncrement, quantity]);
```

Replace the +/- button handlers:
```ts
// increment button onPress
() => scheduleFlush(displayQty + 1)

// decrement button onPress
() => scheduleFlush(displayQty - 1)
```

Replace the `{quantity}` text display with `{displayQty}`.

**Important:** the `onIncrement(id, pending - 1)` trick is a hack that assumes `onIncrement` is defined as "given current quantity, set to current + 1". Check `OrderScreen.handleIncrement` at line 322-342 — if the signature differs, adjust. A cleaner alternative is to add a `onSetQuantity(id, targetQty)` prop and mutation path; acceptable if the hack feels fragile.

- [ ] **Step 3: Manual QA**

Rapid-tap + 5 times quickly on a cart item. Screen should show qty increment to 5 smoothly; only ONE mutation should fire ~300ms after the last tap. Check Convex dashboard or add a temporary `__DEV__` log in `useCartMutations` to confirm.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/components/CartItem.tsx
git commit -m "perf(native): debounce rapid quantity presses in CartItem to coalesce mutations"
```

---

# Phase 3 — FlatList tuning and modal state fix

## Task 11: Tune `CategoryGrid` FlatList for tablet menus

**Why:** Default `initialNumToRender` is 10, `windowSize` is 21. For a 200-product grid on a tablet, this renders far too many tiles on mount. `getItemLayout` lets FlatList skip measurement since tile heights are uniform.

**Files:**
- Modify: `apps/native/src/features/orders/components/CategoryGrid.tsx:232-251`

- [ ] **Step 1: Measure a `CategoryTile` height**

Open `CategoryTile.tsx` to confirm the tile's intrinsic height (look for `height`, `minHeight`, or `paddingVertical + content`). We need a stable number — record it.

- [ ] **Step 2: Add FlatList tuning props**

```tsx
<FlatList
  data={gridItems}
  numColumns={3}
  keyExtractor={(item) => item.key}
  renderItem={renderItem}
  contentContainerStyle={{ padding: 6 }}
  columnWrapperStyle={{ justifyContent: "flex-start" }}
  initialNumToRender={12}
  maxToRenderPerBatch={12}
  windowSize={5}
  removeClippedSubviews={true}
  // If tile height is e.g. 120px, add:
  // getItemLayout={(_, index) => ({ length: 120, offset: 120 * Math.floor(index / 3), index })}
  ListEmptyComponent={...}
/>
```

Only add `getItemLayout` if tile heights are genuinely uniform. If `CategoryTile` wraps names on 2 lines variably, skip `getItemLayout`.

- [ ] **Step 3: Smoke-test on a store with a large menu**

If no large menu is available locally, seed one: add 120 products via the admin panel. Scroll the order-entry product grid. Verify no blank tiles on fast scroll and no hitch at the start.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/components/CategoryGrid.tsx
git commit -m "perf(native): tune CategoryGrid FlatList for tablet-sized menus"
```

---

## Task 12: Fix `ModifierSelectionModal` state-set during render

**Why:** Lines 91-106 call four setState functions inside the render function body. This works (the condition becomes false after the first render of a new product), but it's an anti-pattern that causes an extra render per product tap and is fragile. Moving to `useEffect` keyed on `product?.id` fixes both.

**Files:**
- Modify: `apps/native/src/features/orders/components/ModifierSelectionModal.tsx:91-106`

- [ ] **Step 1: Replace the render-time init block with a keyed effect**

Remove lines 91-106 and add:

```ts
useEffect(() => {
  if (!product) return;
  const defaults: Record<string, Set<string>> = {};
  for (const group of modifierGroups) {
    const defaultOptions = group.options.filter((o) => o.isDefault);
    defaults[group.groupId] =
      defaultOptions.length > 0 ? new Set(defaultOptions.map((o) => o.optionId)) : new Set();
  }
  setSelections(defaults);
  setQuantity(1);
  setNotes("");
}, [product?.id]);
```

Notes:
- Intentionally keying on `product?.id` (not the whole object) so the effect doesn't re-fire on parent re-renders when the same product stays selected.
- We intentionally don't include `modifierGroups` in deps — when the product changes, the parent passes a fresh groups array for the new product; when it's stable, we don't want to reset user edits.
- `customPriceText` reset at the existing `useEffect` on line 68-77 stays as-is — it's already correct.

- [ ] **Step 2: Delete `initializedRef` (no longer needed)**

Remove line 91 (`const initializedRef = useState<string | null>(null);`).

- [ ] **Step 3: Type-check**

```bash
pnpm typecheck
```
Expected: exit 0.

- [ ] **Step 4: Manual QA**

Tap a product with modifiers → select some → close modal → tap same product → selections should be RESET (defaults applied again) because the effect fires on open (even for same `product.id`, the modal was closed → `visible=false` → reopen doesn't re-trigger). Actually this is subtle: the effect fires only when `product?.id` changes. If the same product is tapped twice in a row, the effect won't re-fire. Decision:

If the desired UX is "reset every time modal opens," change the effect dep to `[product?.id, visible]` and add a guard `if (!visible) return;`.

Pick the UX the team wants. Default to `[product?.id, visible]` with the visible guard — that matches the current behavior (defaults re-applied on every open).

Updated effect:
```ts
useEffect(() => {
  if (!visible || !product) return;
  const defaults: Record<string, Set<string>> = {};
  for (const group of modifierGroups) {
    const defaultOptions = group.options.filter((o) => o.isDefault);
    defaults[group.groupId] =
      defaultOptions.length > 0 ? new Set(defaultOptions.map((o) => o.optionId)) : new Set();
  }
  setSelections(defaults);
  setQuantity(1);
  setNotes("");
}, [product?.id, visible]);
```

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/orders/components/ModifierSelectionModal.tsx
git commit -m "fix(native): move ModifierSelectionModal init from render body to keyed effect"
```

---

# Phase 4 — Consolidate HomeScreen Convex subscriptions

## Task 13: Drop `activeDineIn`/`activeTakeout` from `getDashboardSummary`; derive on client

**Why:** `getDashboardSummary` currently collects all today's orders AND all open orders — the same `by_store_status=open` scan that `listActive` already does. HomeScreen subscribes to both. Move the counts client-side and let the summary query only cover today's totals and revenue.

**Files:**
- Modify: `packages/backend/convex/orders.ts:1347-1389`
- Modify: `apps/native/src/features/home/screens/HomeScreen.tsx` (already done in Task 4 — verify)

- [ ] **Step 1: Update the `getDashboardSummary` query**

Change the returns validator and handler:

```ts
export const getDashboardSummary = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.object({
    totalOrdersToday: v.number(),
    todayRevenue: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const { startOfDay, endOfDay } = getPHTDayBoundaries();

    const todaysOrders = await ctx.db
      .query("orders")
      .withIndex("by_store_createdAt", (q) =>
        q.eq("storeId", args.storeId).gte("createdAt", startOfDay),
      )
      .filter((q) => q.lt(q.field("createdAt"), endOfDay))
      .collect();

    const nonDraftOrders = todaysOrders.filter((o) => o.status !== "draft");
    const totalOrdersToday = nonDraftOrders.length;

    const todayRevenue = todaysOrders
      .filter((o) => o.status === "paid")
      .reduce((sum, o) => sum + o.netSales, 0);

    return { totalOrdersToday, todayRevenue };
  },
});
```

- [ ] **Step 2: Verify convex-test for summary passes (or add one)**

```bash
cd packages/backend
pnpm vitest run --grep "getDashboardSummary"
```

If no existing test, add a smoke test:

```ts
// packages/backend/convex/orders.test.ts (append)
import { expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

test("getDashboardSummary returns today totals only", async () => {
  const t = convexTest(schema);
  // seed a store + user + one paid order today
  // … (match existing test helpers in this file)
  const result = await t.query(api.orders.getDashboardSummary, { storeId });
  expect(result).toHaveProperty("totalOrdersToday");
  expect(result).toHaveProperty("todayRevenue");
  expect(result).not.toHaveProperty("activeDineIn"); // we removed this
});
```

Use the file's existing seeding helpers rather than writing fresh ones.

- [ ] **Step 3: Update HomeScreen to use summary only for today's totals**

The Task 4 work already derived `dineInCount`/`takeoutCount`/`totalOrders` from `activeOrders`. Remove any remaining references to `summary.activeDineIn` / `summary.activeTakeout`. Confirm by:

```bash
grep -n "summary.activeDineIn\|summary.activeTakeout" apps/native/src/features/home/
```
Expected: no results.

The `ScoreCard` for "Orders" was using `summary.totalOrdersToday` — keep that.
The `ScoreCard` for "Dine-In" / "Takeout" should now use `dineInCount` / `takeoutCount` (the derived values). Update the props accordingly — they already use these locals after Task 4, but confirm.

- [ ] **Step 4: Type-check and smoke-test**

```bash
pnpm typecheck
```
Load HomeScreen. Verify "Orders" card shows today's count, "Dine-In"/"Takeout" cards show current active counts, Revenue card shows today's revenue.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts \
  apps/native/src/features/home/screens/HomeScreen.tsx \
  packages/backend/convex/orders.test.ts
git commit -m "perf(backend): drop duplicate active-orders scan from getDashboardSummary; derive counts client-side"
```

---

# Phase 5 — Backend denormalization to kill `listActive` N+1

The remaining `listActive` problem: even after Phase 4, the query does `ctx.db.get(tableId)` + `ctx.db.query("orderItems")` per order. At 30 open orders that's 60 serial reads per subscription tick. Solution: denormalize `tableName` and `itemCount` onto the `orders` row, maintained by existing mutations.

## Task 14: Add `tableName` and `itemCount` to `orders` schema

**Files:**
- Modify: `packages/backend/convex/schema.ts:162-220`

- [ ] **Step 1: Add the two optional fields**

```ts
orders: defineTable({
  // ... existing fields ...
  tabNumber: v.optional(v.number()),
  tabName: v.optional(v.string()),
  requestId: v.optional(v.string()),
  refundedFromOrderId: v.optional(v.id("orders")),

  // NEW: denormalized for fast listActive
  tableName: v.optional(v.string()),
  itemCount: v.optional(v.number()),
})
  // ... existing indexes unchanged ...
```

Both are `optional` so existing rows validate. Backfill happens in Task 18.

- [ ] **Step 2: Deploy schema (dev env first)**

```bash
cd packages/backend && npx convex dev --once
```
Expected: schema update succeeds without data loss errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add tableName and itemCount to orders schema for listActive denorm"
```

---

## Task 15: Maintain `itemCount` in all orderItems write paths

**Why:** Every mutation that creates, updates quantity, voids, or deletes an `orderItems` row must update the parent order's `itemCount`.

**Files:**
- Modify: `packages/backend/convex/orders.ts` — `addItem`, `updateItemQuantity`, `removeItem`, `voidItem`/`unvoidItem`, `createAndSendToKitchen` / `create` (when items are seeded), any bulk-void operations

- [ ] **Step 1: Identify every orderItems write**

```bash
grep -n 'ctx\.db\.insert("orderItems"\|ctx\.db\.patch.*isVoided\|ctx\.db\.delete.*orderItems' packages/backend/convex/orders.ts
```

Write down the list. Also search elsewhere:

```bash
grep -rn 'ctx\.db\.insert("orderItems"' packages/backend/convex/
grep -rn 'ctx\.db\.patch.*isVoided' packages/backend/convex/
```

- [ ] **Step 2: Extract a helper `recomputeOrderItemCount(ctx, orderId)`**

Add near the top of `orders.ts` (after imports, near `getPHTDayBoundaries`):

```ts
async function recomputeOrderItemCount(
  ctx: MutationCtx,
  orderId: Id<"orders">,
): Promise<void> {
  const items = await ctx.db
    .query("orderItems")
    .withIndex("by_order", (q) => q.eq("orderId", orderId))
    .collect();
  const itemCount = items
    .filter((i) => !i.isVoided)
    .reduce((sum, i) => sum + i.quantity, 0);
  await ctx.db.patch(orderId, { itemCount });
}
```

(Import `MutationCtx` from `./_generated/server` if needed.)

- [ ] **Step 3: Call the helper at the end of every orderItems write path**

For each mutation identified in Step 1, add `await recomputeOrderItemCount(ctx, orderId)` after the insert/patch/delete and before returning.

Bulk operations: call once per affected order, after the loop — don't recompute inside the loop.

- [ ] **Step 4: Add a convex-test that verifies itemCount after each write**

```ts
// packages/backend/convex/orders.test.ts
test("itemCount is maintained across add/update/remove/void", async () => {
  const t = convexTest(schema);
  // seed store + user + table + product (use existing helpers)
  const orderId = await t.mutation(api.orders.create, { /* ... */ });

  await t.mutation(api.orders.addItem, { orderId, productId, quantity: 2 });
  let order = await t.query(api.orders.get, { orderId });
  expect(order?.itemCount).toBe(2);

  const itemId = order!.items[0]._id;
  await t.mutation(api.orders.updateItemQuantity, { orderItemId: itemId, quantity: 5 });
  order = await t.query(api.orders.get, { orderId });
  expect(order?.itemCount).toBe(5);

  await t.mutation(api.orders.removeItem, { orderItemId: itemId });
  order = await t.query(api.orders.get, { orderId });
  expect(order?.itemCount).toBe(0);
});
```

- [ ] **Step 5: Run tests**

```bash
cd packages/backend && pnpm vitest run
```
Expected: all tests pass, including the new one.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/orders.test.ts
git commit -m "feat(backend): maintain orders.itemCount across all orderItems write paths"
```

---

## Task 16: Maintain `tableName` on open orders when tables are renamed

**Why:** `tableName` is denormalized but `tables.name` can change (admin renames a table). When it does, we must fan out the rename to every open order on that table.

**Files:**
- Modify: `packages/backend/convex/tables.ts` — the table update/rename mutation
- Modify: `packages/backend/convex/orders.ts` — `create` / `createAndSendToKitchen` / any path that creates an order attached to a table, to snapshot `tableName` at creation

- [ ] **Step 1: Find the table-rename mutation**

```bash
grep -n 'export const update.*= mutation\|ctx\.db\.patch.*tables' packages/backend/convex/tables.ts
```

- [ ] **Step 2: When a table is renamed, patch all open orders**

In the table update mutation, after patching the `tables` row, if the `name` field changed:

```ts
if (args.name !== undefined && args.name !== existing.name) {
  const openOrdersOnTable = await ctx.db
    .query("orders")
    .withIndex("by_tableId_status", (q) => q.eq("tableId", args.tableId).eq("status", "open"))
    .collect();
  for (const o of openOrdersOnTable) {
    await ctx.db.patch(o._id, { tableName: args.name });
  }
}
```

Use the actual parameter names from the mutation signature.

- [ ] **Step 3: At order creation, snapshot `tableName`**

In every order-create path in `orders.ts` (find with `ctx.db.insert("orders"`), when `tableId` is set, also fetch the table and set `tableName`:

```ts
let tableName: string | undefined;
if (args.tableId) {
  const table = await ctx.db.get(args.tableId);
  tableName = table?.name;
}

await ctx.db.insert("orders", {
  // ...
  tableId: args.tableId,
  tableName,
  itemCount: 0,
  // ...
});
```

- [ ] **Step 4: Convex-test for rename fan-out**

```ts
test("renaming a table updates open orders' tableName", async () => {
  const t = convexTest(schema);
  // seed store, table "A", open order on that table
  await t.mutation(api.tables.update, { tableId, name: "B" });
  const order = await t.query(api.orders.get, { orderId });
  expect(order?.tableName).toBe("B");
});
```

- [ ] **Step 5: Run tests, commit**

```bash
cd packages/backend && pnpm vitest run
git add packages/backend/convex/orders.ts packages/backend/convex/tables.ts packages/backend/convex/orders.test.ts
git commit -m "feat(backend): snapshot tableName on order create and fan out on table rename"
```

---

## Task 17: Backfill `itemCount` and `tableName` on existing open orders

**Why:** Rows that exist before Task 15/16 shipped have `undefined` for both fields. `listActive` (Task 18) will start reading them directly, so backfill before switching the read path.

**Files:**
- Create: `packages/backend/convex/migrations/2026_04_orderDenormalization.ts`

- [ ] **Step 1: Create the backfill internal mutation**

```ts
// packages/backend/convex/migrations/2026_04_orderDenormalization.ts
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const backfillOrderDenorm = internalMutation({
  args: {},
  returns: v.object({ updated: v.number() }),
  handler: async (ctx) => {
    const openOrders = await ctx.db
      .query("orders")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    let updated = 0;
    for (const order of openOrders) {
      let tableName: string | undefined;
      if (order.tableId) {
        const table = await ctx.db.get(order.tableId);
        tableName = table?.name;
      }
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .collect();
      const itemCount = items
        .filter((i) => !i.isVoided)
        .reduce((sum, i) => sum + i.quantity, 0);

      await ctx.db.patch(order._id, { tableName, itemCount });
      updated++;
    }
    return { updated };
  },
});
```

- [ ] **Step 2: Run the backfill against dev env**

```bash
cd packages/backend
npx convex run migrations/2026_04_orderDenormalization:backfillOrderDenorm '{}'
```
Expected: `{ updated: N }` where N is the current open-order count.

- [ ] **Step 3: Commit the migration file**

```bash
git add packages/backend/convex/migrations/2026_04_orderDenormalization.ts
git commit -m "chore(backend): add backfill for orders.itemCount and orders.tableName"
```

- [ ] **Step 4: Document the prod run in the PR description**

The prod deploy sequence is (this is PR description boilerplate, not a code step):
1. Merge schema + write-path changes (Tasks 14, 15, 16).
2. Run the backfill in prod: `npx convex run migrations/2026_04_orderDenormalization:backfillOrderDenorm '{}' --prod`.
3. Merge the `listActive` simplification (Task 18).

---

## Task 18: Simplify `listActive` to read denormalized fields

**Files:**
- Modify: `packages/backend/convex/orders.ts:1392-1466`

- [ ] **Step 1: Rewrite `listActive`**

```ts
export const listActive = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.array(
    v.object({
      _id: v.id("orders"),
      orderNumber: v.optional(v.string()),
      orderType: v.union(v.literal("dine_in"), v.literal("takeout")),
      tableId: v.optional(v.id("tables")),
      tableName: v.optional(v.string()),
      pax: v.optional(v.number()),
      customerName: v.optional(v.string()),
      takeoutStatus: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("preparing"),
          v.literal("ready_for_pickup"),
          v.literal("completed"),
          v.literal("cancelled"),
        ),
      ),
      subtotal: v.number(),
      itemCount: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_store_status", (q) => q.eq("storeId", args.storeId).eq("status", "open"))
      .collect();

    return orders.map((order) => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableId: order.tableId,
      tableName: order.tableName,
      pax: order.pax,
      customerName: order.customerName,
      takeoutStatus: order.takeoutStatus,
      subtotal: order.netSales,
      itemCount: order.itemCount ?? 0,
      createdAt: order.createdAt,
    }));
  },
});
```

No more `Promise.all`, no more per-order table/items fetch.

- [ ] **Step 2: Run existing tests**

```bash
cd packages/backend && pnpm vitest run
```
Expected: all tests still pass. The output shape is identical.

- [ ] **Step 3: Load-test manually**

In the admin panel (or a seed script), create 50 open orders across 10 tables. Load HomeScreen on the tablet. Verify the list populates fast and the `itemCount` on each card is correct.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "perf(backend): listActive reads denormalized tableName/itemCount, removes N+1"
```

---

# Phase 6 — Per-product modifier fetch

## Task 19: Add `getForProduct` query

**Files:**
- Modify: `packages/backend/convex/modifierAssignments.ts`

- [ ] **Step 1: Add the per-product query**

```ts
export const getForProduct = query({
  args: {
    productId: v.id("products"),
  },
  returns: v.array(
    v.object({
      groupId: v.id("modifierGroups"),
      groupName: v.string(),
      selectionType: v.union(v.literal("single"), v.literal("multi")),
      minSelections: v.number(),
      maxSelections: v.optional(v.number()),
      sortOrder: v.number(),
      options: v.array(
        v.object({
          optionId: v.id("modifierOptions"),
          name: v.string(),
          priceAdjustment: v.number(),
          isDefault: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    // Reuse the per-product logic from inside getForStore — extract it into a shared
    // `fetchProductModifierGroups(ctx, productId)` helper and call it from both queries.
    // The existing getForStore handler already has this logic; refactor rather than duplicate.
    return fetchProductModifierGroups(ctx, args.productId);
  },
});
```

Refactor `getForStore` to use the same helper so the two queries don't drift.

- [ ] **Step 2: Test**

Add a convex-test verifying `getForProduct` returns the same shape and data as `getForStore` filtered to one product.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/modifierAssignments.ts packages/backend/convex/modifierAssignments.test.ts
git commit -m "feat(backend): add modifierAssignments.getForProduct query"
```

---

## Task 20: Replace `getForStore` usage in `OrderScreen` with per-product fetch

**Files:**
- Modify: `apps/native/src/features/orders/screens/OrderScreen.tsx:122-137, 862, 870`

- [ ] **Step 1: Remove the store-wide prefetch**

Delete `allModifiers`, `modifiersByProduct`, and the `modifierGroups` derivation (lines 122-137). Replace with a conditional per-product query:

```ts
const modifierGroups = useQuery(
  api.modifierAssignments.getForProduct,
  selectedProduct ? { productId: selectedProduct.id } : "skip",
);
```

- [ ] **Step 2: Update modal visibility guards**

Currently lines 862 and 870 check `allModifiers !== undefined` to decide which modal to show. Replace with `modifierGroups !== undefined`:

```tsx
<ModifierSelectionModal
  visible={!!selectedProduct && modifierGroups !== undefined && modifierGroups.length > 0}
  product={selectedProduct}
  modifierGroups={modifierGroups ?? []}
  // ...
/>
<AddItemModal
  visible={!!selectedProduct && modifierGroups !== undefined && modifierGroups.length === 0}
  // ...
/>
```

The tradeoff: a small delay (one RTT) between "tap product" and "modal appears," instead of instant. Mitigation: `ModifierSelectionModal` already accepts `isLoading` — surface `modifierGroups === undefined` as loading state inside the modal, so we show the shell immediately and fill content on arrival. That requires restructuring the visibility logic:

```tsx
<ModifierSelectionModal
  visible={!!selectedProduct}
  product={selectedProduct}
  modifierGroups={modifierGroups ?? []}
  isLoading={isAddingItem || isSending || modifierGroups === undefined}
  onClose={handleCloseModal}
  onConfirm={handleConfirmModifiers}
/>
```

But then we also don't want to show `ModifierSelectionModal` if the product has NO modifiers. Solution: keep the old conditional but allow `modifierGroups` to be loading before committing to one modal or the other. If `product.hasModifiers` is available on the product list (check the schema — `hasModifiers` is on `Product` in `CategoryGrid.tsx:21`), use that to pick the modal before the query resolves:

```tsx
<ModifierSelectionModal
  visible={!!selectedProduct && selectedProduct.hasModifiers}
  product={selectedProduct}
  modifierGroups={modifierGroups ?? []}
  isLoading={isAddingItem || isSending || modifierGroups === undefined}
  onClose={handleCloseModal}
  onConfirm={handleConfirmModifiers}
/>
<AddItemModal
  visible={!!selectedProduct && !selectedProduct.hasModifiers}
  // ...
/>
```

This is the cleanest: `hasModifiers` is the source of truth for which modal, `modifierGroups` fills in content.

- [ ] **Step 3: Type-check**

```bash
pnpm typecheck
```

- [ ] **Step 4: Manual QA**

Tap a product with modifiers → modal shows with loading state if network is slow, then populates. Tap a no-modifier product → AddItemModal shows immediately.

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/orders/screens/OrderScreen.tsx
git commit -m "perf(native): fetch modifier groups per product instead of prefetching whole store"
```

---

## Self-review notes

- **Spec coverage:** All 13 findings from the audit report are represented: console.logs (Task 1), printer store selectors (Task 2), AuthContext (Task 3), HomeScreen memoization (Task 4), cart optimistic updates (Tasks 5-9), quantity debounce (Task 10), CategoryGrid tuning (Task 11), ModifierSelectionModal setState (Task 12), HomeScreen query consolidation (Task 13), listActive N+1 (Tasks 14-18), modifier prefetch (Tasks 19-20). The user-requested optimistic-update idea is Phase 2.
- **Known gap:** Running bills with 50+ line items (`OrderSummary`/`DiscountModal` using `.map()`) is intentionally not addressed — the audit noted it's bounded in practice and not the cause of the hang. If a customer report comes in about large-bill checkout jank, add a follow-up plan to FlashList-ify those.
- **Risk ordering:** Phases 1-3 are mergeable in any order and each is safe to ship independently. Phase 4 depends on Phase 1 Task 4 only for the client derivation. Phase 5 is one logical unit (Tasks 14-18) and must ship in order because the prod backfill must run between Task 17 and Task 18. Phase 6 is independent of Phase 5.
- **Testing coverage:** Backend changes (Phases 4-6) have test steps. Frontend-only changes have manual QA steps because the codebase has no RN component tests. This is deliberate — introducing a test harness for this is its own project.
