# Staging Restaurant Lab Implementation Plan

Approved by the user on 2026-09-08, including use of their existing staging store and the default test boundaries. Execute inline on a normal branch; no worktrees.

**Goal:** Restore legacy modifier choices and populate Test Store A with an additive, repeatable large-restaurant dataset.

**Architecture:** Internal Convex maintenance functions, guarded to the staging site URL. A targeted modifier repair preserves record IDs and advances sync timestamps. A simulation module uses indexed deterministic client IDs for idempotent catalog and order batches. An optional finite CLI traffic driver invokes the same order-batch boundary. No schema or native APK change.

**Tech stack:** Convex, convex-test/Vitest, pnpm, Node CLI, existing Android staging APK.

## Constraints and approved design

- Deployment: aromatic-dalmatian-30 only. Production untouched.
- Store: Test Store A (`kh7e16sprps4cfxdt1x0sfc2097z06m0`). Preserve existing catalog/orders; append names/numbers prefixed SIM.
- Dataset: 80 tables, 500 products, 20 categories with assigned modifier groups/options, 50 active orders and 10,000 historical paid orders with line items/modifier snapshots/payments.
- Historical sales are synthetic and will affect staging reports. No actual payments, printers, account changes or unbounded scheduled traffic.
- Incoming-order driver is manually started, rate/count bounded and stoppable. It is not started as part of seeding.
- Reruns must not duplicate fixtures or overwrite cashier edits to already seeded records.

## Task 1: Repair modifier sync visibility

Execution: completed; 13 staging options repaired, Wintermelon choices and enabled Add action verified on the emulator without modifying the draft.

Files: `packages/backend/convex/modifierMaintenance.ts`, `modifierMaintenance.test.ts`.

- [ ] Test real mutation/query boundaries: legacy available options are absent from `sync:pullTablePage`; repair makes them visible to an incremental pull without changing price, group reference or identity. Dry-run, repeat and non-staging rejection checks.
- [ ] Implement internal `repairLegacyOptions({dryRun})`, bounded to 100 missing-store rows, resolving store from the parent group, preserving `clientId ?? _id`, stamping current `updatedAt`, reporting orphan counts rather than guessing parents.
- [ ] Run focused Vitest and backend typecheck. Dry-run on staging, confirm 13 repairable rows, then repair and verify the existing product's choices.

## Task 2: Add idempotent restaurant fixtures

Execution: completed; catalog and all 10,050 orders seeded. Regression coverage includes preserving cashier edits and an unrelated store's product. Shared totals and active-table counts pass.

Files: `packages/backend/convex/restaurantSimulation.ts`, `restaurantSimulation.test.ts`.

- [ ] Test `seedCatalog({storeId})` and `seedOrders({storeId,kind,start,count,epoch})` with convex-test. Assert correct fixture counts, modifier-inclusive literal totals, no duplicate orders on rerun, foreign-store preservation, strict staging guard and range validation.
- [ ] Catalog uses deterministic namespaced client IDs and existing by_clientId indexes. Orders use at most 50 orders per atomic batch, four line items each, one modifier snapshot per line; historical orders include payment rows. Compute totals with existing shared financial functions.
- [ ] Use real staging store VAT and an existing active user for synthetic record attribution; no new credentials. Do not modify user/store configuration.
- [ ] Seed historical dates over the past 90 days, then 50 active orders today. Half of active orders use SIM tables; remaining orders are takeout. Existing tables are not occupied or modified.

## Task 3: Stage and hand off

Execution: staging deployment and seeding completed. The original oversized count command hit Convex's read limit; replaced with indexed, paginated count-only queries. Full backend tests (214), TypeScript and focused Biome checks pass. Tablet catch-up is being verified. Operator guide: `docs/investigations/staging-restaurant-lab.md`.

Files: `scripts/staging-restaurant-lab.mjs`, `docs/investigations/staging-restaurant-lab.md`.

- [ ] CLI uses an explicit staging deployment and fixed store, iterates bounded batches with progress; reuses a fixed fixture epoch. Traffic mode creates at most 120 new takeout orders, one per second by default, only when manually invoked.
- [ ] Run backend tests/typecheck and inspect deployment diff; deploy only to staging, repair and seed. Verify server counts and tablet sync/UI. Do not merge to main or release another APK.
- [ ] Document exact fixture size, commands, production guard, synthetic-report caveat, and what was versus was not verified on the emulator.
