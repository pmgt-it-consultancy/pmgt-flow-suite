## Problem Statement

Restaurant staff report that the POS starts responsive and slows as incoming data accumulates, interrupting order entry and checkout during rush hours. The target device is a VistaTab 30S with Helio G88 and apparently 4 GB physical RAM. Version 3.27.2 bounds four previously broad queries, but catalog computation, rendering, pending edits, writes, subscriptions, and sync still require improvement.

## Solution

Keep cashier interactions responsive as orders arrive and sales history grows. Preserve existing offline operation, quantities, prices, discounts, payments, and printing. Measure the release on the actual tablet using repeatable workloads; use React Native and Hermes already configured.

## User Stories

1. As a cashier, I want product selection to consider only applicable modifiers, so that a large catalog does not delay each tap.
2. As a cashier, I want category-inherited modifiers and overrides preserved, so that orders remain correct.
3. As a cashier, I want unchanged cart rows to remain stable when another item changes, so that quantity updates stay responsive.
4. As a cashier, I want immediate feedback for quantity taps, so that I can enter items confidently.
5. As a cashier, I want pending quantity changes saved before checkout, so that I charge for the displayed cart.
6. As a cashier, I want failed edits to remain visible and retryable, so that optimistic feedback never loses an order change.
7. As a cashier, I want related item writes applied together where safe, so that updates create less database and rendering work.
8. As a cashier, I want VAT, SC/PWD discounts, modifiers and rounding unchanged, so that speed improvements preserve money correctness.
9. As a cashier, I want hidden screens to stop unnecessary display subscriptions, so that they do not compete with my current screen.
10. As a cashier, I want returning screens to show current data, so that pausing subscriptions never hides new orders.
11. As a cashier, I want history queries to fetch related data for displayed orders, so that old records do not slow searching.
12. As a cashier, I want refund calculations to load only the relevant modifiers, so that refunds do not scan unrelated sales.
13. As a cashier, I want sync to yield regularly, so that incoming orders do not monopolize interaction time.
14. As a cashier, I want writes made during sync to be sent subsequently, so that fast interaction does not sacrifice delivery.
15. As a cashier, I want payment and print actions to preserve sequencing and duplicate protections, so that repeated taps are safe.
16. As an operator, I want performance measurements without customer/payment content, so that troubleshooting does not expose sensitive data.
17. As an operator, I want bounded diagnostic memory, so that measurement does not create another slowdown.
18. As a maintainer, I want repeatable busy-shift fixtures and regression tests, so that growth-related regressions are caught.
19. As an operator, I want a release-device acceptance report, so that desktop success is not mistaken for tablet smoothness.
20. As an operator, I want an explicit decision about indexes or background workers based on measurements, so that complexity solves an observed bottleneck.

## Implementation Decisions

- Preserve the existing React Native, Hermes, WatermelonDB, Convex and financial contracts.
- Optimize selected-product modifier resolution, cart row prop equality, pending-edit flush boundaries, related writes, display subscription lifetimes and history/refund query scope.
- Keep category ancestry and product-level assignment precedence; observe all columns needed to refresh membership and display.
- Use prepared operations and database batches only where existing mutation invariants remain intact; do not introduce concurrent conflicting payment writes.
- Flush pending quantity edits before checkout and surface failures; a payment must never confirm based on stale quantities.
- Pause only screen-owned display subscriptions, never the global sync manager or required mutation completion.
- Instrument sync phases using bounded opt-in numeric diagnostics. Keep yielding and cursor correctness; queue work requested while sync is already running.
- Select displayed history orders before fetching children, preserving search, status, date boundaries, sorting and result limits.
- Evaluate index changes and background workers from evidence; do not add a migration or runtime solely because it is available.
- No APK build or deployment in this execution. Commit to the current branch; preserve unrelated user changes.

## Testing Decisions

- Default seams accepted by the user's instruction to use defaults: rendered cart interaction/checkout boundary, exported observable query hooks, order mutation public services, sync manager lifecycle, diagnostic snapshot API.
- Test external behavior and data-scaling bounds, using actual React lifecycle and database adapters where feasible. Mock only native/database/network/time boundaries.
- Reuse native Jest tests for cart/checkout/receipt and order totals, existing query regression harness, and backend sync tests when backend behavior changes.
- Work red-green per slice. Run affected tests and typechecking regularly; run the complete native suite once at the end.
- Add fixture cases for large unrelated history, category inheritance/overrides, switching stores/dates/screens, pending edit success/failure, modifier-inclusive totals and sync requests during an active run.
- Proposed actual-device targets: visible tap feedback <=100 ms, p95 item-to-visible-cart <=300 ms, responsive scrolling during sync, and no sustained memory/latency growth in a repeatable busy-shift run. Record device/build/data volume and distinguish measured numbers from synthetic proxies.

## Out of Scope

Framework rewrite, tablet purchase, tax/payment policy changes, deleting historical or unsynced data, automatic production telemetry upload, APK builds, and deployment. No claim of measured device smoothness without an actual device run.

## Further Notes

The parent remains open until device acceptance. Existing hotfix 3.27.2 is prerequisite baseline. Each child ticket records its true blockers; code-complete tickets can finish before hardware acceptance.

