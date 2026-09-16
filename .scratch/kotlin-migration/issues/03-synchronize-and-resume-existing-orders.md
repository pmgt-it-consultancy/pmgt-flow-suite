# 03 — Synchronize and resume existing orders

Approved for implementation. Physical VistaTab testing is waived by the user; record hardware checks as unverified.

## Parent

https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/28

## What to build

The Kotlin app receives and pushes v1 data and displays active orders across reconnects.

## Acceptance criteria

- [ ] Pagination, retries, acknowledgements, conflicts, and concurrent local edits match the RN service behavior.
- [ ] Fresh bootstrap and warm restart show the same active orders; pending work survives failures.
- [ ] Status reflects network and sync results; no v2 cutover occurs.

## Blocked by

- #30
