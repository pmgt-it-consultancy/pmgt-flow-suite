## Parent

`docs/superpowers/specs/2026-09-11-bounded-operational-sync-design.md`

## What to build

Automate bounded-sync correctness and scale checks and provide the real-tablet acceptance protocol required before production enablement.

## Acceptance criteria

- [ ] 100,000 historical server orders do not increase automatic membership or operational apply work.
- [ ] The harness covers 2,000 current-day orders, roughly 40,000 operational rows, 10 tablets, and seven unsettled Business Days.
- [ ] Duplicate upload, lost acknowledgement, app termination, late reconciliation, repair rollback, and old/new client coexistence are covered.
- [ ] Diagnostics record only numeric phase timing and counts.
- [ ] Full static and automated test suites pass.
- [ ] Physical-device gates remain explicitly unverified until measured on the Helio G88 tablet.

## Blocked by

- Tickets 01 through 08.
