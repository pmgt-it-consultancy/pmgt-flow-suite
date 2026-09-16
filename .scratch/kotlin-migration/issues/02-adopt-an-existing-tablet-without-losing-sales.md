# 02 — Adopt an existing tablet without losing sales

Approved for implementation. Physical VistaTab testing is waived by the user; record hardware checks as unverified.

## Parent

https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/28

## What to build

The upgrade opens existing local data and identity, preserving Pending Local Work and order numbering.

## Acceptance criteria

- [ ] Legacy schema, pending markers, cursor, and preferences survive restart-safe adoption.
- [ ] Row counts and pending counts match; existing server IDs resolve; unsent records remain intact.
- [ ] Unreadable identity or unconvertible work blocks visibly without regenerating deviceId.
- [ ] Legacy-compatible writes preserve the agreed rollback path; identity recovery is tested on an available emulator; physical proof is waived.

## Blocked by

- #29
