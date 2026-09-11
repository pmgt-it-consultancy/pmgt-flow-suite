## Parent

`docs/superpowers/specs/2026-09-11-bounded-operational-sync-design.md`

## What to build

Replace attempted-sync Day Closing with store-level Sync-Clean confirmation, versioned Preliminary Day Reports, final settlement, clock-drift review, and audited Device Retirement.

## Acceptance criteria

- [ ] Final settlement requires every Active Tablet to confirm Sync-Clean after cutoff.
- [ ] Missing devices produce a clearly labeled preliminary revision without settling the day.
- [ ] Late reconciliation creates a new immutable Report Revision.
- [ ] Material device clock drift requires review and preserves printed timestamps.
- [ ] Lost-device retirement records manager acknowledgement and affected Business Days.
- [ ] Duplicate report and payment protections remain intact.

## Blocked by

- Ticket 06.
