## Parent

`docs/superpowers/specs/2026-09-11-bounded-operational-sync-design.md`

## What to build

Consume the bounded server contract behind an opt-in flag, store independent stream checkpoints, apply each Order Aggregate atomically, and compare membership against v1 without changing production reads.

## Acceptance criteria

- [ ] V2 defaults off and v1 remains the live rollback path.
- [ ] Checkpoints are isolated by store, device, stream, schema, and generation.
- [ ] Aggregate roots and children become visible in one local commit.
- [ ] Checkpoints advance only after successful local application.
- [ ] Numeric shadow diagnostics contain no order, customer, payment, or product data.
- [ ] Operational work preempts history and maintenance work.

## Blocked by

- Ticket 02.
