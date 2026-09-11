## Parent

`docs/superpowers/specs/2026-09-11-bounded-operational-sync-design.md`

## What to build

Introduce the durable Operation Journal and prove the full command lifecycle with a Create Order tracer: journal first, idempotent local projection, independent upload, atomic server handling, and authoritative observation.

## Acceptance criteria

- [ ] Crash recovery works between journal append and local projection.
- [ ] Retry and lost acknowledgement reuse one stable operation identity.
- [ ] Sending payloads are immutable and schema-versioned.
- [ ] Server acceptance and replication event are atomic.
- [ ] Authoritative observation advances accepted to observed.
- [ ] V1 mutation/push behavior remains available when the command flag is off.

## Blocked by

- Ticket 02.
- Ticket 03.
