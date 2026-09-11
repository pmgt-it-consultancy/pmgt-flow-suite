## Parent

`docs/superpowers/specs/2026-09-11-bounded-operational-sync-design.md`

## What to build

Move older order discovery to bounded server-side search and download one complete historical Order Aggregate only when staff select it, while preserving offline access to bounded cached results.

## Acceptance criteria

- [ ] Summary search applies store/date/status/text constraints before child hydration.
- [ ] Detail loading requires one selected order and returns a complete aggregate.
- [ ] Seven Business Days of summaries and 24 hours of unpinned details are retained within a size bound.
- [ ] Pinned, operational, pending, and attention-required aggregates cannot be evicted.
- [ ] A newly arriving Operational Order preempts historical work.
- [ ] V1 history behavior remains unchanged when v2 is disabled.

## Blocked by

- Ticket 02.
- Ticket 03.
