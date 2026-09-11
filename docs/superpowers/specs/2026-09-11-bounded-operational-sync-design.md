# Bounded Operational Sync Redesign

**Date:** 2026-09-11
**Status:** Approved for autonomous implementation
**Scope:** Native POS sync, Convex sync endpoints and schema, order history, Day Closing, repair controls, diagnostics, and rollout safety

## Problem

The live tablet downloads every store-scoped order and every historical child row. A large restaurant fixture expands 10,050 orders into roughly 100,000 synchronized rows, which are processed through hundreds of network, mapping, existence-check, SQLite-apply, and reactive-invalidation cycles. Performance therefore trends with the lifetime history of a store instead of the data needed to operate the current Business Day.

The current **Force Resync** only resets one global WatermelonDB watermark. It redownloads full history, cannot remove local rows absent from the server, and does not prove that Pending Local Work was delivered before starting. `syncNow()` likewise reports completion of an attempt, not a delivery receipt, while Day Closing treats it as a clean-sync gate.

The system is live. The existing v1 protocol and user flows must remain available throughout migration, and no rollout step may delete server data, Pending Local Work, or the currently usable local replica.

## Outcome

Day-to-day POS performance depends on the current operational workload, not lifetime sales history. The tablet remains fully usable offline for seven consecutive days, protects every local business operation, loads older history explicitly, and can repair downloaded data without clearing first.

Convex and WatermelonDB remain in place until the bounded architecture is measured on the real Helio G88 tablet. The redesign creates clean seams so either technology can be replaced later without changing business semantics.

## Domain Contract

Canonical terminology lives in `CONTEXT.md`.

### Local data classes

| Class | Availability | Removal rule |
| --- | --- | --- |
| Pending Local Work | Written immediately and durable across restart | Never automatic; retained until accepted and observed or placed in attention-required state |
| Operational Replica | Automatic, high priority, offline-ready | Removed only after a verified Replica Membership transition |
| Historical Cache | Explicitly requested | TTL/LRU eviction unless pinned |
| Local-only state | Feature-specific | Existing feature policy |

An **Order Aggregate** contains the order root, items, modifier snapshots, discounts, voids, and payments needed to interpret it completely.

### Operational Order membership

An Order Aggregate belongs to the Operational Replica when any condition is true:

- status is `draft` or `open`;
- it belongs to the current or another unsettled Business Day;
- it has Pending Local Work or an attention-required operation;
- it has an unresolved payment, void, refund, or replacement-order dependency;
- it was explicitly pinned for an active workflow.

Membership is explicit server state or an explicit membership event. It must not be a moving `Date.now()` predicate hidden inside pagination. Leaving the Operational Replica is local eviction, never a Convex order deletion.

### Business Day and settlement

- Offline devices assign a provisional Business Day using the store schedule and device time.
- The server assigns the Canonical Business Day when accepting the operation.
- Known clock drift over two minutes produces a warning. Drift over fifteen minutes, or drift that changes the Canonical Business Day, requires manager attention.
- A Settled Business Day has no known unobserved device operations and has a complete server report snapshot.
- Z-Report printing does not determine settlement.
- If an Active Tablet is unavailable, the server may create a versioned Preliminary Day Report. The day remains unsettled and identifies missing devices.
- Late reconciliation creates a new immutable Report Revision. It never silently rewrites earlier evidence.

## Architecture

### Deep modules and seams

The redesign introduces four external seams. UI and domain mutation callers do not learn transport cursors, storage generations, or repair mechanics.

1. **Operation Journal**
   - Interface: append a business command, observe its lifecycle, enumerate attention-required entries, and prove whether a scope is Sync-Clean.
   - Implementation: journal-first durable storage, idempotent projection, independent uploader, stable operation identities, schema-versioned payloads.

2. **Operational Replicator**
   - Interface: start/stop, request operational refresh, observe readiness/progress, and await a specific server checkpoint.
   - Implementation: versioned per-stream checkpoints, event consumption, bounded snapshots, aggregate hydration, membership entry/exit, and atomic local application.

3. **History Gateway**
   - Interface: paged summary search and explicit aggregate retrieval/pinning.
   - Implementation: server-side filtering/pagination plus a disposable local Historical Cache. History traffic is preemptible.

4. **Replica Repair**
   - Interface: diagnose and repair a named scope while reporting safety preconditions and progress.
   - Implementation: current-generation preservation, bounded shadow snapshot, validation, catch-up, journal replay, atomic handover, and rollback.

The existing `SyncManager` becomes a compatibility facade during rollout. V1 callers continue to work while v2 delegates to the new modules.

### Server replication event feed

Every server mutation affecting replicated state appends an event in the same Convex transaction. Events are store-scoped and include:

- protocol version;
- stream name;
- aggregate or document identity;
- authoritative version;
- event kind (`upsert`, `domain_delete`, `membership_enter`, `membership_leave`, `business_day_settled`);
- server creation time and optional causating operation ID.

The event is a change notification, not a copy of an entire aggregate. The client fetches the latest authoritative representation, so repeated pending events for one identity may be coalesced before hydration. A stable event cursor is stream-specific. Convex `_creationTime`, with the document ID as the deterministic tie-breaker, provides ordered pagination; opaque Convex cursors are used only with the exact query that produced them.

Domain mutations and their events are atomic. Large snapshot construction may use multiple bounded queries, but the snapshot declares a generation and a start checkpoint; the client catches up from that checkpoint before declaring readiness.

### Logical streams and priority

| Priority | Stream/work |
| --- | --- |
| 0 | Operation Journal upload and acknowledgement lookup |
| 1 | Changed Operational Order aggregates and financial exceptions |
| 2 | `store_core`, `floor`, and selling-critical catalog/config changes |
| 3 | Current-day completed orders |
| 4 | Explicit history request currently visible to staff |
| 5 | Prefetch, pruning, diagnostics, and repair download |

Automatic streams:

- `store_core`: store, required roles/users, settings, app configuration;
- `catalog`: categories, products, modifier groups/options/assignments;
- `floor`: tables and current order linkage;
- `operational_orders`: Operational Order roots and complete child graphs.

On-demand streams:

- `history_summary(query)`: bounded server search results;
- `history_order(orderId)`: one complete historical Order Aggregate.

Each automatic stream owns a schema-versioned checkpoint and snapshot generation. Resetting one stream does not advance, reset, or block another stream.

### Operation Journal

The journal stores business commands, not arbitrary row mutations. Every command contains:

- stable `operationId`, `storeId`, `deviceId`, actor ID, command name, schema version;
- device occurrence time, timezone, monotonic local sequence, and provisional Business Day;
- payload and payload hash;
- dependency operation IDs or aggregate version precondition;
- lifecycle state and last structured error.

Lifecycle:

`pending → sending → accepted → observed`

Permanent business rejection becomes `attention_required`. Transient transport errors return the entry to retry without changing identity. Once an entry becomes `sending`, its identity and payload are immutable.

Safe, not-yet-sent intent updates such as repeated `SetItemQuantity` operations may compact to the latest value. Payments, discounts, voids, refunds, order creation, order settlement, and any operation already sent never compact.

The server processes commands synchronously and idempotently. Financial operation identity remains on the resulting domain record permanently; it does not rely only on the seven-day `syncedMutations` cache. The authoritative replication event includes the operation ID, allowing the client to advance from `accepted` to `observed`.

Journal persistence is independent from replaceable replica generations. Writes are journal-first and projections are idempotent: after a crash, startup replays any command not known to have reached its local projection. An app upgrade retains original command schema versions; server-side upcasters support every commissioned tablet version still allowed to sync.

### Settle Order

`SettleOrder` is one business command that commits:

- frozen order totals and tax classification;
- one or more payment records;
- order paid state and timestamps;
- takeout transition where applicable;
- table release where applicable.

The local visible projection and journal append are one recoverable operation, and Convex applies the server result in one mutation. Receipt printing happens after local commitment and is independently retryable. Printer failure cannot repeat payment.

### Aggregate transfer and local application

Network transfer may be paged, but an Order Aggregate is staged until its declared children and version are complete. The active local tables change in one database write, so observers never see a root with missing children or partially updated totals.

The uploader, operational downloader, and history downloader are independent loops. Priority 0–3 work preempts history and repair. During a cashier interaction, maintenance work pauses or yields in small bounded slices.

## Historical Access

The History Gateway performs date, status, order number, customer, and table filtering on the server before returning a bounded summary page. It never hydrates children for unselected results.

- Seven Business Days of summaries may remain cached.
- Selecting an older result explicitly downloads its complete Order Aggregate.
- Downloaded details remain for 24 hours or until a configured size limit is reached.
- A pinned, operationally referenced, or attention-required aggregate cannot be evicted.
- Reprinting works offline only if the aggregate is already local.
- Starting a refund for a non-local historical order requires connectivity and pins the aggregate through completion.
- A late server financial change automatically emits `membership_enter` and restores the complete aggregate at operational priority.

## Refresh and Repair

### Operator actions

- **Sync Now**: any authenticated cashier; sends Pending Local Work and checks eligible operational streams; never clears data.
- **Refresh POS Data**: manager with settings permission; opens scoped actions:
  - **Refresh Menu & Settings**
  - **Refresh Tables**
  - **Reload Current Business Day**
- **Full Local Repair**: support-authorized manager using a time-limited support code; always audit-logged.

Avoid **Clear Cache**, **Force Sync**, and **Force Resync** in routine UI.

### Transitional safety

Until the independent journal and repair generation exist:

1. Keep v1 behavior for compatibility and rollback.
2. Put legacy Force Resync behind support authorization.
3. Require online authentication, no active sync, and WatermelonDB `hasUnsyncedChanges() === false`.
4. Attempt ordinary Sync Now first and show remaining protected categories.
5. Do not add pruning to the v1 cursor-reset path.

### Shadow repair

The future repair sequence is:

1. Freeze the affected stream checkpoint while selling continues.
2. Download a bounded snapshot into shadow tables or a new replica generation.
3. Validate store, protocol/schema version, manifest counts/checksums, relationship completeness, current Business Day coverage, and selling-critical configuration.
4. Replay/project unobserved journal operations without acknowledging them early.
5. Catch up from the snapshot checkpoint.
6. Quiesce local writes briefly, transfer final journal entries, and atomically activate the new generation.
7. Retain the old generation until a startup/readiness probe succeeds, then delete only downloaded replica data.

Failure before activation discards the shadow generation and leaves the active replica untouched. Priority 0–4 work preempts repair. Full repair is cancellable before activation.

## Day Closing and Device Lifecycle

Day Closing uses a dedicated `confirmReadyForDayClosing()` contract; it does not infer success from background sync completion.

The server tracks every Active Tablet. Final settlement requires a post-cutoff Sync-Clean assertion from each device. When a device is missing, a manager may produce a Preliminary Day Report, but cannot mark the day settled. A later upload produces a new Report Revision.

Device Retirement is allowed only when the device is Sync-Clean or through an audited lost-device flow that records the last observed operation, affected Business Days, manager, reason, and explicit acknowledgement that never-uploaded work cannot be recovered without another copy.

## Compatibility and Rollout

### Phase 0 — measure and guard

- Preserve v1 behavior.
- Add protocol capability negotiation, protected-work visibility, truthful sync outcomes, and Force Resync gates.
- Capture current real-device phase and interaction baselines.

### Phase 1 — bounded v2 shadow contract

- Add event feed, bounded snapshots, history endpoints, and per-stream checkpoints.
- Populate events from domain mutations.
- Shadow-compare v2 membership and aggregate payloads with the equivalent v1 subset.
- Do not prune or switch production reads.

### Phase 2 — pilot v2 reads

- Enable v2 operational streams for selected staging devices, then store/device cohorts.
- Stop automatic historical child replication for enabled devices.
- Retain existing local history temporarily for instant rollback.
- Enable explicit history search/detail.

### Phase 3 — safe eviction and scoped repair

- Process membership-removal events.
- Evict cache incrementally while idle.
- Enable scoped Refresh POS Data after shadow validation passes.

### Phase 4 — independent journal and shadow handover

- Migrate business mutations to versioned commands.
- Enable journal-aware Sync-Clean and Day Closing.
- Enable repair while selling and Full Local Repair.

The server supports v1 and v2 concurrently throughout rollout. A feature flag can return a device to the old read path, but rollback never deletes the journal or Pending Local Work. Production enablement and traffic generation remain manual release actions.

## Failure Handling

- Network and server failures retry with bounded exponential backoff and jitter.
- A new priority 0–3 request interrupts or pauses history/repair work.
- Lost acknowledgement triggers operation-status lookup and safe resend with the same ID.
- Validation or authorization rejection becomes structured attention-required state.
- Checkpoint older than retained events triggers scoped bounded repair, not full-store replay.
- App termination during staged aggregate apply or shadow repair leaves the prior committed generation readable.
- Unsupported command versions prevent upload and surface update/support guidance without mutating the journal.

## Security and Privacy

- No diagnostic payloads, customer identifiers, payment references, credentials, or command bodies leave the device through performance telemetry.
- Repair authorization is time-limited and audit-logged.
- Historical search remains store-scoped and permission-checked.
- Existing local-at-rest protections remain the minimum; journal encryption/key management is required before enabling journal-based repair on production devices.

## Verification

### Correctness

- Exactly-once business effects across duplicate upload, lost acknowledgement, reconnect, and app termination.
- Complete aggregate visibility across pages and concurrent server updates.
- Cross-midnight Business Day assignment, clock drift, unsettled days, Preliminary Day Reports, Report Revisions, and late device reconciliation.
- Refund, void, replacement order, discount, payment, receipt, and table-release invariants.
- Membership eviction never emits a server domain delete.
- A client beyond event retention is directed to scoped repair.
- Old and new clients operate concurrently against one backend.
- Repair failure retains the previous usable replica and journal.

### Scale envelope

- 100,000 historical server orders do not increase automatic local row count or operational sync time.
- 2,000 orders in one Business Day and roughly 40,000 operational order rows.
- 10 tablets per store.
- Seven consecutive unsettled Business Days as the exceptional recovery case.
- Seven days of continuous offline selling without data expiry.

### Real-tablet release gates

- Visible tap feedback under 100 ms.
- p95 item-to-visible-cart response under 300 ms.
- Incoming Operational Order visible around two seconds.
- No sustained latency or memory growth as server history increases.
- History and maintenance work cannot violate operational gates.

Every acceptance report records device, build, store fixture, operational/history row counts, network profile, sample count, and p50/p95/max timings. Synthetic tests are labeled as proxies and cannot satisfy device gates.

## Out of Scope

- Replacing Convex, WatermelonDB, React Native, or SQLite before bounded-design measurements.
- Same-LAN multi-tablet replication or a store hub.
- General concurrent editing of one open order; Origin Tablet ownership remains.
- Offline first-time authentication.
- Production deployment, fixture traffic, or destructive device reset without an explicit release action.

## Sources

- [`2026-09-11-pos-sync-architecture-research.md`](../../investigations/2026-09-11-pos-sync-architecture-research.md)
- [`2026-09-08-tablet-incoming-data-performance.md`](../../investigations/2026-09-08-tablet-incoming-data-performance.md)
- [`2026-09-08-rush-hour-performance.md`](../../specs/2026-09-08-rush-hour-performance.md)
- [`2026-04-27-offline-first-pos-tablet-design.md`](./2026-04-27-offline-first-pos-tablet-design.md)
- [`2026-04-30-sync-progress-and-chunked-apply-design.md`](./2026-04-30-sync-progress-and-chunked-apply-design.md)
