# Bounded Operational Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace lifetime-history automatic synchronization with a versioned bounded operational contract while protecting the live v1 POS path.

**Architecture:** Add store-scoped replication events and bounded snapshot/history endpoints in Convex, then add a feature-flagged native v2 orchestrator with independent stream checkpoints. Follow with a durable business-command journal, explicit delivery outcomes, scoped repair, and store-level Day Closing readiness; v1 remains available until v2 acceptance passes.

**Tech Stack:** TypeScript, Convex, React Native 0.81, Expo 54, WatermelonDB 0.28, AsyncStorage, Vitest/convex-test, Jest

## Global Constraints

- Do not use git worktrees; implementation is on a normal branch from `staging`.
- Keep `/sync/pull` and `/sync/push` behavior compatible for v1 clients.
- Do not delete server history or Pending Local Work.
- Do not enable v2 in production or start fixture traffic as part of implementation.
- Automatic v2 replication includes drafts, open orders, unsettled Business Days, and unresolved financial exceptions; history is explicit.
- Order Aggregates become visible atomically.
- Release gates are tap feedback under 100 ms, p95 cart response under 300 ms, and incoming Operational Order visibility around two seconds on the target tablet.

---

### Task 1: Add protocol capabilities and truthful sync outcomes

**Files:**
- Modify: `apps/native/src/sync/types.ts`
- Modify: `apps/native/src/sync/SyncManager.ts`
- Modify: `apps/native/src/sync/syncEndpoints.ts`
- Test: `apps/native/src/sync/__tests__/SyncManager.test.ts`

**Interfaces:**
- Produces: `SyncOutcome`, `SyncSafety`, `syncManager.syncForDelivery()` and `syncManager.getSafety()`.

- [ ] Write tests proving background `syncNow()` remains non-throwing while `syncForDelivery()` returns `delivered`, `offline`, `failed`, `backoff`, or `pending`.
- [ ] Add the exact types:

```ts
export type SyncOutcome =
  | { kind: "delivered"; observedAt: number }
  | { kind: "offline" }
  | { kind: "backoff"; retryAt: number }
  | { kind: "pending"; count: number }
  | { kind: "failed"; message: string };

export type SyncSafety = {
  isOnline: boolean;
  isRunning: boolean;
  hasUnsyncedChanges: boolean;
};
```

- [ ] Implement `getSafety()` with WatermelonDB `hasUnsyncedChanges()` and implement `syncForDelivery()` without changing `syncNow()` callers.
- [ ] Run `pnpm --dir apps/native jest --runInBand src/sync/__tests__/SyncManager.test.ts` and `pnpm --dir apps/native typecheck`.
- [ ] Commit as `feat(sync): add explicit delivery outcomes`.

### Task 2: Guard legacy Force Resync and add scoped maintenance copy

**Files:**
- Modify: `apps/native/src/features/settings/screens/SettingsScreen.tsx`
- Modify: `apps/native/src/sync/SyncManager.ts`
- Test: `apps/native/src/sync/__tests__/SyncManager.test.ts`

**Interfaces:**
- Consumes: `SyncSafety`, `syncForDelivery()`.
- Produces: guarded `prepareLegacyResync()` and truthful **Refresh POS Data** UI.

- [ ] Write tests proving legacy reset refuses offline, in-flight, failed-delivery, and unsynced states and never writes the watermark in those cases.
- [ ] Implement:

```ts
export type ResyncReadiness =
  | { ready: true }
  | { ready: false; reason: "offline" | "syncing" | "pending" | "failed" };
```

- [ ] Replace the routine Settings label with **Refresh POS Data** and describe the current guarded action as **Reload downloaded data**; retain the legacy method behind the confirmation until v2 scoped repair exists.
- [ ] Require `system.settings` permission and a successful readiness check before cursor reset.
- [ ] Run focused Jest, native typecheck, and Biome on touched files.
- [ ] Commit as `fix(sync): guard legacy local data refresh`.

### Task 3: Add the v2 server event and device schema

**Files:**
- Modify: `packages/backend/convex/schema.ts`
- Create: `packages/backend/convex/lib/replicationEvents.ts`
- Create: `packages/backend/convex/lib/replicationEvents.test.ts`

**Interfaces:**
- Produces: `appendReplicationEvent(ctx, event)` and tables `replicationEvents`, `deviceSyncStates`, `businessDayReportRevisions`.

- [ ] Write schema/behavior tests for store isolation, event ordering, stable operation identity, device state, and immutable report revisions.
- [ ] Add validators for stream names and event kinds and indexes beginning with `storeId` followed by stream/business date fields.
- [ ] Implement `appendReplicationEvent` as a helper callable inside existing Convex mutations; it must not schedule a separate transaction.
- [ ] Run focused Vitest, backend typecheck, and Biome.
- [ ] Commit as `feat(sync): add replication event ledger`.

### Task 4: Publish order aggregate events transactionally

**Files:**
- Modify: `packages/backend/convex/sync.ts`
- Modify: order-affecting domain mutation modules under `packages/backend/convex/`
- Test: `packages/backend/convex/sync.test.ts`
- Test: `packages/backend/convex/paymentReconciliation.test.ts`

**Interfaces:**
- Consumes: `appendReplicationEvent`.
- Produces: one `operational_orders` event per committed aggregate version with optional causating operation ID.

- [ ] Add failing tests for create, item edit, discount, void, refund, payment, table transfer, and late financial correction.
- [ ] Add a shared `touchOrderForReplication(ctx, orderId, event)` helper so domain mutations do not duplicate event payload rules.
- [ ] Ensure event write and business mutation share one Convex transaction; no `scheduler.runAfter`.
- [ ] Preserve v1 `updatedAt` fields and v1 sync tests.
- [ ] Run all backend tests.
- [ ] Commit as `feat(sync): publish order aggregate changes`.

### Task 5: Add bounded operational snapshot and delta endpoints

**Files:**
- Create: `packages/backend/convex/syncV2.ts`
- Modify: `packages/backend/convex/http.ts`
- Modify: `packages/backend/convex/schema.ts`
- Test: `packages/backend/convex/syncV2.test.ts`

**Interfaces:**
- Produces: `POST /sync/v2/capabilities`, `/sync/v2/snapshot`, and `/sync/v2/pull`.

- [ ] Write tests with 100,000 synthetic historical roots represented compactly and a small operational set; assert returned automatic membership is unchanged by history size.
- [ ] Define response envelopes:

```ts
type StreamCheckpoint = { stream: string; eventCursor: string | null; generation: string };
type AggregateEnvelope = {
  order: Record<string, unknown>;
  items: Record<string, unknown>[];
  modifiers: Record<string, unknown>[];
  discounts: Record<string, unknown>[];
  voids: Record<string, unknown>[];
  payments: Record<string, unknown>[];
};
```

- [ ] Snapshot current/unsettled Business Days plus draft/open/exception orders through indexed queries; deduplicate roots before hydrating children.
- [ ] Pull replication events by exact opaque cursor query, coalesce roots, and hydrate the latest complete envelope.
- [ ] Return snapshot generation/start checkpoint so the client can catch up after paged hydration.
- [ ] Register authenticated HTTP routes without altering v1 routes.
- [ ] Run focused and full backend tests.
- [ ] Commit as `feat(sync): add bounded v2 operational endpoints`.

### Task 6: Add paged history summary and aggregate endpoints

**Files:**
- Modify: `packages/backend/convex/syncV2.ts`
- Test: `packages/backend/convex/syncV2.test.ts`

**Interfaces:**
- Produces: `POST /sync/v2/history/search` and `/sync/v2/history/order`.

- [ ] Write tests for store isolation, business/date bounds, status, order number/customer/table search, pagination, result limits, and one-order child hydration.
- [ ] Search roots on indexed date/status ranges before applying bounded text matching; never hydrate children for summary pages.
- [ ] Require explicit order ID for detail and return one complete envelope plus authoritative version.
- [ ] Run backend tests and typecheck.
- [ ] Commit as `feat(sync): add explicit historical order access`.

### Task 7: Add native v2 checkpoint and transport modules

**Files:**
- Create: `apps/native/src/sync/v2/types.ts`
- Create: `apps/native/src/sync/v2/checkpoints.ts`
- Create: `apps/native/src/sync/v2/endpoints.ts`
- Test: `apps/native/src/sync/v2/__tests__/checkpoints.test.ts`
- Test: `apps/native/src/sync/v2/__tests__/endpoints.test.ts`

**Interfaces:**
- Produces: versioned `CheckpointStore` and typed v2 endpoint adapter.

- [ ] Test store/device/stream isolation, generation replacement, corrupted metadata recovery, and authenticated request shapes.
- [ ] Store small checkpoint metadata under namespaced AsyncStorage keys; never reuse Watermelon's global watermark.
- [ ] Add opt-in `EXPO_PUBLIC_SYNC_V2=1`; default remains v1.
- [ ] Run focused Jest and native typecheck.
- [ ] Commit as `feat(sync): add v2 checkpoint transport`.

### Task 8: Apply complete aggregates atomically and shadow-compare membership

**Files:**
- Create: `apps/native/src/sync/v2/aggregateApply.ts`
- Create: `apps/native/src/sync/v2/OperationalReplicator.ts`
- Test: `apps/native/src/sync/v2/__tests__/aggregateApply.test.ts`
- Test: `apps/native/src/sync/v2/__tests__/OperationalReplicator.test.ts`

**Interfaces:**
- Consumes: v2 endpoints and `CheckpointStore`.
- Produces: `OperationalReplicator.start()`, `.requestSync()`, `.awaitCheckpoint()` and atomic `applyAggregateEnvelope()`.

- [ ] Test that observers cannot see partial order children, newer aggregate versions win, history traffic is preempted, and checkpoints advance only after committed apply.
- [ ] Stage all create/update/delete operations for one envelope and commit them in one Watermelon writer batch.
- [ ] Add shadow mode that records numeric membership/count mismatches without changing v1 reads or logging business payloads.
- [ ] Wire v2 startup only behind the opt-in flag; retain v1 as default and rollback.
- [ ] Run focused Jest, rush-hour query harness, and native typecheck.
- [ ] Commit as `feat(sync): add shadow operational replicator`.

### Task 9: Add the History Gateway and switch v2 history reads

**Files:**
- Create: `apps/native/src/sync/v2/HistoryGateway.ts`
- Modify: `apps/native/src/sync/dataSources/useOrderHistory.ts`
- Modify: `apps/native/src/features/order-history/screens/OrderHistoryScreen.tsx`
- Test: `apps/native/src/sync/v2/__tests__/HistoryGateway.test.ts`

**Interfaces:**
- Produces: `searchHistory(query)`, `loadOrder(orderId)`, `pinOrder(orderId)`, and bounded cached summaries.

- [ ] Test server pagination, explicit loading, seven-Business-Day summary retention, 24-hour detail retention, pin protection, offline cached results, and operational preemption.
- [ ] Persist bounded summaries separately from operational checkpoints; do not advance operational streams.
- [ ] Under v2, use server search for older ranges and load one aggregate only after selection; v1 hooks remain unchanged when flag is off.
- [ ] Run history tests, query-performance harness, and native typecheck.
- [ ] Commit as `feat(history): load archived orders on demand`.

### Task 10: Introduce the durable operation journal

**Files:**
- Create: `apps/native/src/sync/journal/types.ts`
- Create: `apps/native/src/sync/journal/OperationJournal.ts`
- Create: `apps/native/src/sync/journal/OperationUploader.ts`
- Create: `apps/native/src/sync/journal/__tests__/OperationJournal.test.ts`
- Create: `packages/backend/convex/syncCommands.ts`
- Modify: `packages/backend/convex/http.ts`
- Test: `packages/backend/convex/syncCommands.test.ts`

**Interfaces:**
- Produces: `appendCommand`, `markProjected`, `nextUploadBatch`, `markAccepted`, `markObserved`, `requireAttention`, and `/sync/v2/commands`.

- [ ] Test crash between append/projection, stable retry IDs, lost acknowledgement, immutable sending payloads, safe quantity compaction, non-compaction of financial commands, and attention-required rejection.
- [ ] Persist journal records outside replaceable replica state using journal-first writes and idempotent projection recovery; encrypt command payloads before production enablement.
- [ ] Validate and upcast command schema versions server-side; synchronously apply each command idempotently.
- [ ] Attach permanent operation IDs to financial results and append corresponding replication events atomically.
- [ ] Keep uploader independent from operational/history pulls.
- [ ] Run native and backend focused/full suites.
- [ ] Commit as `feat(sync): add durable business command journal`.

### Task 11: Migrate local business mutations to journaled commands

**Files:**
- Modify: native mutation modules under `apps/native/src/features/`
- Test: existing order, checkout, discount, void, takeout, receipt, and query suites

**Interfaces:**
- Consumes: `OperationJournal` and v2 command endpoint.
- Produces: journaled `CreateOrder`, item edits, discounts, voids/refunds, `SettleOrder`, takeout transitions, and table transfer.

- [ ] Add a failing behavior test for each public mutation seam before changing it.
- [ ] Journal first, apply the existing local projection idempotently, and request upload without waiting on network.
- [ ] Make `SettleOrder` one command while keeping receipt printing independently retryable.
- [ ] Preserve Origin Tablet ownership and all tax/rounding/snapshot rules.
- [ ] Keep v1 dirty-row push available when the v2 journal flag is off.
- [ ] Run complete native and backend financial suites.
- [ ] Commit as `feat(sync): journal POS business operations`.

### Task 12: Add Sync-Clean Day Closing and device reconciliation

**Files:**
- Modify: `packages/backend/convex/closing.ts`
- Modify: `packages/backend/convex/reports.ts`
- Create: `packages/backend/convex/deviceReconciliation.test.ts`
- Modify: `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx`
- Test: Day Closing native tests

**Interfaces:**
- Produces: `confirmReadyForDayClosing()`, Preliminary Day Reports, immutable Report Revisions, and audited Device Retirement.

- [ ] Test all-active-device readiness, missing devices, late reconciliation, report revision immutability, clock drift, and retirement acknowledgement.
- [ ] Replace `await syncNow()` as a delivery gate with journal empty + accepted operations observed + server checkpoint confirmation.
- [ ] Permit preliminary reporting without marking the day settled.
- [ ] Keep final Z-Report unavailable until settlement; preserve duplicate report protections.
- [ ] Run report, closing, payment, backend, and native suites.
- [ ] Commit as `feat(closing): require store-level sync clean state`.

### Task 13: Add scoped repair generations and cache eviction

**Files:**
- Create: `apps/native/src/sync/v2/ReplicaRepair.ts`
- Modify: `apps/native/src/features/settings/screens/SettingsScreen.tsx`
- Modify: `apps/native/src/sync/v2/HistoryGateway.ts`
- Test: `apps/native/src/sync/v2/__tests__/ReplicaRepair.test.ts`

**Interfaces:**
- Produces: scoped repair state machine and local membership eviction that cannot produce server deletes.

- [ ] Test app termination at every repair state, validation failure, cancellation, journal replay, final catch-up, atomic activation, and rollback.
- [ ] Implement scoped shadow generations for core/catalog/floor/current Business Day and support-only full downloaded-data repair.
- [ ] Validate manifests and relationship completeness before activation.
- [ ] Evict historical aggregates only when not operational, pinned, pending, or attention-required.
- [ ] Audit repair invocation without logging business payloads.
- [ ] Run full native suites and bundle export.
- [ ] Commit as `feat(sync): add rollback-safe scoped repair`.

### Task 14: Complete acceptance automation and rollout documentation

**Files:**
- Modify: `apps/native/scripts/test-query-performance.cjs`
- Create: `apps/native/scripts/test-bounded-sync.cjs`
- Create: `docs/investigations/bounded-sync-acceptance.md`
- Modify: relevant deployment/runbook documentation

**Interfaces:**
- Produces: deterministic scale harness and manual real-device acceptance protocol.

- [ ] Assert 100,000 historical orders do not change automatic row counts or operational apply work.
- [ ] Cover 2,000 current-day orders, approximately 40,000 operational rows, 10 device states, and seven unsettled Business Days.
- [ ] Record p50/p95/max phase timings without payloads or IDs.
- [ ] Run `pnpm check`, `pnpm typecheck`, all backend tests, native rush-hour tests, and the bounded harness.
- [ ] Record which physical-device gates remain unverified; do not claim them from synthetic results.
- [ ] Commit as `test(sync): add bounded replication acceptance harness`.
