# Tablet responsiveness as data arrives

Status: code inspection and isolated scaling reproduction; device diagnosis pending.

## Reported behavior

The user reports that the POS appears fast initially and slows as data arrives. The desired outcome is continuous cashier operation during busy periods. The supplied box identifies a VistaTab 30S with Helio G88; its RAM sticker appears to indicate 4 GB physical plus 8 GB extended RAM, pending device confirmation. Peak workload and actual action latencies are unknown.

## Confirmed implementation findings

- `apps/native/src/sync/dataSources/useTables.ts:79`: observes the entire local `order_items` collection. Its memo filters all items and builds counts for all orders, although the visible orders query selects only open orders in the active store.
- `apps/native/src/sync/dataSources/useOrders.ts:531`: history observes all items even though its orders query is bounded by store and date.
- `apps/native/src/sync/dataSources/useOrders.ts:606`: discount display observes all items and builds a complete item-name map. Checkout calls this hook at `features/checkout/screens/CheckoutScreen.tsx:168`.
- `apps/native/src/db/useObservable.ts:36`: column-aware observers forward emitted arrays to React state. The installed WatermelonDB implementation in `src/observation/subscribeToQueryWithColumns/index.js` emits a copied array when membership or observed columns change. Thus incoming relevant item changes can invalidate the above memos. This is not a claim that every database write causes a render, or that React renders once per row.
- `packages/backend/convex/sync.ts:247`: the store-scoped pull query selects by update time, without an active-order or order-age predicate. Initial synchronization can therefore bring historical rows into these broad observers.
- `apps/native/src/sync/SyncManager.ts:223`: sync is already applied page by page, yielding between pages. Chunking does not remove the consumers' full-history calculations.
- `apps/native/src/features/orders/services/orderMutations.ts:96`: item creation, modifier creation, and order update are separate awaited operations within a writer, followed by totals recalculation. Their time and observer cost remain unmeasured.

Correction to the earlier conversational inspection: `useDraftOrders` already scopes items by draft order IDs. The unbounded hook at line 606 is `useOrderDiscountsQuery`, not draft orders. Order-detail item/modifier queries and totals recalculation also have relevant order/item predicates; the problem is not universal to all queries.

## Executed reproduction

Executed an inline Node harness using the installed TypeScript compiler to transpile the actual `useTables.ts` source. The harness invoked `useTablesListWithOrders`, substituting React memo evaluation and database/observable inputs with deterministic fixtures. An `isVoided` getter counted records inspected. One active order had 10 items; all additional items belonged to closed orders.

| Local item count | Item-query predicates | Items inspected | Visible active items |
| --- | --- | --- | --- |
| 100 | 0 | 100 | 10 |
| 10,000 | 0 | 10,000 | 10 |
| 100,000 | 0 | 100,000 | 10 |

The command completed successfully and asserted those counts. This proves linear work in total local history for unchanged visible output. It does not reproduce native SQLite, live sync emissions, React scheduling, tablet memory pressure, or end-to-end tap latency. The synthetic data sizes are not measurements of the user's store.

`adb devices -l` returned no attached devices. No exact tablet-lag reproduction or profiler trace is available. No application changes were made.

## Assessment and next verification

The code contains an avoidable source of increasing JavaScript work as data arrives. This supports investigating subscription breadth before adopting background runtimes or changing frameworks. It does not establish SQLite throughput exhaustion, a memory leak, or that these scans explain all reported lag.

First measure and narrow these subscriptions, preserving correct counts and discount names. Compare the same active orders with increasing retained history and incoming updates in a release build on the actual tablet. Capture tap-to-visible-cart latency, JavaScript blocking, database-call duration, and memory. Test mounted background screens as well as the visible screen. Only select worker or native offloading for expensive work that remains after narrowing the data.

No architecture decision has been accepted; no migration ADR is warranted yet.

## Hotfix 3.27.2

Implemented four bounded-query changes using existing indexes:

- Tables subscribe to items belonging to the current store's open orders.
- History subscribes to items belonging to orders in the selected store/date range.
- Checkout discount names load items only for the selected order.
- Takeout applies its inclusive date bounds in the orders query before loading related items and modifiers.

Validation: `pnpm --dir apps/native test:query-performance` invokes actual hook source and the installed WatermelonDB query matcher against deterministic snapshots. With 0 and 10,000 unrelated historical orders, each affected query hydrates only the same 2 relevant items. Counts exclude voided items, discount names remain correct, and takeout totals include modifiers. Missing store/order scope loads no items. This harness bypasses React subscription lifecycles and native SQLite, so it is not a device latency benchmark.

Native typechecking and all 9 existing Jest suites (28 tests) passed. Independent review found no blocking issues. The Android JavaScript/Hermes bundle export completed successfully; this is not a signed APK build or deployment. Hermes and New Architecture are already enabled in app and Android configuration.

Remaining audit findings, not changed in this hotfix:

- History loads related items for the date window before applying search/status and its 50-result limit. Narrowing that further is possible.
- `orders.created_at` has no local index. Date constraints reduce hydrated results, but database scanning still needs device profiling before adding a schema migration.
- Product modifier selection subscribes to broad catalog collections and builds modifiers for all products (`useModifiers.ts:270`). This grows with catalog size rather than order history.
- Paid-order refund processing loads all local modifiers (`voidMutations.ts:271`). Scope that in a separately tested financial workflow change.
- Add-item writes and totals recalculation issue multiple updates. Batch/notification changes require mutation and financial correctness tests.
- Mounted background screens can retain subscriptions. Focus-aware lifecycle changes need navigation and resume validation.

These are code-level workload findings, not measurements of their relative contribution to the user's lag. The release still needs a real-tablet smoke test covering incoming sync, rapid item entry, changing dates/orders, payment, printing, and offline reconnect. A dependent query may briefly show a loading state when its parent order membership changes, matching the existing active-order query pattern.
