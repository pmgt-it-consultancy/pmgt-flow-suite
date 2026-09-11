# Bounded Sync E2E Lab Design

Date: 2026-09-11

## Goal

Create a completely isolated staging restaurant and dedicated accounts for Android emulator validation of bounded operational sync without changing Test Store A or production.

## Fixture

- Store name: **Bounded Sync E2E Lab**
- Deterministic store key: `bounded-sync-e2e-v1`
- Dedicated Manager and Cashier password accounts; credentials are supplied at execution time and never committed.
- 20 categories, 20 modifier groups, 80 modifier options, 20 category assignments, 500 products, and 80 tables.
- 10,000 historical paid cash orders across the preceding 90 days.
- 50 active orders split evenly between dine-in and takeout.
- Incoming traffic remains off until explicitly started with a finite count and interval.

## Architecture

An authenticated-independent Convex action is allowed only when `CONVEX_SITE_URL` identifies the approved `aromatic-dalmatian-30` staging deployment. It calls internal queries and mutations to create or recover the deterministic store, locate the existing Manager and Staff roles, create password accounts through Convex Auth, and assign both accounts to the new store.

The existing restaurant simulator is reused for catalog and order generation. Its deterministic client IDs make interrupted runs resumable and prevent duplicates. A root operator script provisions the store, passes the returned store and cashier IDs into the simulator, verifies indexed counts, and prints the two account emails supplied by the operator. Passwords are accepted through environment variables and are not written to repository files.

## Safety

- Every provisioning and seed function fails closed outside the approved staging deployment.
- Existing records are never deleted, patched, or reassigned.
- All generated business records belong to the new store and use deterministic `BSE2E`/simulation client IDs.
- No scheduled traffic or cleanup job is installed.
- Production URLs and credentials are rejected.

## Verification

Backend tests cover deployment gating, idempotent store creation, role assignment, and existing-account recovery. After deployment, the operator script verifies fixture counts. The Android staging app is then logged in with the Cashier account and tested for initial bounded snapshot, active-order rendering, explicit history, offline local operation, reconnect delivery, guarded refresh, and cold restart recovery. Manager-only refresh and Day Closing behavior use the Manager account.

