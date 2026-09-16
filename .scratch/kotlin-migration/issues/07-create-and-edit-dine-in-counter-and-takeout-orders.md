# 07 — Create and edit dine-in, counter, and takeout orders

Approved for implementation. Physical VistaTab testing is waived by the user; record hardware checks as unverified.

## Parent

https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/28

## What to build

Staff create orders, customize items, change quantities, remove items, and resume persisted carts.

## Acceptance criteria

- [ ] All existing entry paths preserve snapshots, order numbers, table association, and modifier rules.
- [ ] Rapid edits flush before leaving for checkout; offline changes survive restart according to current auth behavior.
- [ ] Differential scenarios compare local order outcomes and server results after reconnect.

## Blocked by

- #32
- #33
- #34
