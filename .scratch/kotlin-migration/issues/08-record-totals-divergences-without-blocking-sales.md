# 08 — Record Totals Divergences without blocking sales

Approved for implementation. Physical VistaTab testing is waived by the user; record hardware checks as unverified.

## Parent

https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/28

## What to build

The existing backend accepts pushed sales and records arithmetic or payment disagreement for the correct store and Business Day.

## Acceptance criteria

- [ ] Reconcile coherent aggregates using the existing shared arithmetic; do not create false divergences from partial application.
- [ ] Disagreeing totals are retained and flagged; accepted sales are not rejected or silently corrected.
- [ ] Retries are idempotent; permissions and store/day scope hold; existing backend tests pass.

## Blocked by

None — can start immediately.
