# POS sync architecture research

Date: 2026-09-11  
Status: research and architecture direction; no production changes

## Executive conclusion

PMGT Flow does not yet have evidence that Convex or SQLite must be replaced. The present performance problem follows from the replication contract: a reset sets one global WatermelonDB watermark to zero, and the server then pages every store-scoped row in every synchronized table, including the complete order history and its children. The large staging fixture expands 10,050 orders into roughly 100,000 local rows and hundreds of page applications. That is an unbounded operational replica, not an inherent SQLite limitation.

The target should be a **bounded operational replica with an independent durable write journal**:

- Automatically retain the catalog, configuration, staff permissions, tables, all open/draft orders, and the current business day's completed order graph.
- Load older order summaries and details only after an explicit operator action. Treat these rows as disposable historical cache.
- Push local sales before ordinary pulls, and let new operational changes preempt historical downloads.
- Track separate checkpoints for separate replication streams. Never reset one global cursor to repair one data class.
- Distinguish server deletion from local eviction. An order leaving the device's working set must not be deleted from Convex.
- Make local repair a verified shadow rebuild and atomic handover. The working database remains available until the replacement is complete.
- Never erase or silently reinterpret pending sales, payments, voids, discounts, or closing operations.

This direction can be introduced beside the live protocol and rolled out by feature flag. A database or backend migration should be reconsidered only after the bounded design is measured on the real tablet.

## What the current implementation does

The current behavior is visible in the repository:

- `packages/backend/convex/sync.ts` defines one ordered list of store-scoped tables. `pullTablePage` uses `by_store_updatedAt`, so it scopes by store and update watermark but not by operational membership, order state, or business date.
- `apps/native/src/sync/SyncManager.ts` uses one WatermelonDB `lastPulledAt` watermark. `forceFullResync()` sets it to zero and performs the same full-store pull.
- The client invokes `synchronize()` for each server page. Each page is mapped in JavaScript, checked against local records, applied to the database, and allowed to invalidate reactive queries.
- Pushes have a generated `clientMutationId`, and `packages/backend/convex/sync.ts` records processed mutations. This is a useful idempotency foundation, but the pending write state still lives in the same Watermelon database being repaired.
- The backend pull currently returns no deletion tombstones. A reset can restore server state, but normal incremental sync has no general mechanism to distinguish a remote deletion, a record leaving a bounded replica, and a row that should remain locally pinned.

The existing performance investigation documents the measured and reproduced details: [`2026-09-08-tablet-incoming-data-performance.md`](./2026-09-08-tablet-incoming-data-performance.md).

## What established POS products expose

These are product behaviors, not public descriptions of the vendors' internal database designs. They show the operational guarantees and guardrails a production POS considers important.

### Square

Square stores offline payments in the POS app, labels them pending, and uploads them automatically after reconnection. Square explicitly warns that signing out, deleting the app, switching mode or location, or factory-resetting the device can permanently lose pending payments. It also recommends performing disruptive troubleshooting after hours and blocks sign-out while pending offline payments exist ([Square offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode), [Square POS troubleshooting](https://squareup.com/help/us/en/article/4992-square-point-of-sale-app-troubleshooting)).

Architectural lesson for PMGT Flow: pending financial work is a protected data class with visible state and hard destructive-operation gates. A cache repair must not share its fate with disposable downloaded data.

### Toast

Toast stores orders locally when cloud communication is unavailable. In its newer offline mode with local sync, a hardwired local hub relays orders among devices on the restaurant LAN and later to the cloud. Toast says the older cloud-only offline mode will be deprecated in favor of local sync ([Toast offline mode overview](https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html), [Toast local sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html)).

Toast also disables **Resync Orders** and **Resync ALL Data** while offline specifically to prevent erasing stored sales and payments. It warns staff not to clear app data, reinstall, or log out during an outage ([Toast offline mode](https://doc.toasttab.com/doc/platformguide/platformOfflineMode.html)).

Architectural lesson for PMGT Flow: cloud independence and multi-terminal independence are different capabilities. A future store hub can improve same-LAN coordination, but it is a later topology decision; it does not replace bounded device replication. Repair is online-only and pending-work-safe.

### Shopify POS

Shopify imports store products when a user logs in, allows a signed-in device to continue selected checkout operations offline, and automatically syncs orders and inventory after reconnection. It presents connectivity state and lets staff refresh store data or products and inventory separately. Returns, exchanges, and voids are unavailable offline, making the offline capability boundary explicit rather than pretending every cloud workflow is available ([Shopify offline features](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-features), [Shopify POS troubleshooting](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/troubleshooting)).

Shopify warns that logging out or turning off a device can lose offline orders, and that deleting/reinstalling can lose saved local state such as register shifts and carts ([Shopify offline checkout](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-checkout), [Shopify POS troubleshooting](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/troubleshooting)).

Architectural lesson for PMGT Flow: expose readiness by capability and data domain. A specific **Refresh catalog** operation is safer and faster than making every correction a global resync.

## Patterns from technical sync systems

These systems are useful pattern libraries. They are not recommendations to migrate PMGT Flow to those products.

### WatermelonDB: preserve the protocol's safety rules

WatermelonDB tracks unsynced changes and exposes `hasUnsyncedChanges`. Its documentation says not to reset the local database while synchronization is in progress because consistency may be compromised. A push must resolve only after the backend confirms receipt, and the backend is expected to apply a push transactionally and idempotently ([WatermelonDB frontend sync](https://watermelondb.dev/docs/Sync/Frontend), [WatermelonDB backend sync](https://watermelondb.dev/docs/Sync/Backend)).

WatermelonDB's Replacement Sync can repair a mismatch by treating the server payload as the complete accessible dataset while preserving some local changes. The documentation calls it a last resort, says it is much slower than Turbo Login, and notes an important boundary: locally updated or deleted records absent from the replacement dataset are deleted; only locally created rows are unconditionally preserved ([WatermelonDB Replacement Sync](https://watermelondb.dev/docs/Sync/Frontend#advanced-adopting-replacement-sync)).

Implication: WatermelonDB Replacement Sync is not, by itself, a sufficient financial recovery guarantee. Until PMGT Flow has a separate durable operation journal, a replacement or reset must be blocked whenever protected pending work exists. The current paged sync should also remain transactional; WatermelonDB labels per-collection batching unsafe because it breaks transactionality.

### Couchbase Lite / Sync Gateway: scopes, membership, checkpoints, and purge semantics

Couchbase Lite can replicate selected collections and selected channels rather than an entire user-accessible database. Replication checkpoints prevent resending the entire database; resetting a checkpoint intentionally starts replication from zero. Continuous replication uses retry with exponential backoff ([Couchbase Lite Android replication](https://docs.couchbase.com/couchbase-lite/current/android/replication.html)).

When access to a channel is revoked, Couchbase Lite can purge documents from the local database without deleting the server records. If access is regained, clients may need a checkpoint reset to retrieve previously purged documents. Separately, Sync Gateway retains and eventually purges deletion tombstones; its documentation warns that purging is not communicated to other clients ([Couchbase Lite channel auto-purge](https://docs.couchbase.com/couchbase-lite/current/android/replication.html#auto-purge-on-channel-access-revocation), [Sync Gateway database management](https://docs.couchbase.com/sync-gateway/current/database-management.html)).

Implication: PMGT Flow needs explicit **replica membership removal** distinct from **domain deletion**. It also needs tombstone retention long enough for supported offline devices to observe deletions, or a snapshot/repair path that closes the gap after the retention horizon.

### PowerSync: partial, on-demand, and prioritized streams

PowerSync Sync Streams define server-side parameterized subsets to which clients subscribe. Streams can be automatic for offline-required data or requested on demand, and subscriptions can retain a TTL cache after unsubscribe. PowerSync also supports priorities so essential data arrives before lower-priority data; lower-priority work may be interrupted when higher-priority data arrives ([PowerSync Sync Streams announcement](https://releases.powersync.com/announcements/sync-streams-are-now-generally-available), [PowerSync prioritized sync](https://docs.powersync.com/sync/advanced/prioritized-sync)).

PowerSync documents consistency caveats: deletes may not be applied until all priority levels complete, and data whose counts must agree should share a priority. Its architecture applies writes locally and queues them for upload through an application-controlled backend endpoint ([PowerSync architecture](https://powersync.com/)).

Implication: PMGT Flow should copy the separation of **membership**, **priority**, and **checkpoint**, not PowerSync-specific APIs. All rows required to render or settle an order must travel as one consistency unit and priority.

### ElectricSQL: useful shape concept, legacy bidirectional product caveat

ElectricSQL's legacy v0.11 architecture used parameterized Shapes to sync only a required relational subset into local SQLite, including related rows, and kept local writes in an oplog pending replication. Its documentation explicitly framed this as necessary because a central database is often too large to fit on one device ([legacy ElectricSQL Shapes](https://legacy.electric-sql.com/docs/usage/data-access/shapes), [legacy ElectricSQL architecture](https://legacy.electric-sql.com/docs/reference/architecture)).

This is an architectural precedent only. Those pages are marked legacy and should not be used as the basis for a new vendor selection without a separate evaluation of Electric's current product.

### MongoDB Realm / Atlas Device Sync: exclude from a new selection

MongoDB announced that Atlas Device Sync would be phased out by September 30, 2025; MongoDB's API documentation now identifies Device Sync and related App Services as end-of-life ([MongoDB announcement](https://www.mongodb.com/company/blog/innovation/future-proof-your-apps-with-mongodb-wekan), [MongoDB API EOL notice](https://www.mongodb.com/docs/api/)).

Implication: Realm remains relevant historically as a local database, but Atlas Device Sync is not a viable new managed sync dependency for this redesign.

## Proposed PMGT Flow replication contract

### Data classes

| Class | Automatic local availability | Eviction | Examples |
| --- | --- | --- | --- |
| Protected local work | Immediate; survives restart | Never automatic | Local order/payment/discount/void/close operations not yet accepted and echoed by the server |
| Operational replica | Automatic and high priority | Only after verified membership transition | Catalog, modifiers, store config, users/roles needed for a shift, tables, drafts, open orders, current business-day completed order graph, unresolved financial exceptions |
| Historical cache | Explicit, on demand | TTL/LRU or operator refresh | Older order summaries and the child graph for an order explicitly opened by staff |
| Local-only state | Immediate | Feature-specific | Device identity, printer configuration, UI preferences, diagnostics |

“Current business day” must use the store's configured cutoff, not calendar midnight. An order remains operational regardless of age while it is open, pending, disputed, refunded in progress, referenced by an active replacement, or needed for an unclosed day.

### Stream boundaries

Recommended logical streams:

1. `store_core`: store, roles, active users required on device, settings, app configuration.
2. `catalog`: categories, products, modifier groups/options/assignments.
3. `floor`: tables and current table/order linkage.
4. `operational_orders`: order roots selected by operational membership plus all items, modifier snapshots, discounts, voids, and payments required to make each root complete.
5. `history_summary(query)`: explicit server query for a bounded search/date page; disposable.
6. `history_order(orderId)`: explicit complete graph for one selected historical order; disposable or temporarily pinned.

Each automatic stream needs its own versioned checkpoint. On-demand history should not advance, reset, or delay the operational checkpoints.

### Priority policy

1. Protected local pushes and their server acknowledgements.
2. New/changed open orders and operational payment state.
3. Floor/table state and catalog/configuration changes required to sell.
4. Current-day completed-order changes.
5. Explicit historical request currently visible to the operator.
6. Prefetch or maintenance.

Priority must preserve consistency groups. An order root, totals, items, modifiers, discounts, voids, and payments should become visible from one committed local application boundary. Do not show a high-priority order total while its lower-priority children are still absent.

During cashier interaction, priority 1–4 continues in small bounded slices; priority 6 pauses. An explicit history request may run, but it must yield to new operational changes.

### Durable outbox and acknowledgement

The scaling design should move from “dirty rows happen to live in the replica” to an explicit append-only operation journal:

- Every business command has a stable operation ID, device ID, store ID, actor, schema version, creation time, payload hash, and dependency IDs.
- A local transaction writes both the user-visible local projection and the journal entry.
- Server handling is idempotent by operation ID and applies the complete command atomically.
- The client retains the entry until the server accepts it and the authoritative result is observed through replication.
- Permanent rejection is a visible exception requiring a deterministic compensating workflow; it is not silently dropped.
- Repair, pruning, and checkpoint reset operate on the replica, never on the journal.

The repository's `clientMutationId`/`syncedMutations` mechanism is a starting point, but future commands should have stable IDs across retries rather than generate identity only at the network push boundary.

### Leaving the operational window

The server should calculate membership using stable fields, not a moving `now()` predicate hidden inside pagination. For example, publish an explicit `replicaClass`/`operationalUntil` transition or generate a membership delta when a business day closes.

When an order becomes archival:

1. Ensure the server has accepted all protected operations affecting it.
2. Ensure it is not open, pinned, exceptional, or required by an unclosed business day.
3. Emit an **evict-from-operational-replica** event for the root consistency group.
4. Remove its downloaded rows locally without producing a push deletion.
5. Keep server history unchanged and make it available through explicit history APIs.

Domain deletes require a separate tombstone carrying server sequence/version. Keep tombstones for at least the maximum supported offline interval plus upgrade grace. A device whose checkpoint predates retained tombstones must repair that stream from a current bounded snapshot.

## Operator actions and naming

The cashier-facing action should remain:

- **Sync Now** — “Send pending changes and check for the latest POS data.” Safe, incremental, available whenever online, and never clears data.

The maintenance action should be renamed from **Force Resync** to:

- **Repair Local Data** — “Verify and replace downloaded POS data. Pending sales and payments are protected.” Online-only, supervisor/support initiated, diagnostic, and uncommon.

“Repair” describes the operator's goal without implying routine use or exposing database terminology. Inside the repair screen, offer domain-scoped repairs first—**Refresh Catalog**, **Refresh Tables**, or **Repair Today's Orders**—and reserve **Repair All Downloaded Data** for support-level recovery.

Shopify's separate store-data and product/inventory refreshes support domain-scoped language; Toast's disabling of resync while offline supports the safety gate. The exact labels remain a product copy decision, but **Clear Cache** should not be used because staff cannot tell which local data is financially protected.

## Safe repair design

### Near-term behavior on the live architecture

Until a durable journal is physically independent of the replaceable replica:

1. Require online/authenticated state and no sync currently running.
2. Check for unsynced changes using WatermelonDB's supported API.
3. Attempt normal `Sync Now` first.
4. If protected work remains, stop and show counts/categories. Never offer “continue and discard.”
5. Repair only a bounded stream. Do not set the existing global cursor to zero unless performing an explicitly supported legacy recovery outside service hours.

This does not break current behavior; it narrows access to an already risky function.

### Future shadow repair

After the independent journal exists:

1. Freeze the affected stream's checkpoint, not local selling.
2. Download a bounded snapshot into a new database or shadow tables while the current database remains active.
3. Validate store identity, schema/protocol version, manifest counts/checksums, relationship completeness, current-day coverage, and required configuration.
4. Replay/project journal operations onto the shadow replica in dependency order without acknowledging them early.
5. Catch up from the snapshot sequence to a verified current checkpoint.
6. Quiesce local writes briefly, transfer any final journal entries, then atomically switch the active database generation.
7. Retain the previous replica for rollback until the new generation passes a startup/readiness check; then delete only the old downloaded replica.

If any download, validation, replay, or catch-up step fails, discard the shadow copy and continue using the original. This is stronger than clearing first, and avoids asking WatermelonDB Replacement Sync to provide guarantees its documentation does not claim for missing updated/deleted rows.

## Backward-compatible delivery path

### Phase 0 — measure and guard

- Keep the current protocol live.
- Add pending-work counts by financial/domain category and make global force resync inaccessible offline or while work is pending.
- Capture real-device p50/p95 for pull, mapping, preparation, apply/local reads, total page time, tap latency, and frame stalls.
- Add a protocol/version field and feature flag so old clients continue using full sync.

### Phase 1 — bounded read contract beside full sync

- Add server endpoints for bounded operational snapshots/deltas and explicit paged history.
- Compute operational membership from store cutoff, day-closing state, order state, and financial exceptions.
- Add per-stream checkpoints and tests without pruning existing local history yet.
- Shadow-compare the bounded result against the equivalent subset of the full replica.

### Phase 2 — switch automatic pulls, retain rollback

- Enable bounded operational streams for pilot devices.
- Stop automatic historical child replication.
- Keep existing local historical rows temporarily so rollback does not require a full download.
- Introduce explicit history search/detail loading and measure rush-hour behavior.

### Phase 3 — safe eviction and scoped repair

- Add membership-removal events distinct from domain deletes.
- Prune historical cache incrementally under idle/storage-pressure policy.
- Add catalog/floor/today scoped repair with validation.
- Roll out by store/device cohort, with automatic fallback to the old read path but never automatic data clearing.

### Phase 4 — independent operation journal and shadow swap

- Move protected commands into a durable journal with stable operation IDs.
- Implement verified shadow rebuild and atomic generation switch.
- Only then allow repair to proceed while pending work exists; the work survives because it is outside the rebuilt replica.

### Phase 5 — optional store-local hub evaluation

- If the business requires terminals to share orders during an internet outage, evaluate a LAN hub/peer topology separately.
- Do not couple this decision to the bounded cloud-replication rollout. Toast's product behavior shows its value, but leader election, device trust, split-brain recovery, printer routing, and deployment support are a separate program.

## Required correctness and performance tests

- A store with years of history has a bounded automatic row count based on active/current-day workload, not lifetime orders.
- Opening an old order fetches only the requested summary/detail graph and cannot delay a newly arriving open order.
- Cross-midnight cutoff, unclosed prior day, late payment update, refund, replacement order, and aged open order all remain in the operational replica.
- Eviction never emits a Convex domain delete; domain deletion eventually removes local rows after reconnect.
- A client offline longer than tombstone retention is directed to a bounded stream repair.
- Duplicate push, lost acknowledgement, app kill during push, and reconnect preserve exactly-once business effect through idempotency.
- App kill during shadow download, validation, replay, catch-up, or swap leaves either the old or new complete generation usable.
- Repair failure does not interrupt normal selling and does not alter the active replica.
- Old client and new client can use the same production backend during rollout.
- Real-device acceptance retains visible tap feedback under 100 ms, p95 cart response under 300 ms, and operational incoming-order visibility around two seconds while history and repair traffic are active. These targets should be confirmed as release gates.

## Decision guidance

Adopt the bounded replication contract before evaluating a platform migration. The design is implementable on the current Convex and WatermelonDB stack, while its stream, journal, and membership boundaries also make a later storage or sync-engine migration safer.

Re-evaluate alternatives only after profiling the bounded implementation:

- If local apply/query time still dominates, evaluate OP-SQLite or another native local engine.
- If server change-feed/query cost or latency dominates, evaluate a dedicated sync service or backend CDC architecture.
- If multi-terminal operation must survive internet loss, evaluate a store-local hub.
- Do not select Atlas Device Sync, which has reached end of life.

The immediate architectural priority is not a new database. It is defining what must be local, what may be requested, what may be evicted, and what must never be lost.
