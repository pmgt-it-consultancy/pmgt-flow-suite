## Parent

`docs/superpowers/specs/2026-09-11-bounded-operational-sync-design.md`

## What to build

Make synchronization outcomes truthful without changing the live background-sync contract. Add an explicit delivery-required operation and protect the legacy downloaded-data refresh from running offline, during synchronization, or while Pending Local Work remains.

## Acceptance criteria

- [ ] Background Sync Now remains safe for existing fire-and-forget callers.
- [ ] Delivery-required callers distinguish delivered, offline, backoff, pending, and failed outcomes.
- [ ] Refresh cannot reset the v1 watermark unless the device is online, idle, and free of unsynced changes.
- [ ] Settings uses Refresh POS Data language and requires settings permission.
- [ ] Day Closing behavior is not changed by this slice.

## Blocked by

None - can start immediately.
