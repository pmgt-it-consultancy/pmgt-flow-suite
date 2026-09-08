# Ticket #4: selected-product modifier queries

## Result

`useModifiersForProduct` observes one selected product, follows its category parent chain (with cycle protection), observes matching product/category assignments, then loads only assigned active groups and their available options. Clearing selection opens no database queries. Each upstream emission replaces its dependent subscriptions; changing selection or unmounting disposes the chain. Missing category records remain observed so later synchronization can extend ancestry.

The existing resolver preserves direct-product precedence, nearest-category precedence, selection overrides (including zero), group ordering and option ordering. Store-wide modifier consumers are unchanged. No schema, financial, synchronization, dependency, build or deployment changes.

## Verification

Approved seam: exported `useModifiersForProduct`, rendered with actual React/test-renderer. The database boundary uses the actual Watermelon query matcher with deterministic observable fixtures; React and application helpers are not mocked.

- Red: focused Jest scaling regression failed before implementation: 5,006 materialized rows for one selected product, expected fewer than 30.
- Green: the same scaling test passes after bounded subscription implementation, including 1,000 irrelevant rows per catalog table and zero rows loaded on deselection.
- Additional characterization covers inherited assignments, direct overrides, sorted option names/prices, reassignment, parent changes, group deactivation/reactivation, missing selection, and unmount subscription disposal.
- Focus lifecycle characterization verifies subscriptions stop while hidden, retain displayed choices, and reload current catalog on return via the shared `useScreenQueryActive` hook.
- `pnpm --dir apps/native exec jest src/sync/dataSources/useModifiers.test.tsx --runInBand --silent`: 3 tests passed.
- `pnpm --dir apps/native typecheck`: passed.

## Limits

This is a materialization/subscription correctness proxy, not a SQL execution-cost or tablet latency measurement. The deterministic database boundary drives catalog notifications and does not validate Watermelon SQLite notification internals. Existing observed-column lists cover membership/display edits. Actual VistaTab/Hermes acceptance remains required under parent #3. No index migration or worker is justified by this synthetic fixture alone. Full native suite is coordinated once by the parent agent.

## Modal integration follow-up

Review found the modal initialized defaults only when opened/product changed, whereas scoped queries deliver groups asynchronously. Rendered regression reproduced a required default remaining unselected (Add disabled) after groups arrived. The modal now resets session fields on open/product change and initializes each new group once as its choices arrive. Catalog refreshes retain cashier selections, deselected optional defaults and notes. Direct imports keep the real Text/currency helper in rendered tests without unrelated barrel initialization.

The delayed-groups test went red then green. Three rendered modal tests cover required/optional defaults, no-default required validation, preservation across empty/loading refreshes and delayed defaults after product switching. Only native/vendor UI boundaries are mocked. Focused modal suite passes. Follow-up native typecheck initially encountered another task's in-progress `CartItem.test.tsx` prop mismatch (`quantityEdits`); parent coordinates final verification. No device/build claim.

## Takeout wiring follow-up

Final review found takeout still prefetched every store modifier. `TakeoutOrderScreen` now calls the selected-product hook with the selected ID (undefined when none). While choices load, the customization modal disables confirmation. Actual resolved group membership determines whether to use customization or the basic add-item modal, preserving inherited-group routing.

An approved targeted source wiring guard parses the actual screen call and modal prop expressions: red reproduced the store-wide query and missing loading gate; green verifies no-selection/selection hook input, loading disablement, and empty/nonempty group routing. This guard does not claim a rendered full-screen test; the existing real React hook and modal tests cover their lifecycle behavior without mocking application hooks. Combined focused suites: 8 tests pass. Native typecheck passes after this follow-up. Biome reports only five existing unrelated callback dependency warnings in the takeout screen.
