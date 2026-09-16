# Spec: Kotlin Android POS parity migration

Status: Approved for implementation on 2026-09-15. The user explicitly waived the VistaTab requirement; use available emulators and automated checks, and report physical-device/printer behavior as unverified.

## Problem Statement

Restaurant staff at three live stores need the Android POS to move from React Native to Kotlin while preserving their workflows, settled books, pending offline sales, device identity, and order numbering. The approved migration plan needs executable work and evidence of parity before cutover.

## Solution

Build a parallel Kotlin Android app to reproduce the existing POS, verify each phase against the React Native reference and the existing staging lab, and prepare an in-place upgrade with the agreed store-by-store rollout. Implementation speed does not waive hardware or elapsed Business Day gates.

## User Stories

1. As a cashier, I want to sign in with my existing account, so that my store access remains the same.
2. As a cashier, I want the same permission checks, so that actions remain appropriate to my role.
3. As a cashier, I want screen locking and server-verified PIN unlock, so that the current access workflow survives the port.
4. As a cashier, I want my selected store and preferences retained, so that upgrading does not require reconfiguration.
5. As a cashier, I want existing orders retained through upgrade, so that sales are not lost.
6. As a cashier, I want Pending Local Work preserved, so that offline sales can still reach the server.
7. As a cashier, I want order numbering to continue, so that receipts and kitchen tickets remain identifiable.
8. As a cashier, I want catalog categories and products available locally, so that I can select items during service.
9. As a cashier, I want the same modifier rules and prices, so that orders match customer requests.
10. As a cashier, I want tables and active orders visible, so that I can resume service quickly.
11. As a cashier, I want the existing server dashboard summary, so that its meaning does not change.
12. As a cashier, I want dine-in, counter, and takeout entry, so that every current service mode remains available.
13. As a cashier, I want quantity edits and item removal to persist, so that the cart reflects customer choices.
14. As a cashier, I want cart edits applied before checkout, so that payment uses the intended order.
15. As a cashier, I want current offline selling behavior, so that temporary connection loss does not discard my work.
16. As a cashier, I want synchronization to retry safely, so that a failed connection does not duplicate business effects.
17. As a cashier, I want connection status based on synchronization, so that I can see whether the server is reachable.
18. As a cashier, I want identical VAT and centavo results, so that the migration does not change the books.
19. As a cashier, I want current discounts including SC/PWD, so that eligible customers receive the same calculations.
20. As a cashier, I want existing payment methods, split payments, and change calculations, so that I can settle orders as before.
21. As a manager, I want existing void and refund workflows, so that corrections retain their permissions and audit evidence.
22. As a cashier, I want order history and details, so that I can inspect previous sales.
23. As a cashier, I want receipt and kitchen printing, so that the existing physical workflow continues.
24. As a cashier, I want printer selection and saved settings, so that the correct printer is used.
25. As a manager, I want reprints audited with the existing semantics, so that the port preserves evidence.
26. As a manager, I want day closing and Z-Reports, so that the Business Day can be reconciled.
27. As a manager, I want Totals Divergences surfaced at closing, so that an arithmetic disagreement cannot silently finalize.
28. As a cashier, I want a sale accepted even when reconciliation finds a disagreement, so that service can continue.
29. As a developer, I want the existing updater workflow carried over, so that installed tablets can receive subsequent APKs.
30. As a developer, I want failed adoption to block visibly, so that unreadable Pending Local Work cannot disappear.
31. As a developer, I want rollback compatibility during the agreed window, so that the first store can recover.
32. As a store owner, I want cutover gated by verified results, so that unproven behavior does not reach all stores.

## Implementation Decisions

- Follow the existing twelve resolved migration decisions and Ledger-Compatible Arithmetic ADR.
- Build Kotlin and Jetpack Compose beside the RN application. Use a distinct development application identity; in-place release adoption requires the existing application identity and signing lineage. Verify the release path rather than assuming a separate sandbox can read the original data.
- Use SQLDelight with legacy SQLite compatibility and preserve IDs, pending markers, cursor, and rollback readability.
- Read the existing encrypted device identity; never substitute a new UUID when adopting a tablet. First installs and adoption must be distinguishable.
- Make adoption transactional and restart-safe. Require row-count equality, pending-work equality, and resolution of existing server references; unsent orders without server IDs remain pending rather than being mistaken for missing server records.
- Use one OkHttp transport with domain repositories for Convex function calls and sync HTTP actions. Retain the current Convex Auth protocol.
- Port sync v1, including conflict handling, acknowledgements, pagination, retry behavior, and protection of local edits during sync. Sync v2 remains deferred.
- Keep operational observations bounded and compare projected values before emitting. Query-plan gates cover active orders, table summaries, selected-product modifiers, selected-order aggregates, history pages, and selected refund/void records.
- Preserve existing authentication, lock-state persistence, restart cooldown reset, offline cold-start failure, and server-only dashboard behavior.
- Port all existing screens and settings; use existing POS density and touch-target guidance. Do not introduce new user workflows.
- Reproduce binary64 arithmetic and JavaScript rounding exactly, including epsilon and VAT-rate normalization.
- Add server Totals Reconciliation after a coherent pushed aggregate is available. Record disagreement and accept the sale; never overwrite submitted totals merely to hide divergence. Include payment consistency checks without introducing rejection into the push path.
- Surface unresolved divergences through the existing closing attention pattern. Resolution must have attributable evidence and cannot silently dismiss a discrepancy.
- Port ESC/POS bytes, per-call style prefixes, classic SPP fallback, printer preferences, and existing reprint audit ordering.
- Preserve the existing APK update behavior. Resolve platform packaging requirements during implementation without inventing a distribution product.
- Keep RN usable as the reference and rollback runtime throughout the agreed window.
- Limit backend changes to reconciliation and its closing control. Do not change the web application.

## Testing Decisions

Approved test seams:

1. Primary: observable POS workflows against the same deterministic staging-lab fixture, compared with RN. Include restart, disconnect/reconnect, cart edits, settlement, corrections, closing, and print requests.
2. Pure public service outputs: shared language-neutral money and ESC/POS fixtures, with expected outputs produced by the RN/TypeScript reference. Include sanitized amounts from actual production orders; synthetic cases supplement them.
3. Upgrade boundary: opening a legacy database and encrypted identity through the real adoption entry point, checking preservation and recoverable failures. Run SQLite checks on host and available Android emulators. The user waived the VistaTab gate; preserve the identity safety checks in the software.
4. Backend public push and closing endpoints: use existing convex-test prior art to verify flag-and-accept, idempotency, store/day scoping, and unresolved-divergence closing behavior.

Test externally observable behavior, not private methods or mocks of internal collaborators. Follow the recorded native-test disposition; retain the RN suites while it remains the oracle. Add new Kotlin UI tests instead of copying RN component tests. Run focused tests and type checks during implementation, then complete suites, Android build, differential phase gates, and review before claiming code complete.

Capture fixtures contain only allowlisted operation inputs and outputs needed to reproduce behavior. Strip names, credentials, tokens, customer details, and payment-instrument data; replace identifiers consistently where replay requires relationships. Keep synthetic fixtures in source control and sanitized real captures outside source control until reviewed for inclusion. Record provenance and expected-output generation.

## Out of Scope

Sync v2 activation, offline sign-in or PIN unlock, decimal-money redesign, web rewrite, backend replacement, general bug fixing, UI redesign, remote branch cleanup, and unrelated scratch-directory changes. Store deployments and owner notifications are separate operational steps; implementation does not constitute completed rollout.

## Further Notes

Source plan: [migration plan](../plans/2026-09-15-kotlin-migration.md).
Decisions: [map #13](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/13), its resolution issues, and [ADR 0002](../adr/0002-ledger-compatible-money-arithmetic.md).
Hardware gate: [#18](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/18). No adb device was connected during initial inspection.
Baseline: ede976f4c566b055fb47c8a9b6b412ecf880acac.
The plan requires a settled Business Day before store 2 and a further week before store 3. These cannot be completed in a two-hour implementation session.
The recorded test disposition accounts for 27 of the stated 29 native tests; implementation inventory must classify the remaining tests explicitly without silently deleting them.
