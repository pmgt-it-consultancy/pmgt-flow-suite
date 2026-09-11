## Parent

`docs/superpowers/specs/2026-09-11-bounded-operational-sync-design.md`

## What to build

Implement manager-scoped refresh and support-authorized full repair through validated shadow generations, then enable membership-driven local eviction that never deletes server history.

## Acceptance criteria

- [ ] Menu/settings, tables, and current Business Day can be repaired independently.
- [ ] The active replica remains usable until a replacement validates and catches up.
- [ ] App termination or cancellation leaves either the old or new complete generation active.
- [ ] Unobserved journal operations replay without premature acknowledgement.
- [ ] Membership eviction cannot create a server-side delete.
- [ ] Full repair is time-limited, permission-checked, and audit-logged.

## Blocked by

- Ticket 03.
- Ticket 06.
