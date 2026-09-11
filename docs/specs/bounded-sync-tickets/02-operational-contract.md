## Parent

`docs/superpowers/specs/2026-09-11-bounded-operational-sync-design.md`

## What to build

Add the versioned server contract that publishes aggregate changes transactionally and returns a bounded Operational Replica without changing v1 pull/push routes.

## Acceptance criteria

- [ ] Store-scoped replication events are written atomically with order-affecting mutations.
- [ ] Snapshot membership includes draft/open orders, unsettled Business Days, and unresolved financial exceptions.
- [ ] Delta pulls use per-stream checkpoints and return complete latest Order Aggregates.
- [ ] Snapshot generation and catch-up checkpoint prevent gaps during paged loading.
- [ ] Lifetime historical volume does not change automatic snapshot membership.
- [ ] Existing v1 sync tests continue passing.

## Blocked by

None - can start independently beside ticket 01.
