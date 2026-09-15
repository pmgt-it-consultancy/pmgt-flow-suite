# Staging restaurant lab

Approved 2026-09-08. Deployment: `aromatic-dalmatian-30`. Store: **Test Store A** (`kh7e16sprps4cfxdt1x0sfc2097z06m0`). Production is not modified. Native staging v3.27.3 receives these server changes through normal sync; no APK rebuild is required.

## Modifier repair

Thirteen legacy modifier options had no store ID or sync timestamp. The store-indexed sync query therefore excluded them. The bounded internal repair derives store ownership from each parent group, preserves existing identity and values, and stamps the current sync time. The staging run repaired 13 rows with zero orphans; the store's pull query subsequently returned its 10 original options. Regression tests exercise the repair and incremental pull together.

Verified on the installed staging v3.27.3 tablet emulator: Wintermelon now displays Drink Size and Sweetness Level choices, with defaults selected and the Add to Order button enabled. The modal was closed without adding an item or submitting the existing draft.

## Dataset

The additive seed targets 20 categories, 20 modifier groups, 80 options, 20 category assignments, 500 products and 80 tables. Each product inherits a required preparation modifier from its category. Names and order numbers start with `SIM`.

There are 10,000 historical paid cash orders across the 90 days before September 8, 2026, plus 50 open orders (25 dine-in, 25 takeout). Every order has four lines, six total units, and four modifier snapshots. Historical orders include payment records. Expected child counts are 40,200 order items, 40,200 modifier snapshots and 10,000 payments.

Post-seed indexed pagination verified every count above, including all 20 category assignments. No incoming traffic run was started. The emulator home screen shows 54 open orders: 25 SIM dine-in and 25 SIM takeout, plus four preexisting takeout orders. SIM orders display six items and modifier-inclusive totals. The remaining historical catch-up was still running at handoff; wait for `Synced` before steady-state performance measurements.

These are synthetic sales and affect **staging reports**. No real payment is collected or printer invoked by the seed. Existing catalog/orders are preserved. Only new SIM tables are occupied. Deterministic keys prevent duplicate fixtures on rerun and preserve cashier edits to already seeded records. No destructive reset is provided.

## Operator commands

Run from the repository root with existing Convex operator authentication:

```sh
node scripts/staging-restaurant-lab.mjs seed
node scripts/staging-restaurant-lab.mjs status
```

The script pins the deployment, store and existing operator. Internal functions also fail closed unless `CONVEX_SITE_URL` matches the approved staging deployment. History is inserted in atomic batches of at most 50 orders, with two concurrent CLI workers. Rerun `seed` to resume after an interrupted run.

Incoming traffic is **off by default**. Start a finite run manually:

```sh
node scripts/staging-restaurant-lab.mjs traffic 120 1000
```

This creates at most 120 additional SIM takeout orders, no faster than one per second; actual CLI/network latency may reduce the rate. Ctrl+C stops future requests, though the current request may complete. No scheduled background job remains. An optional fourth argument supplies a stable run ID for deduplicated replay.

## Testing

Wait for the tablet's sync status to settle before measuring steady-state interactions. Try product search, required modifiers, quantity changes, switching orders, table selection and historical date navigation. Repeat during a manually started traffic run to compare catch-up behavior. This exercises sync and UI pressure, not the entire normal order-creation API or payment integration.

Automated verification: 214 backend tests across 19 suites pass, including five repair/simulation tests; backend TypeScript and focused Biome checks pass. The emulator is a functional test environment, not a performance-equivalent substitute for the Helio G88 tablet. Real-device latency and sustained rush-hour behavior still require measurement.
