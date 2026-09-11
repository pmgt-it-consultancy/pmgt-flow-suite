# Bounded Sync E2E Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision and seed an isolated 10,000-order staging restaurant with dedicated Manager and Cashier accounts for Android bounded-sync testing.

**Architecture:** Reuse the deterministic restaurant simulation behind the existing staging deployment guard. Add an idempotent provisioning action for the store and Convex Auth accounts, then orchestrate provisioning, seed, and indexed verification from a credential-safe operator script.

**Tech Stack:** TypeScript, Convex, Convex Auth, Node.js, pnpm, Android Emulator

## Global Constraints

- Run only against Convex deployment `aromatic-dalmatian-30`.
- Never delete or modify another store's records.
- Never commit passwords or auth tokens.
- Incoming traffic is finite and off by default.
- Use deterministic IDs so provisioning and seeding resume safely.

---

### Task 1: Restore the tested staging restaurant simulator

**Files:**
- Create: `packages/backend/convex/lib/stagingLab.ts`
- Create: `packages/backend/convex/restaurantSimulation.ts`
- Create: `packages/backend/convex/restaurantSimulation.test.ts`

**Interfaces:**
- Produces: `seedCatalog`, `seedOrders`, and `countPage` internal functions.

- [ ] Restore the tested simulator implementation from commit `cecd2e2` and its pagination correction from `3ee70af`.
- [ ] Run `pnpm -C packages/backend exec vitest run convex/restaurantSimulation.test.ts` and confirm all fixture isolation and count tests pass.
- [ ] Commit the restored simulator independently.

### Task 2: Add idempotent store and account provisioning

**Files:**
- Create: `packages/backend/convex/stagingE2ELab.ts`
- Create: `packages/backend/convex/stagingE2ELab.test.ts`

**Interfaces:**
- Produces: `provisionLab({ managerEmail, managerPassword, cashierEmail, cashierPassword })` returning `{ storeId, managerUserId, cashierUserId }`.

- [ ] Write a failing test proving deterministic store reuse, Manager/Staff role resolution, account assignment, and refusal outside staging.
- [ ] Add an internal preparation mutation that finds or creates store client ID `bounded-sync-e2e-v1` and returns Manager and Staff role IDs.
- [ ] Add a staging-gated Node action that recovers accounts by normalized email or creates them with `createAccount`, then assigns role, store, and active state.
- [ ] Run the focused test, full backend tests, and backend typecheck.
- [ ] Commit the provisioning action.

### Task 3: Add and execute the operator workflow

**Files:**
- Create: `scripts/bounded-sync-e2e-lab.mjs`
- Create: `docs/investigations/bounded-sync-e2e-lab.md`

**Interfaces:**
- Consumes: `stagingE2ELab:provisionLab`, `restaurantSimulation:seedCatalog`, `seedOrders`, and `countPage`.
- Produces: `provision`, `seed`, `status`, and finite `traffic` commands.

- [ ] Require `E2E_MANAGER_EMAIL`, `E2E_MANAGER_PASSWORD`, `E2E_CASHIER_EMAIL`, and `E2E_CASHIER_PASSWORD` only for provisioning; reject missing or weak values before calling Convex.
- [ ] Pin every CLI call to `aromatic-dalmatian-30` with code generation disabled.
- [ ] Seed 200 batches of 50 historical orders with two workers, then 50 active orders; reruns skip deterministic existing records.
- [ ] Verify catalog and order counts through paginated indexed queries.
- [ ] Deploy the additive functions to staging, provision with generated credentials, seed, and record returned IDs and non-secret counts.
- [ ] Log into the Android emulator and execute the bounded-sync E2E matrix, recording limitations of emulator timing versus Helio G88 hardware.
- [ ] Commit tooling and the redacted test report; push the branch and merge it into `staging` after verification.

